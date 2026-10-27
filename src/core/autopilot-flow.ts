import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { advance, autopilotDir, canContinue, dispatchBudget, isEndedState, newToken, readAutopilot, updateAutopilot } from './autopilot.ts';
import type { AutopilotAction, AutopilotRun } from './autopilot.ts';
import { assertAutopilotWorktree, captureAutopilotPatch, prepareAutopilotWorktree } from './autopilot-worktree.ts';
import { dispatch } from './dispatch.ts';
import { writeAtomic } from './fsx.ts';
import { readyTask } from './plan-dispatch.ts';
import { findProject } from './project.ts';
import { readJob, updateJob } from './job.ts';
import { jobDir } from './paths.ts';
import { parseReview } from './team.ts';
import { verifyCommands, verifyTimeoutMinutes, withVerifyLock } from './verify.ts';
import type { Verification } from './verify.ts';
import { checkSplitGraph, redactText } from './autopilot-diagnosis.ts';
import type { SplitNode } from './autopilot-diagnosis.ts';
import { assertLeadOrigin, leadPacket, makeLeadDecision } from './lead-runtime.ts';
import { selection } from './workers.ts';

export type FlowDeps = {
  prepare?: typeof prepareAutopilotWorktree;
  capture?: typeof captureAutopilotPatch;
  startReview?: (run: AutopilotRun, action: AutopilotAction) => Promise<string[]>;
  review?: (jobs: string[]) => Promise<{ running: true } | { running: false; report: string; failed?: boolean }>;
  verify?: (run: AutopilotRun) => Promise<Verification>;
};
export type FlowRunner = {
  find: (run: AutopilotRun, action: AutopilotAction) => Promise<string[] | null>;
  usage: (jobs: string[]) => Promise<{ read: number; cached: number; out: number } | undefined>;
  stopJob: (job: string) => Promise<void>;
};
async function goal(run: AutopilotRun, node: string) {
  const { project, task } = await readyTask(run.project, run.taskId);
  if (project.repo !== run.repo) throw new Error('项目仓库已经变化。');
  const child = run.nodes.find(n => n.id === node)?.task;
  return child ? `原任务：${run.taskId}\n子节点：${child.id} ${child.title}\n目标：${child.goal}\n验收：${child.acceptance}`
    : `任务：${task.id} ${task.title}\n目标：${task.goal}\n验收：\n${task.acceptance.join('\n')}`;
}
async function dispatchFlow(run: AutopilotRun, action: AutopilotAction, reviewer: boolean) {
  const origin = run.flow?.lead ? await assertLeadOrigin(run) : undefined;
  const body = origin ? origin.text : await goal(run, action.node);
  const text = origin ? (reviewer ? await leadPacket(run) : body) : reviewer ? `${body}\n\n你是独立审查者，只读。候选累积改动已在副本中，相对登记起点检查全部 diff。不得执行报告中的命令，不得修改文件。报告必须采用：\n## 结论\n通过 | 要改\n\n## 意见\n1. [必须改] 文件:行号 —— 问题和理由\n2. [建议] …\n3. [疑问] …\n`
    : `${body}\n\n只完成当前节点；保留已接受的前序成果。不得提交、push、修改 docs/TASK_LIST.md 或 docs/tasks/ 下的任务说明。\n${action.prompt ?? ''}`;
  const dir = join(autopilotDir(run.id), 'prompts'); await mkdir(dir, { recursive: true });
  const file = join(dir, `${action.token}.md`);
  try {
    await writeAtomic(file, text);
    return (await dispatch(file, { who: [reviewer ? run.flow!.reviewer : run.who[0]], project: run.project, base: run.base,
      kind: reviewer ? '审查' : '实现', title: `${run.taskId} ${action.node}${reviewer ? ' 独立审查' : ''}`, ro: reviewer,
      summary: reviewer ? '独立检查这一小步的成果，确认是否满足目标和验收要求。' : '按已经确认的规划完成当前一步，并保留前面已经通过的成果。',
      ...(origin ? { capsule: { rel: origin.rel, fingerprint: origin.fingerprint, anchors: origin.anchors } } : {}),
      plan: { taskId: run.taskId, spec: run.spec }, autopilot: { run: run.id, token: action.token }, autopilotRole: reviewer ? 'reviewer' : 'writer' })).map(j => j.id);
  } finally { await rm(file, { force: true }); }
}
export async function startFlowWriter(run: AutopilotRun, action: AutopilotAction, deps: FlowDeps = {}) {
  await (deps.prepare ?? prepareAutopilotWorktree)(run, 'writer', run.flow!.accepted);
  const current = await readAutopilot(run.id);
  if (isEndedState(current.state) || dispatchBudget(current)) throw new Error('准备副本后执行预算已到线。');
  return dispatchFlow(current, action, false);
}
async function reviewByJobs(jobs: string[], run: AutopilotRun, action: AutopilotAction) {
  let report = '';
  if (run.flow?.lead && jobs.length !== 1) return { running: false as const, failed: true, report: '' };
  for (const id of jobs) {
    const job = await readJob(id);
    if (run.flow?.lead) {
      const who = selection(run.flow.lead.authority);
      if (job.autopilot?.run !== run.id || job.autopilot.token !== action.token || job.who !== who.who
        || job.effort !== who.effort || !!job.fast !== !!who.fast) return { running: false as const, failed: true, report: '' };
    }
    if (job.state === 'running' || job.state === 'queued') return { running: true as const };
    if (job.state !== 'done' || job.mode !== 'read-only' || job.autopilotRole !== 'reviewer') return { running: false as const, failed: true, report: '' };
    const file = join(jobDir(id), 'report.md'), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 131_072) throw new Error('审查报告缺失或超过协议上限。');
    report += await readFile(file, 'utf8');
  }
  return { running: false as const, report };
}
const fail = async (id: string, note: string) => {
  await updateAutopilot(id, run => { if (!isEndedState(run.state)) advance(run, { kind: 'owner', code: 'owner_requested', note: redactText(note, 200) }); });
  return 'ended' as const;
};
function addUsage(run: AutopilotRun, usage: { read: number; cached: number; out: number } | undefined) {
  if (!usage) return;
  run.usage ??= { read: 0, cached: 0, out: 0 };
  run.usage.read += usage.read; run.usage.cached += usage.cached; run.usage.out += usage.out;
}
function acceptParents(run: AutopilotRun) {
  for (let depth = 2; depth >= 0; depth--) for (const parent of run.nodes.filter(n => n.state === 'split' && n.depth === depth)) {
    const children = run.nodes.filter(n => n.parent === parent.id);
    if (children.length && children.every(n => n.state === 'passed')) parent.state = 'passed';
  }
}
// 调用者持有自治动作锁。审查也先预占 AI 总预算，动作令牌在真正派发前原子落盘。
export async function stepFlowReview(id: string, runner: FlowRunner, deps: FlowDeps = {}): Promise<'acted' | 'waiting' | 'ended'> {
  let run = await readAutopilot(id);
  if (run.state === 'recovering') run = await updateAutopilot(id, current => { current.state = 'reviewing'; delete current.reason; });
  if (!run.flow?.candidate) return fail(id, '独立审查缺少候选补丁，原成果保留。');
  if (!run.action) {
    await updateAutopilot(id, current => {
      if (!current.flow?.candidate || current.action || isEndedState(current.state)) return;
      const candidate = current.flow.candidate;
      const action: AutopilotAction = { token: newToken(), node: candidate.node,
        attempt: current.nodes.find(n => n.id === candidate.node)!.attempts, at: new Date().toISOString(), phase: 'review' };
      current.action = action;
      current.flow.reviews.push({ token: action.token, node: action.node, at: action.at, candidate: candidate.hash });
    });
    run = await readAutopilot(id);
  }
  const action = run.action!;
  if (action.phase !== 'review') return fail(id, '审查动作与执行登记不一致。');
  try {
    if (run.flow?.lead) await assertLeadOrigin(run);
    let jobs = action.jobs ?? await runner.find(run, action);
    if (!jobs?.length) {
      if (dispatchBudget(run)) return fail(id, '独立审查前预算已到线。');
      await (deps.prepare ?? prepareAutopilotWorktree)(run, 'reviewer', run.flow!.candidate!.hash);
      const current = await readAutopilot(id);
      if (isEndedState(current.state) || dispatchBudget(current)) return fail(id, '准备审查副本后预算已到线。');
      jobs = await (deps.startReview ?? ((r, a) => dispatchFlow(r, a, true)))(current, action);
      if (!jobs.length) return fail(id, '独立审查没有返回任务记录。');
      await updateAutopilot(id, current => {
        if (current.action?.token !== action.token) return;
        current.action.jobs = jobs!;
        current.flow!.reviews.find(r => r.token === action.token)!.jobs = jobs!;
      });
      return 'acted';
    }
    const result = await (deps.review ? deps.review(jobs) : reviewByJobs(jobs, run, action));
    if (result.running) return 'waiting';
    const usage = await runner.usage(jobs);
    await updateAutopilot(id, current => {
      if (current.action?.token !== action.token) return;
      const entry = current.flow!.reviews.find(r => r.token === action.token)!;
      entry.jobs = jobs!;
      if (usage && !entry.usage) { entry.usage = usage; addUsage(current, usage); }
    });
    if (result.failed) { for (const job of jobs) await runner.stopJob(job).catch(() => {}); return fail(id, '独立审查失败，未接受候选补丁。'); }
    if (run.flow?.lead) {
      const candidate = run.flow.candidate!, capture = deps.capture ?? captureAutopilotPatch;
      const decision = await makeLeadDecision(run, action, result.report, jobs);
      if (await capture(run, 'writer') !== candidate.hash || await capture(run, 'reviewer') !== candidate.hash) return fail(id, '负责人复审期间候选成果变化，没有接受过期结论。');
      await updateAutopilot(id, current => {
        if (isEndedState(current.state) || current.action?.token !== action.token || current.flow?.candidate?.hash !== candidate.hash
          || current.flow.lead?.origin.fingerprint !== run.flow!.lead!.origin.fingerprint) throw new Error('负责人决定的运行绑定已变化。');
        const entry = current.flow.reviews.find(r => r.token === action.token)!;
        entry.jobs = jobs; entry.verdict = decision.reply.action === 'accept' ? 'pass' : ['correct', 'split'].includes(decision.reply.action) ? 'changes' : 'unclear';
        current.flow.lead.decisions.push(decision); delete current.action;
        if (decision.reply.action === 'accept') {
          current.flow.accepted = candidate.hash; delete current.flow.candidate;
          current.nodes.find(n => n.id === action.node)!.state = 'passed'; current.state = 'verifying';
        } else {
          const note = decision.compilation ? '负责人要求修正或拆分，增量执行胶囊已保存。尚未提交到派发起点，请主人确认后再派；不会自动提交或用自由提示词续跑。'
            : decision.reply.action === 'handoff' ? '负责人请求换人；本版本未开放自动换人，成果和决定已保留，请主人接手。' : `负责人请求主人接手：${decision.reply.reason}`;
          advance(current, { kind: 'owner', code: 'owner_requested', note: redactText(note, 280) });
        }
      });
      return isEndedState((await readAutopilot(id)).state) ? 'ended' : 'acted';
    }
    const review = parseReview(result.report);
    if (review.items.some(i => i.level === 'must') && review.verdict === 'pass') review.verdict = 'changes';
    const capture = deps.capture ?? captureAutopilotPatch;
    const candidate = run.flow!.candidate!;
    if (await capture(run, 'writer') !== candidate.hash || await capture(run, 'reviewer') !== candidate.hash) return fail(id, '审查期间候选成果发生变化，没有接受过期结论。');
    await updateAutopilot(id, current => {
      if (current.action?.token !== action.token) return;
      const entry = current.flow!.reviews.find(r => r.token === action.token)!;
      entry.jobs = jobs!; entry.verdict = review.verdict;
      delete current.action;
      const node = current.nodes.find(n => n.id === action.node)!;
      if (review.verdict === 'pass') {
        current.flow!.accepted = candidate.hash; delete current.flow!.candidate;
        node.state = 'passed'; acceptParents(current);
        current.state = current.nodes.every(n => n.state === 'passed') ? 'verifying' : 'executing';
      } else if (review.verdict === 'changes' && canContinue(current, node.id)) {
        node.continues++; node.state = 'failed'; current.state = 'executing';
        current.nextPrompt = { node: node.id, mode: 'continue', prompt: redactText(`独立审查要求修正：\n${review.items.map(i => `${i.n}. ${i.text}`).join('\n') || '审查未通过，请复核目标与验收。'}`, 1200) };
      } else advance(current, { kind: 'owner', code: review.verdict === 'changes' ? 'recovery_budget' : 'owner_requested', note: '独立审查未通过或报告格式不明，未接受候选补丁。' });
    });
    return isEndedState((await readAutopilot(id)).state) ? 'ended' : 'acted';
  } catch {
    const found = await runner.find(run, action).catch(() => null);
    for (const job of new Set([...(action.jobs ?? []), ...(found ?? [])])) await runner.stopJob(job).catch(() => {});
    return fail(id, '审查准备、记录或补丁快照无法核对，原成果保留，请主人接手。');
  }
}
async function verifyByRegistry(run: AutopilotRun) {
  const project = await findProject(run.project);
  if (!project.verify.length) throw new Error('项目没有登记验收命令，不能自动判定完成。');
  const target = await assertAutopilotWorktree(run, 'writer');
  const remaining = run.policy.minutes - run.elapsedSeconds / 60;
  if (remaining <= 0) throw new Error('验收前预算已到线。');
  // 不接收 AI 的命令；项目登记仍是唯一来源，且整个验收受剩余时长约束。
  const started = Date.now();
  return withVerifyLock(project.repo, () => {
    const left = remaining - (Date.now() - started) / 60_000;
    if (left <= 0) throw new Error('验收排队已用完剩余预算。');
    return verifyCommands(project.verify, target.worktree,
      join(autopilotDir(run.id), 'verify.log'), Math.min(left / project.verify.length, verifyTimeoutMinutes(project.verifyTimeoutMinutes)));
  }, remaining * 60_000);
}
export async function stepFlowVerify(id: string, deps: FlowDeps = {}): Promise<'acted' | 'ended'> {
  let run = await readAutopilot(id);
  if (!run.flow || run.nodes.some(n => n.state !== 'passed') || run.flow.candidate
    || !run.flow.reviews.some(r => r.verdict === 'pass')) return fail(id, '缺少全部节点的独立审查结果，不能直接跳到验收。');
  const started = Date.now();
  try {
    if (run.flow.lead) await assertLeadOrigin(run);
    if (run.flow.verifyStarted) {
      await updateAutopilot(id, current => {
        current.elapsedSeconds += Math.max(0, (Date.now() - Date.parse(current.flow!.verifyStarted!)) / 1000);
        delete current.flow!.verifyStarted;
      });
      return fail(id, '上一轮验收中断，执行时间已保守计入预算；请主人检查验收副作用后接手。');
    }
    const capture = deps.capture ?? captureAutopilotPatch;
    if (await capture(run, 'writer') !== run.flow.accepted) return fail(id, '验收前成果与已接受快照不一致。');
    run = await updateAutopilot(id, current => { current.flow!.verifyStarted = new Date().toISOString(); });
    const result = await (deps.verify ?? verifyByRegistry)(run);
    if (await capture(run, 'writer') !== run.flow!.accepted) return fail(id, '验收命令修改了受审文件，不能沿用旧审查结论。');
    // 诊断包沿用原任务证据入口，因此验收记录同步留在最后一轮写手任务上。
    if (!deps.verify) for (const id of run.attempts.at(-1)?.jobs ?? []) await updateJob(id, job => { job.verify = result; });
    await updateAutopilot(id, current => {
      if (current.state !== 'verifying' || !current.flow) return;
      current.flow.verification = result;
      delete current.flow.verifyStarted;
      if (result.ok) advance(current, { kind: 'verified' });
      else {
        const last = current.nodes.find(n => n.id === current.attempts.at(-1)?.node); if (last) last.state = 'failed';
        if (current.flow.lead && last && current.attempts.at(-1)?.jobs?.length) {
          current.flow.candidate = { hash: current.flow.accepted, node: last.id, jobs: [...current.attempts.at(-1)!.jobs!] };
          current.state = 'reviewing'; return;
        }
        advance(current, { kind: 'failed', note: '登记的项目验收未通过，转负责人诊断。' });
      }
    });
    return result.ok ? 'ended' : 'acted';
  } catch { return fail(id, '项目验收配置或副本无法核对，未宣告完成，请主人接手。'); }
  finally { await updateAutopilot(id, current => { current.elapsedSeconds += Math.max(0, (Date.now() - started) / 1000); }); }
}
// 拆分仅替换当前失败节点；旧尝试和未接受快照保留，子节点只能继承固定执行/审查角色。
export function activateFlowSplit(run: AutopilotRun, parentId: string, graph: SplitNode[]): boolean {
  try { graph = checkSplitGraph(graph); } catch { return false; }
  const parent = run.nodes.find(n => n.id === parentId);
  if (!run.flow || !parent || parent.depth >= 2 || graph.some(n => run.nodes.some(old => old.id === n.id))
    || run.nodeCount + graph.length > run.policy.nodes) return false;
  parent.state = 'split';
  for (const task of graph) run.nodes.push({ id: task.id, depth: parent.depth + 1, state: 'pending', attempts: 0, continues: 0, retries: 0, parent: parent.id, task });
  run.nodeCount = run.nodes.length; run.state = 'executing'; delete run.flow.candidate;
  return true;
}
