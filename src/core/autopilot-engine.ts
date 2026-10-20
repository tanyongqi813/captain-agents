import { mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { nodeCommand } from './node-runtime.ts';
import { backgroundSpawn, alive, processSince } from './platform.ts';
import { withLock, writeAtomic } from './fsx.ts';
import { engineEnvironment, engineSnapshot, killEngine, readReport, rememberSession, resumeMember, wakeGate } from './wake.ts';
import { hasCode } from './fsx.ts';
import { finish, leftBy, readJob, updateJob } from './job.ts';
import type { Job } from './job.ts';
import { jobDir, paths, safeName } from './paths.ts';
import { stop } from './commands.ts';
import { killGroup } from './runner.ts';
import { planDispatch } from './plan-dispatch.ts';
import { readTaskPlan } from './task-plan.ts';
import { changedFiles, git } from './worktree.ts';
import { dispatch } from './dispatch.ts';
import { checkQuota, ensureQuota } from './quota.ts';
import { readSettings } from './settings.ts';
import { isolationOf, spec } from './roster.ts';
import { selection } from './workers.ts';
import {
  actionLockDir, advance, aiAttempts, autopilotDir, canContinue, canRetry, createAutopilot, diagnosesLeft, diagnosesOf,
  dispatchBudget, exceededBudget, isActiveState, isEndedState, MAX_CONTINUES_PER_NODE, MAX_DIAGNOSES_PER_NODE,
  MAX_RETRIES_PER_NODE, newToken, readAutopilot, stateNames, updateAutopilot,
} from './autopilot.ts';
import type {
  AutopilotAction, AutopilotAttempt, AutopilotDiagnosis, AutopilotRun, AutopilotStartOptions, BudgetLimit,
} from './autopilot.ts';
import { buildPacket, continueBody, evidenceFingerprint, parseDiagnosis, quotaSignal, redactText } from './autopilot-diagnosis.ts';
import type { DiagnosisCause, DiagnosisEvidence, OwnerCode } from './autopilot-diagnosis.ts';
import { activateFlowSplit, startFlowWriter, stepFlowReview, stepFlowVerify } from './autopilot-flow.ts';
import type { FlowDeps } from './autopilot-flow.ts';
import { assertAutopilotWorktree, captureAutopilotPatch } from './autopilot-worktree.ts';

// 无人看守的确定性推进器（docs/tasks/TASK-009.md、docs/tasks/TASK-010.md）。它是隔离外的后台进程（autopilot-entry.ts），
// 每走一步都是同一个形状：在锁里核对状态与动作令牌 → 记下"要做什么"（意图）→ 再动手做外部工作 → 回来落盘结果。
// 这样任一步崩掉，下一次启动都能从登记文件判断：工作还没开始（安全补一次）、已经在跑（接着等）、已经做完（认领结果）。
//
// 三条不能破的线：
// 1. 同一台执行任何时刻只有一个推进器（launchAutopilotEngine 和 runAutopilot 都先看有没有活着的 pid，登记改写在锁里）。
// 2. 外部动作只从 TASK-006 的权威校验入口发起（planDispatch → readyTask），界面来的内容一律不认。
// 3. 失败之后走只读负责人诊断（TASK-010）：诊断也按同一套令牌认领，超时/崩溃/输出不合法/额度拒绝一律有界结束为
//    needs_owner 并留下结构化原因码，不反复调用 AI，也不让 AI 的命令、路径、选手、权限落地。

const POLL_MS = 2000;
// 同一个进程里也只许一个推进器盯同一台执行（生产是一进程一台；这条挡住测试和误用）。
const inProcess = new Set<string>();
// 两次采样之间超过这个间隔就当电脑睡了一觉，扣掉不计入预算（和 runner 的停滞判定同一口径）。
const SLEEP_GAP_MS = 60_000;
// 诊断证据里的日志尾部按字节读；读不到（被清理、还没生成）就当没有，不让诊断卡住。
const TAIL_BYTES = 8192;

export type StartIntent = {
  run: string; token: string; project: string; taskId: string; who: string[]; ro: boolean; node: string; attempt: number;
  // 诊断决定"补做"时带上：mode=continue 叫醒上一轮那件活（previous 是它的任务号，副本里的改动保住）；
  // prompt 是给下一轮的补充说明（重试时也有，只是不用叫醒旧的活）。
  mode?: 'execute' | 'continue' | 'retry';
  prompt?: string;
  previous?: string[];
  // 补做要叫醒哪几件活、各叫醒到第几轮（登记里也存了一份，崩溃恢复靠它对账）。
  rounds?: { job: string; round: number }[];
};
// 请只读负责人诊断：平台给的是整理好的诊断包，AI 能选的只有五种动作。
export type DiagnosisIntent = {
  run: string; token: string; project: string; taskId: string; who: string; node: string; attempt: number;
  fingerprint: string; packet: string;
};
export type DiagnosisRefusal = { kind: 'quota' | 'other'; note: string };
export type DiagnosisResult =
  | { state: 'running' }
  | DiagnosisSettled;
// 已经有结论的诊断：跑完了（带报告文字）或者没成（带分类）。
export type DiagnosisSettled =
  | { state: 'done'; text: string }
  | { state: 'failed'; kind: 'quota' | 'timeout' | 'crashed' };

export type AutopilotDeps = {
  flow?: FlowDeps;
  // 真正出去干活的那一步。生产是规划派发；测试替身自己记账也自己回话。
  start?: (intent: StartIntent) => Promise<{ jobs: string[] }>;
  // 外部动作留下的证据：崩溃后靠它认领，绝不重复派活。
  find?: (run: AutopilotRun, action: AutopilotAction) => Promise<string[] | null>;
  inspect?: (jobs: string[]) => Promise<'running' | 'done' | 'failed'>;
  usage?: (jobs: string[]) => Promise<{ read: number; cached: number; out: number } | undefined>;
  stopJob?: (job: string) => Promise<void>;
  // 诊断（TASK-010）：整理证据、请只读负责人、读回结果。三个都可在测试里换掉，跑测试不碰真实模型。
  evidence?: (run: AutopilotRun, attempt: AutopilotAttempt) => Promise<DiagnosisEvidence>;
  // 权威核对这几件活的副本当前还有多少个没被接受的改动；null 表示确认不了（记录或副本读不到、Git 报错）。
  changes?: (jobs: string[]) => Promise<number | null>;
  startDiagnosis?: (intent: DiagnosisIntent) => Promise<{ jobs: string[] } | { refused: DiagnosisRefusal }>;
  diagnose?: (jobs: string[]) => Promise<DiagnosisResult>;
  now?: () => number;
  pollMs?: number;
};

// 任务记录里的选手还原成派活时的选择串，续接前的闸门拿它做和首次派活一样的检查。
const selectOf = (job: Pick<Job, 'who' | 'effort' | 'fast'>) => `${job.who}:${job.effort}${job.fast ? ':fast' : ''}`;

// 已经叫醒的当场停掉：记停止记号、结束进程树、把记录写成"被停止"——的做法和 xagents stop 的直停路径一样，
// 只是不等看管进程（它可能刚被叫起来、还没装上信号处理，等也等不到，反而会把记录晾在"排队中"）。
async function abortStarted(ids: string[]) {
  for (const id of ids) {
    try {
      await updateJob(id, current => {
        if (current.state !== 'queued' && current.state !== 'running') return;
        current.stopRequested = true;
        current.termination ??= 'manual';
        const until = leftBy(current);
        killGroup(current.setupPid, 'SIGKILL', current.setupSince, undefined, until);
        if (alive(current.pid, current.pidSince)) {
          try { process.kill(current.pid!, 'SIGTERM'); }
          catch (error) { if (!hasCode(error, 'ESRCH')) throw error; }
        }
        killGroup(current.workerPid, 'SIGKILL', current.workerSince, undefined, until);
        finish(current, 'stopped', '续接被拦下，平台当场停掉。');
      });
    } catch { /* 收尾不了就留给主人：记录里还留着停止记号，xagents stop 还能再收一次 */ }
  }
}

// 生产替身：规划派发会重新读规划、走策略/额度/隔离/并发校验，并把这一枪的令牌写进任务记录。
// 诊断说"补做"时改叫醒上一轮那件活：副本里有没被接受的改动，重派一件新的会把这些改动丢掉。
//
// 续接和群、小队走同一个共用入口：先过 wakeGate，过了才叫醒；并发额度和叫醒在同一把派活锁里，
// 中间不会被别的派活抢走名额（评审第 1 条）。
// 令牌在真正叫醒之后才写进任务记录：只预留、没叫醒时记录里还是上一轮的令牌，
// 崩溃恢复不会把旧一轮的结果认成新一轮（评审第 5 条）。
const startByDispatch: NonNullable<AutopilotDeps['start']> = async intent => {
  const run = await readAutopilot(intent.run);
  if (run.flow && intent.mode !== 'continue') return { jobs: await startFlowWriter(run, run.action!) };
  if (intent.mode === 'continue') {
    if (run.flow) {
      const target = await assertAutopilotWorktree(run, 'writer');
      for (const id of intent.previous ?? []) {
        const job = await readJob(id);
        if (job.autopilot?.run !== run.id || job.autopilotRole !== 'writer' || job.worktree !== target.worktree) throw new Error('续接来源不是本台执行的写手副本。');
      }
    }
    const rounds = (intent.rounds ?? []).filter(item =>
      typeof item?.job === 'string' && item.job.length > 0 && Number.isInteger(item.round) && item.round >= 2);
    if (!rounds.length) throw new Error('上一轮没有可续接的任务记录，不能补做。请主人接手。');
    const body = continueBody({ taskId: intent.taskId, node: intent.node }, intent.prompt ?? '');
    return withLock(join(paths().cache, 'dispatch'), async () => {
      // 一、先把每一件活的闸门都过一遍：主人关掉的选手、额度触顶、项目归档、自检/登录不可用都在这里拦下，
      // 一件活都还没叫醒，不用回头收拾。
      const ready: { job: Job; round: number }[] = [];
      for (const item of rounds) {
        let job: Job;
        try { job = await readJob(item.job); }
        catch (error) {
          if (hasCode(error, 'ENOENT')) throw new Error(`找不到要续接的任务记录 ${item.job}，不能补做。请主人接手。`);
          throw error;
        }
        const blocked = await wakeGate(selection(selectOf(job)), job.project || intent.project);
        if (blocked) throw new Error(`续接被拦下：${blocked.note}`);
        ready.push({ job, round: item.round });
      }
      // 二、再一件件叫醒。并发名额可能刚被别的派活占走，所以每叫一件之前再确认一次；
      // 中途出了岔子（拦截、叫不醒），已经叫醒的当场停掉，绝不留下没人认领的活。
      const started: string[] = [];
      try {
        for (const item of ready) {
          const blocked = await wakeGate(selection(selectOf(item.job)), item.job.project || intent.project);
          if (blocked) throw new Error(`续接被拦下：${blocked.note}`);
          // 会话号从上一轮的日志里取回来（群和小队也是先 rememberSession 再续接）；取不到就明确报错，不猜。
          const saved = await rememberSession(item.job);
          if (!saved.session) throw new Error(`没有从 ${saved.id} 的日志里找到会话号，没法续接上一轮。请查看 run.log 后决定。`);
          await resumeMember(saved, item.round, body);
          started.push(saved.id);
          await updateJob(saved.id, current => { current.autopilot = { run: intent.run, token: intent.token }; });
        }
      } catch (error) {
        await abortStarted(started);
        throw error;
      }
      return { jobs: ready.map(item => item.job.id) };
    });
  }
  const jobs = await planDispatch({
    project: intent.project, taskId: intent.taskId, who: intent.who,
    ...(intent.ro ? { ro: true } : {}),
    ...(intent.prompt ? { extra: intent.prompt } : {}),
    autopilot: { run: intent.run, token: intent.token },
  });
  return { jobs: jobs.map(job => job.id) };
};
// 认领证据：任务记录里带着同一个令牌的活，就是这一枪派出去的。
const findInJobs: NonNullable<AutopilotDeps['find']> = async (_run, action) => {
  const names = await readdir(paths().jobs).catch(error => { if (hasCode(error, 'ENOENT')) return []; throw error; });
  const found: string[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const job = await readJob(name);
      if (job.autopilot?.token === action.token) found.push(job.id);
    } catch (error) { if (!hasCode(error, 'ENOENT') && !(error instanceof SyntaxError)) throw error; }
  }
  return found.length ? found.sort() : null;
};
const inspectJobs: NonNullable<AutopilotDeps['inspect']> = async jobs => {
  let failed = false;
  for (const id of jobs) {
    let job: Job;
    try { job = await readJob(id); }
    catch (error) { if (hasCode(error, 'ENOENT')) { failed = true; continue; } throw error; }
    if (job.state === 'queued' || job.state === 'running') return 'running';
    if (job.state !== 'done') failed = true;
  }
  return failed ? 'failed' : 'done';
};
// 一件活"当前这一轮"的用量。续轮开始时 resumeMember 会清空 job.usage（wake.ts），所以 job.usage 只是这一轮的；
// 归过档的（foldRounds）取轮到的那条记录。两种写法都认，但绝不把上一轮的用量算第二遍（评审第 4 条）。
export function roundUsage(job: Job): { read: number; cached: number; out: number } | undefined {
  const round = job.resume?.round ?? 1;
  const folded = job.rounds?.find(item => item.n === round)?.usage;
  const usage = folded ?? job.usage;
  if (!usage) return undefined;
  return { read: usage.read, cached: usage.cached, out: usage.out };
}
const usageOfJobs: NonNullable<AutopilotDeps['usage']> = async jobs => {
  let total: { read: number; cached: number; out: number } | undefined;
  for (const id of jobs) {
    try {
      const usage = roundUsage(await readJob(id));
      if (!usage) continue;
      total ??= { read: 0, cached: 0, out: 0 };
      total.read += usage.read; total.cached += usage.cached; total.out += usage.out;
    } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
  }
  return total;
};
// 权威核对：这几件活的副本现在还有多少个没被接受的改动（直接看 Git 状态，不信任务记录里可能过期的快照）。
// 任何一件读不到就算确认不了（null）——"确认不了"不等于"干净"，这时平台不许重做（评审第 3 条）。
const changesIn = async (jobs: string[]): Promise<number | null> => {
  if (!jobs.length) return null;
  let total = 0;
  for (const id of jobs) {
    let job: Job;
    try { job = await readJob(id); }
    catch (error) { if (hasCode(error, 'ENOENT')) return null; throw error; }
    if (!job.worktree || job.worktreeRemoved) return null;
    try {
      if (job.autopilotRole === 'writer' && job.autopilot) {
        const run = await readAutopilot(job.autopilot.run);
        total += await captureAutopilotPatch(run, 'writer') === run.flow?.accepted ? 0 : await changedFiles(job);
      } else total += await changedFiles(job);
    }
    catch { return null; }
  }
  return total;
};
const stopByCommand: NonNullable<AutopilotDeps['stopJob']> = async job => { await stop(job); };

// 文件尾部：诊断只带最近的输出，不把整份日志塞进诊断包。
async function tailOf(file: string): Promise<string> {
  try {
    const handle = await open(file, 'r');
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally { await handle.close(); }
  } catch { return ''; }
}

// 证据类别：先看验收结论，再看任务记录里的终止原因，最后看有没有留下改动。
function causeOf(termination: string | undefined, verify: { ok: boolean } | null | undefined, changes: number): DiagnosisCause {
  if (verify && verify.ok === false) return 'verify_failed';
  if (termination === 'stalled') return 'stalled';
  if (termination === 'timed_out') return 'timed_out';
  if (termination === 'process_error') return 'process_error';
  if (changes > 0) return 'changes';
  return 'failed';
}

const emptyTask = (run: AutopilotRun) => ({ id: run.taskId, title: run.taskId, goal: '', acceptance: [] as string[] });
// 任务目标与验收只从项目的任务台账读（TASK-005 的解析），读不到就只写编号；不改任何文件。
async function taskOf(run: AutopilotRun) {
  try {
    const plan = await readTaskPlan({ name: run.project, repo: run.repo });
    const task = plan.tasks.find(item => item.id === run.taskId);
    if (!task) return emptyTask(run);
    return { id: task.id, title: task.title || task.id, goal: task.goal, acceptance: task.acceptance };
  } catch { return emptyTask(run); }
}

// 生产证据：失败那一次的任务记录（终止原因、有没有改动、活动、报告、验收结论）+ 两份日志尾部 + diff 摘要。
// 全部只是资料；整理成诊断包时会再脱敏、按段截断（autopilot-diagnosis.ts）。
const evidenceOf: NonNullable<AutopilotDeps['evidence']> = async (run, attempt) => {
  const jobs = attempt.jobs ?? [];
  const changes = await changesIn(jobs);
  let termination: string | undefined;
  let worktree = '';
  let activity = '', runLog = '', stderrLog = '', diffStat = '', report = '';
  let verify: { ok: boolean; note: string } | null | undefined;
  for (const id of jobs) {
    let job: Job;
    try { job = await readJob(id); }
    catch (error) { if (hasCode(error, 'ENOENT')) continue; throw error; }
    termination ??= job.termination;
    if (job.worktree) worktree = job.worktree;
    activity += (job.activity ?? []).slice(-8).map(item => `${item.kind} ${item.text}`).join('\n') + '\n';
    runLog += await tailOf(join(jobDir(id), 'run.log'));
    stderrLog += await tailOf(join(jobDir(id), 'stderr.log'));
    diffStat += await git(job.worktree, ['diff', '--stat']).catch(() => '');
    report += await readReport(job).catch(() => '');
    const checked = job.verify as { ok?: unknown; steps?: unknown } | undefined;
    if (checked && typeof checked.ok === 'boolean') {
      const steps = Array.isArray(checked.steps) ? checked.steps as { cmd?: unknown; summary?: unknown }[] : [];
      verify = { ok: checked.ok, note: steps.map(step => `${String(step.cmd ?? '')}：${String(step.summary ?? '')}`).join('；') };
    }
  }
  const node = run.nodes.find(item => item.id === attempt.node);
  const cause = causeOf(termination, verify, changes ?? 0);
  return {
    task: await taskOf(run), node: attempt.node, attempt: attempt.attempt, cause,
    ...(termination ? { termination } : {}),
    unacceptedChanges: changes, activity, runLog, stderrLog, diffStat, report,
    ...(verify !== undefined ? { verify } : {}),
    history: diagnosesOf(run)
      .filter(item => item.action !== undefined || item.code !== undefined)
      .map(item => ({
        fingerprint: item.fingerprint, ...(item.action ? { action: item.action } : {}),
        ...(item.code ? { code: item.code } : {}), ...(item.note ? { note: item.note } : {}),
      })),
    // 一律写"还剩多少"：已用多少对做决定没用，AI 得照着实打实的余量选动作。
    budget: {
      minutesLeft: Math.max(0, Math.floor(run.policy.minutes - run.elapsedSeconds / 60)),
      attemptsLeft: Math.max(0, run.policy.attempts - aiAttempts(run)),
      nodesLeft: Math.max(0, run.policy.nodes - run.nodeCount),
      continuesLeft: canContinue(run, attempt.node) ? MAX_CONTINUES_PER_NODE - (node?.continues ?? 0) : 0,
      retriesLeft: canRetry(run, attempt.node) ? MAX_RETRIES_PER_NODE - (node?.retries ?? 0) : 0,
      diagnosesLeft: diagnosesLeft(run, attempt.node),
    },
    redact: { repo: run.repo, ...(worktree ? { worktree } : {}) },
  };
};

// 诊断由平台指定一位只读负责人：优先与写手不同厂家，其次不同模型，最后才是同一位。
// 只用主人在启动时批准过的那几位，从不接受 AI 或界面指定选手。
export function diagnosisChoice(run: Pick<AutopilotRun, 'who'>): string {
  const usable = run.who.filter(item => { try { selection(item); return true; } catch { return false; } });
  const list = usable.length ? usable : run.who;
  const first = list[0];
  if (!first) throw new Error('这台无人看守没有可用的选手，不能派只读故障诊断。');
  const family = isolationOf(selection(first).who);
  const model = spec(selection(first).who).model;
  return list.find(item => isolationOf(selection(item).who) !== family)
    ?? list.find(item => spec(selection(item).who).model !== model)
    ?? first;
}

// 生产诊断：先自己查一次额度（拒绝时能给可区分的原因码，不用猜派活的报错文字），
// 再走现有派活入口（策略、额度、隔离、并发、登录检查都在里面），只读、题目就是诊断包。
const startDiagnosisByDispatch: NonNullable<AutopilotDeps['startDiagnosis']> = async intent => {
  try {
    const settings = await readSettings();
    checkQuota(await ensureQuota(), [selection(intent.who)], false, settings.limits.quotaStop);
  } catch (error) {
    return { refused: { kind: 'quota', note: redactText(error instanceof Error ? error.message : String(error), 200) } };
  }
  const dir = join(paths().cache, 'autopilot-diagnosis');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${safeName(intent.run)}-${safeName(intent.token)}.md`);
  try {
    await writeAtomic(file, intent.packet);
    const jobs = await dispatch(file, {
      who: [intent.who], project: intent.project, ro: true, kind: '审查',
      title: `诊断 ${intent.taskId} 第 ${intent.attempt} 次`,
      summary: '看一份无人看守的诊断包，按协议给出受控的恢复动作。',
      autopilot: { run: intent.run, token: intent.token },
    });
    return { jobs: jobs.map(job => job.id) };
  } catch (error) {
    return { refused: { kind: 'other', note: redactText(error instanceof Error ? error.message : String(error), 200) } };
  } finally {
    await rm(file, { force: true });
  }
};

// 诊断的结果：还在跑就等着；跑完了把报告读回来（诊断包和报告都是文字，解析在 autopilot-diagnosis.ts）；
// 没成就按"额度耗尽 / 超时 / 崩溃"分类——分类只看本地记录和日志里的标记，不再调另一个 AI 去猜。
const diagnoseByJobs: NonNullable<AutopilotDeps['diagnose']> = async jobs => {
  let text = '';
  for (const id of jobs) {
    let job: Job;
    try { job = await readJob(id); }
    catch (error) {
      if (hasCode(error, 'ENOENT')) return { state: 'failed', kind: 'crashed' };
      throw error;
    }
    if (job.state === 'queued' || job.state === 'running') return { state: 'running' };
    if (job.state !== 'done') {
      const marker = `${job.error ?? ''}\n${await tailOf(join(jobDir(id), 'stderr.log'))}\n${await tailOf(join(jobDir(id), 'run.log'))}`;
      if (quotaSignal(marker)) return { state: 'failed', kind: 'quota' };
      if (job.termination === 'timed_out' || job.termination === 'stalled') return { state: 'failed', kind: 'timeout' };
      return { state: 'failed', kind: 'crashed' };
    }
    text += `\n${await readReport(job).catch(() => '')}`;
  }
  return { state: 'done', text };
};

const depsOf = (deps: AutopilotDeps) => ({
  start: deps.start ?? startByDispatch,
  find: deps.find ?? findInJobs,
  inspect: deps.inspect ?? inspectJobs,
  usage: deps.usage ?? usageOfJobs,
  stopJob: deps.stopJob ?? stopByCommand,
  evidence: deps.evidence ?? evidenceOf,
  changes: deps.changes ?? changesIn,
  startDiagnosis: deps.startDiagnosis ?? startDiagnosisByDispatch,
  diagnose: deps.diagnose ?? diagnoseByJobs,
});

// 动作锁等多久：这里等的是"另一个推进器正在派活"，正常最多等一次派活的时间，所以给足两分钟。
const ACTION_LOCK_WAIT_MS = 120_000;

// 这台执行动过的全部任务号（写手的、诊断的），收尾和预算到线时按它把活停干净。
const allJobs = (run: AutopilotRun): string[] => [...new Set([
  ...(run.action?.jobs ?? []),
  ...run.attempts.flatMap(item => item.jobs ?? []),
  ...diagnosesOf(run).flatMap(item => item.jobs ?? []),
  ...(run.flow?.reviews.flatMap(item => item.jobs ?? []) ?? []),
])];

// 走一步。返回值：ended 已经停下、waiting 在等外部工作、acted 刚做完一步、idle 没活可干。
//
// 整段"复核 → 查证据 → 动手 → 写回任务号"都在这一台执行的动作锁里做，锁内一律重新读登记：
// 两个推进器（哪怕在两个进程里）不可能同时走进来，后进来的会先看到前一个已经写好的任务号，于是认领而不是重派。
export async function stepAutopilot(id: string, deps: AutopilotDeps = {}): Promise<'ended' | 'waiting' | 'acted' | 'idle'> {
  const first = await readAutopilot(id);
  if (isEndedState(first.state)) return 'ended';
  return withLock(actionLockDir(id), async () => {
    let run = await readAutopilot(id);          // 权威状态：锁内重读，不信锁外看到的
    if (run.flow && run.state === 'recovering' && !run.action) {
      run = await updateAutopilot(id, current => {
        current.state = current.nextPrompt ? 'executing' : current.flow!.candidate ? 'reviewing' : current.nodes.every(n => n.state === 'passed') ? 'verifying' : 'executing';
        delete current.reason;
      });
    }
    if (isEndedState(run.state)) return 'ended';  // 停下/预算收尾之后，过期动作一个字都不能再动
    const limit = exceededBudget(run);
    // 已经预占的动作要让它走完：尝试次数正好用尽时，最后那一枪已经算进预算里了，卡在这里会把它的结果白丢一次。
    // 下一次进来没有待确认动作，就在上面这行收尾——"最后一次已预占"和"不许再开新的"是两件事（评审第 2 条）。
    if (limit && !(limit === 'attempts' && (run.action || run.flow && run.state === 'verifying'))) return exhaust(id, limit, deps);
    if (run.action) {
      if (run.flow && run.action.phase === 'review') return stepFlowReview(id, depsOf(deps), deps.flow);
      // 待确认的动作分两种：写手在干，或故障诊断 AI 在工作。两者的认领方式一样，收尾方式不同。
      return run.action.phase === 'diagnose' ? recoverDiagnosis(id, deps) : recover(id, deps);
    }
    if (run.state === 'diagnosing') return diagnose(id, deps);
    if (run.flow && run.state === 'reviewing') return stepFlowReview(id, depsOf(deps), deps.flow);
    if (run.state === 'verifying') return run.flow ? stepFlowVerify(id, deps.flow) : endVerify(id);
    return takeAction(id, deps);
  }, ACTION_LOCK_WAIT_MS);
}

// 预算用完：先按令牌把可能已经派出去、只是还没记上号的活认领出来停掉，再转 needs_owner。
// 认领放在动作锁里，所以不会和正在派活的那一步打对台。
async function exhaust(id: string, limit: BudgetLimit, deps: AutopilotDeps): Promise<'ended'> {
  const runner = depsOf(deps);
  const run = await readAutopilot(id);
  const jobs = new Set(allJobs(run));
  if (run.action && !run.action.jobs?.length) {
    const found = await runner.find(run, run.action).catch(() => null);
    for (const job of found ?? []) jobs.add(job);
  }
  for (const job of jobs) await runner.stopJob(job).catch(() => {});
  await updateAutopilot(id, current => {
    if (isEndedState(current.state)) return;
    advance(current, { kind: 'budget', limit });
  });
  return 'ended';
}

// 领一个动作令牌并记下意图。锁里只有一个推进器，令牌复核仍然照做：别的进程可能刚把动作顶掉。
async function takeAction(id: string, deps: AutopilotDeps): Promise<'acted' | 'idle' | 'ended'> {
  const holder: { action?: AutopilotAction } = {};
  const written = await updateAutopilot(id, run => {
    if (isEndedState(run.state) || run.action) return;
    const node = run.nodes.find(item => (item.state === 'pending' || item.state === 'running' || item.state === 'failed')
      && (!item.task || item.task.deps.every(dep => run.nodes.some(n => n.id === dep && n.state === 'passed'))));
    if (!node) {
      // 所有节点都已有结论，却没有新的事能做：交给主人，不许原地空转。
      advance(run, { kind: 'blocked', note: `没有可继续的节点了（${run.nodes.map(item => `${item.id} ${item.state}`).join('、')}），请主人接手。` });
      return;
    }
    // 诊断说过"补做/重试"时留着一段补充题目：搬到动作里再落盘，写手用不着回去读诊断。
    const carry = run.nextPrompt && run.nextPrompt.node === node.id ? run.nextPrompt : undefined;
    if (carry?.mode === 'retry' && !run.attempts.filter(item => item.node === node.id).at(-1)?.jobs?.length) {
      advance(run, { kind: 'owner', code: 'retry_unverified_changes' });
      return;
    }
    if (carry) delete run.nextPrompt;
    const at = new Date().toISOString();
    const action: AutopilotAction = {
      token: newToken(), node: node.id, attempt: node.attempts + 1, at,
      ...(carry ? { mode: carry.mode, prompt: carry.prompt } : {}),
      ...(carry?.mode === 'retry' ? { retrySource: run.attempts.filter(item => item.node === node.id).at(-1)?.jobs ?? [] } : {}),
    };
    run.action = action;
    node.attempts += 1;
    node.state = 'running';
    run.attemptCount += 1;
    run.attempts.push({ node: action.node, attempt: action.attempt, token: action.token, at });
    if (!advance(run, { kind: 'intent' })) throw new Error(`无人看守 ${id} 在 ${run.state} 状态下不能开新动作。`);
    holder.action = action;
  });
  if (!holder.action) return isEndedState(written.state) ? 'ended' : 'idle';
  return startAction(id, holder.action, deps);
}

// 每一件活接下来叫醒到第几轮：看任务记录里现在叫醒到哪一轮，往后推一轮。记录读不到就不续接（不能猜）。
async function resumeRounds(jobs: string[]): Promise<{ job: string; round: number }[]> {
  const rounds: { job: string; round: number }[] = [];
  for (const id of jobs) {
    let job: Job;
    try { job = await readJob(id); }
    catch (error) {
      if (hasCode(error, 'ENOENT')) throw new Error(`找不到要续接的任务记录 ${id}，不能补做。请主人接手。`);
      throw error;
    }
    rounds.push({ job: id, round: (job.resume?.round ?? 1) + 1 });
  }
  return rounds;
}

// 记完意图才动手。动手之前（仍在动作锁里）再复核一遍：已经收了、令牌被顶掉、时长或用量到线，就一件都不派。
// 派活本身失败（自检、额度、并发、登录）不重试，直接转 needs_owner 写清原因。
async function startAction(id: string, action: AutopilotAction, deps: AutopilotDeps): Promise<'acted' | 'ended'> {
  const runner = depsOf(deps);
  const run = await readAutopilot(id);
  if (isEndedState(run.state)) return 'ended';
  if (run.action?.token !== action.token) return 'acted';      // 这个动作已经被更晚的一步顶掉了
  const late = dispatchBudget(run);
  if (late) return exhaust(id, late, deps);
  // 补做要叫醒上一轮那件活：它的任务号记在那一次尝试上（副本里的改动就在那里）。
  const previous = action.mode === 'continue'
    ? run.attempts.filter(item => item.node === action.node && item.token !== action.token).at(-1)?.jobs
    : undefined;
  let rounds: { job: string; round: number }[] | undefined;
  try {
  if (action.mode === 'retry') {
    const changes = action.retrySource?.length ? await runner.changes(action.retrySource).catch(() => null) : null;
    if (changes === null || changes > 0) {
      await updateAutopilot(id, current => {
        if (current.action?.token !== action.token) return;
        const attempt = current.attempts.find(item => item.token === action.token);
        if (attempt) attempt.outcome = 'blocked';
        advance(current, { kind: 'owner', code: changes === null ? 'retry_unverified_changes' : 'retry_refused_changes' });
      });
      return 'ended';
    }
  }
  if (action.mode === 'continue' && !previous?.length) throw new Error('找不到续接来源，保留成果并请主人接手。');
  if (previous?.length) {
    // 叫醒到第几轮先落盘：崩在"只预留、没叫醒"和"叫醒了、没记上"之间时，靠它和任务记录里的轮号对账（评审第 5 条）。
    rounds = action.resume?.length ? action.resume : await resumeRounds(previous);
    if (!action.resume?.length) {
      await updateAutopilot(id, current => {
        if (current.action?.token !== action.token) return;
        current.action.resume = rounds;
      });
    }
  }
    const { jobs } = await runner.start({
      run: id, token: action.token, project: run.project, taskId: run.taskId, who: run.who, ro: run.ro,
      node: action.node, attempt: action.attempt,
      ...(action.mode ? { mode: action.mode } : {}),
      ...(action.prompt ? { prompt: action.prompt } : {}),
      ...(previous?.length ? { previous: [...previous] } : {}),
      ...(rounds?.length ? { rounds } : {}),
    });
    await updateAutopilot(id, current => {
      if (current.action?.token !== action.token) return;
      current.action.jobs = jobs;
      advance(current, { kind: 'started' });
    });
    return 'acted';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateAutopilot(id, current => {
      if (current.action?.token !== action.token) return;
      const attempt = current.attempts.at(-1);
      if (attempt && attempt.token === action.token) { attempt.outcome = 'blocked'; attempt.note = redactText(message, 200); }
      if (action.mode === 'continue') advance(current, { kind: 'owner', code: 'resume_unverified', note: redactText(message, 120) });
      else advance(current, { kind: 'blocked', note: `没能派活：${redactText(message, 200)}` });
    });
    return 'ended';
  }
}

// 恢复待确认的动作（锁内重读登记）。两个崩溃窗口都在这里分开处理：
// - "记下意图、还没动手就崩了"：查不到证据 → 用同一个令牌补一次（工作从没开始，不算重复派活）。
// - "外面已经派完了、还没落盘就崩了"：找到带同一令牌的任务记录 → 只认领记账，不再派。
async function recover(id: string, deps: AutopilotDeps): Promise<'ended' | 'waiting' | 'acted' | 'idle'> {
  const runner = depsOf(deps);
  const run = await readAutopilot(id);
  const action = run.action;
  if (!action) return 'idle';                                   // 别人刚刚收完尾
  if (isEndedState(run.state)) return 'ended';                  // 收了：过期的动作再也不许派活
  if (action.mode === 'continue') return recoverContinue(id, action, deps);
  let jobs = action.jobs?.length ? action.jobs : undefined;
  if (!jobs) {
    const found = await runner.find(run, action);
    if (!found) return startAction(id, action, deps);
    await updateAutopilot(id, current => { if (current.action?.token === action.token) current.action.jobs = found; });
    jobs = found;
  }
  const state = await runner.inspect(jobs);
  if (state === 'running') return 'waiting';
  await settle(id, action, jobs, state === 'failed' ? 'failed' : 'done', deps);
  return 'acted';
}

// 续接的崩溃恢复（评审第 5 条）：令牌先后不能当证据——令牌在叫醒前就换掉时，"还没叫醒"和"叫醒了丢了结果"长得一样。
// 所以按登记里"叫醒到第几轮"和任务记录里的轮号对账：
// - 全部叫醒了：认领，按结果走（还在跑就等）；
// - 一件都没叫醒（记录还停在上一轮）：工作从没开始，用同一个令牌照原样再来一次，闸门照旧先过；
// - 只叫醒了一部分、叫醒了但没真正启动、登记里没有轮次：停掉已经叫醒的，交给主人，绝不把旧轮结果认成新轮。
async function recoverContinue(id: string, action: AutopilotAction, deps: AutopilotDeps): Promise<'ended' | 'waiting' | 'acted' | 'idle'> {
  const runner = depsOf(deps);
  const run = await readAutopilot(id);
  if (run.action?.token !== action.token) return 'idle';
  if (isEndedState(run.state)) return 'ended';
  const entries = action.resume ?? [];
  const giveUp = async (code: OwnerCode, note: string): Promise<'ended'> => {
    await updateAutopilot(id, current => {
      if (current.action?.token !== action.token) return;
      delete current.action;
      advance(current, { kind: 'owner', code, note });
    });
    return 'ended';
  };
  if (!entries.length) return giveUp('resume_unverified', '续接的轮次信息没落下，没法确认上一轮有没有被叫醒，请主人接手。');
  const woke: string[] = [];
  let prepared = false;
  for (const entry of entries) {
    let job: Job;
    try { job = await readJob(entry.job); }
    catch {
      if (woke.length) for (const item of woke) await runner.stopJob(item).catch(() => {});
      return giveUp('resume_unverified', '要续接的任务记录缺失或损坏，没法确认上一轮有没有被叫醒，请主人接手。');
    }
    if ((job.resume?.round ?? 1) < entry.round) continue;   // 还停在上一轮：这件没叫醒
    woke.push(job.id);
    // 轮号已经推到目标轮，但看管进程还没起来：准备了，没真正启动。
    if ((job.state === 'queued' || job.state === 'running') && !job.pid) prepared = true;
  }
  if (!woke.length) return startAction(id, action, deps);   // 一件都没叫醒：同一个令牌照原样再来一次
  if (woke.length !== entries.length) {
    for (const job of woke) await runner.stopJob(job).catch(() => {});
    return giveUp('resume_unverified', `只叫醒了 ${woke.length} / ${entries.length} 件活，已经停掉叫醒的那几件，请主人接手。`);
  }
  if (prepared) {
    for (const job of woke) await runner.stopJob(job).catch(() => {});
    return giveUp('resume_pending', '补做已经准备好，但没真正启动；副本和上一轮的改动都还在，请主人接手续跑。');
  }
  await updateAutopilot(id, current => { if (current.action?.token === action.token) current.action.jobs = woke; });
  const state = await runner.inspect(woke);
  if (state === 'running') return 'waiting';
  await settle(id, { ...action, jobs: woke }, woke, state === 'failed' ? 'failed' : 'done', deps);
  return 'acted';
}

// 用量按这一次实际花掉的记。job.usage 是"当前这一轮"的（续轮开始时清空），不是累计值，
// 所以这里不再相减——相减会把补做那一轮的用量整段扣掉（评审第 4 条）。
// 同一个令牌只记一次：崩溃重放时这一次尝试已经记过用量就跳过，不重复累加。
function recordUsage(run: AutopilotRun, action: AutopilotAction, usage: { read: number; cached: number; out: number } | undefined) {
  const attempt = run.attempts.find(item => item.token === action.token);
  if (!attempt || !usage || attempt.usage) return;
  const add = {
    read: Math.max(0, Math.round(usage.read)), cached: Math.max(0, Math.round(usage.cached)), out: Math.max(0, Math.round(usage.out)),
  };
  attempt.usage = add;
  if (!add.read && !add.cached && !add.out) return;
  run.usage ??= { read: 0, cached: 0, out: 0 };
  run.usage.read += add.read; run.usage.cached += add.cached; run.usage.out += add.out;
}

// 落盘一步的结果：只有令牌还是当前的那个推进器能写。
// 失败不再自己重试：先转 diagnosing，由只读负责人诊断（TASK-010）决定续做、重试、转验收、细拆还是交给主人。
async function settle(id: string, action: AutopilotAction, jobs: string[], outcome: 'done' | 'failed', deps: AutopilotDeps): Promise<void> {
  const usage = await depsOf(deps).usage(jobs).catch(() => undefined);
  const before = await readAutopilot(id);
  let candidate: string | undefined;
  if (before.flow) {
    try { candidate = await (deps.flow?.capture ?? captureAutopilotPatch)(before, 'writer'); }
    catch {
      await updateAutopilot(id, run => {
        if (run.action?.token !== action.token) return;
        const attempt = run.attempts.find(a => a.token === action.token);
        if (attempt) { attempt.outcome = 'blocked'; attempt.jobs = jobs; }
        recordUsage(run, action, usage);
        advance(run, { kind: 'owner', code: 'owner_requested', note: '写手成果或补丁快照无法核对，原成果保留。' });
      });
      return;
    }
  }
  await updateAutopilot(id, run => {
    if (run.action?.token !== action.token) return;
    const attempt: AutopilotAttempt | undefined = run.attempts.find(item => item.token === action.token);
    if (attempt) { attempt.outcome = outcome; attempt.jobs = jobs; if (candidate) attempt.patch = candidate; }
    const node = run.nodes.find(item => item.id === action.node);
    if (node) node.state = outcome === 'done' ? (run.flow ? 'running' : 'passed') : 'failed';
    recordUsage(run, action, usage);
    delete run.action;
    // 等恢复的登记（推进器中途没了）：先把状态接回"在干"，再把这一次的结果记账，否则转移会被状态机拒掉。
    if (run.state === 'recovering') advance(run, { kind: 'resume' });
    if (outcome === 'done') {
      // 骨架：这一步做完了，但自动审查与验收还没接（TASK-009/TASK-011 的范围之外），结果交给主人。
      if (!advance(run, { kind: 'done' })) return;
      if (run.flow && candidate) { run.flow.candidate = { hash: candidate, node: action.node, jobs }; return; }
      advance(run, { kind: 'blocked', note: `无人看守这一版还没有自动审查和验收，${action.node} 的这次执行结果请主人接手看。` });
      return;
    }
    advance(run, { kind: 'failed', note: `${action.node} 这一次没成（第 ${action.attempt} 次尝试），等待自动故障诊断。` });
  });
}

// 请诊断的第一步：确认要不要诊断、领一个诊断令牌、把这次诊断记进登记，然后真的去请。
async function diagnose(id: string, deps: AutopilotDeps): Promise<'ended' | 'waiting' | 'acted' | 'idle'> {
  const run = await readAutopilot(id);
  if (isEndedState(run.state) || run.action || run.state !== 'diagnosing') return 'idle';
  const attempt = run.attempts.at(-1);
  if (!attempt) {
    await updateAutopilot(id, current => {
      if (isEndedState(current.state) || current.action) return;
      advance(current, { kind: 'blocked', note: '要在诊断这一步接着走，登记里得有一次失败的尝试，但现在没有；请主人接手。' });
    });
    return 'ended';
  }
  const left = diagnosesLeft(run, attempt.node);
  if (left <= 0) {
    await updateAutopilot(id, current => {
      if (isEndedState(current.state) || current.action) return;
      advance(current, { kind: 'owner', code: 'recovery_budget', note: `${attempt.node} 已经请过 ${MAX_DIAGNOSES_PER_NODE} 次诊断` });
    });
    return 'ended';
  }
  const holder: { action?: AutopilotAction } = {};
  await updateAutopilot(id, current => {
    if (isEndedState(current.state) || current.action || current.state !== 'diagnosing') return;
    const at = new Date().toISOString();
    const action: AutopilotAction = { token: newToken(), node: attempt.node, attempt: attempt.attempt, at, phase: 'diagnose' };
    current.action = action;
    const diagnosis: AutopilotDiagnosis = {
      node: attempt.node, attempt: attempt.attempt, at, token: action.token,
      // 指纹要在派发时按证据算（见 dispatchDiagnosis），这里先占位；派不出去时这条记录留着当"请过没成"的证据。
      fingerprint: '0000000000000000',
    };
    (current.diagnoses ??= []).push(diagnosis);
    holder.action = action;
  });
  if (!holder.action) return 'idle';
  return dispatchDiagnosis(id, holder.action, deps);
}

// 真的去请只读负责人：整理证据 → 算指纹 → 写进诊断记录 → 派活。崩溃后用同一个令牌补派，不会另起一次诊断。
async function dispatchDiagnosis(id: string, action: AutopilotAction, deps: AutopilotDeps): Promise<'ended' | 'acted' | 'idle'> {
  const runner = depsOf(deps);
  const run = await readAutopilot(id);
  if (isEndedState(run.state) || run.action?.token !== action.token) return 'idle';
  // 诊断针对的是这个节点最近一次写手尝试（诊断自己不占尝试序号）。
  const source = run.attempts.filter(item => item.node === action.node).at(-1);
  if (!source) {
    await updateAutopilot(id, current => {
      if (current.action?.token !== action.token) return;
      delete current.action;
      advance(current, { kind: 'blocked', note: '诊断缺少要诊断的那一次尝试记录，请主人接手。' });
    });
    return 'ended';
  }
  let evidence: DiagnosisEvidence;
  try { evidence = await runner.evidence(run, source); }
  catch { await failDiagnosis(id, action.token, 'diagnosis_crashed'); return 'ended'; }
  const fingerprint = evidenceFingerprint(evidence);
  await updateAutopilot(id, current => {
    if (current.action?.token !== action.token) return;
    const entry = diagnosesOf(current).find(item => item.token === action.token);
    if (!entry) return;
    entry.fingerprint = fingerprint;
    // 确认不了就不写（不写成 0）：缺这一项和"确认干净"在重做时是不一样的结论。
    if (evidence.unacceptedChanges === null) delete entry.changes;
    else entry.changes = evidence.unacceptedChanges;
  });
  const who = run.flow?.reviewer ?? diagnosisChoice(run);
  let started: { jobs: string[] } | { refused: DiagnosisRefusal };
  try {
    started = await runner.startDiagnosis({
      run: id, token: action.token, project: run.project, taskId: run.taskId, who, node: action.node,
      attempt: action.attempt, fingerprint, packet: buildPacket(evidence),
    });
  } catch {
    await failDiagnosis(id, action.token, 'diagnosis_crashed');
    return 'ended';
  }
  if ('refused' in started) {
    if (started.refused.kind === 'quota') {
      await failDiagnosis(id, action.token, 'diagnosis_quota_rejected', started.refused.note);
      return 'ended';
    }
    await updateAutopilot(id, current => {
      if (current.action?.token !== action.token) return;
      delete current.action;
      advance(current, { kind: 'blocked', note: `没能派出只读故障诊断：${started.refused.note}` });
    });
    return 'ended';
  }
  const jobs = started.jobs.filter(item => typeof item === 'string' && item.length > 0);
  if (!jobs.length) { await failDiagnosis(id, action.token, 'diagnosis_crashed'); return 'ended'; }
  await updateAutopilot(id, current => {
    if (current.action?.token !== action.token) return;
    current.action.jobs = jobs;
    const entry = diagnosesOf(current).find(item => item.token === action.token);
    if (entry) entry.jobs = jobs;
  });
  return 'acted';
}

// 诊断没成：记下原因码，有界结束为 needs_owner。原因码是固定的，不带原始响应、不带密钥。
async function failDiagnosis(id: string, token: string, code: OwnerCode, note?: string): Promise<void> {
  await updateAutopilot(id, run => {
    if (run.action?.token !== token) return;
    const entry = diagnosesOf(run).find(item => item.token === token);
    if (entry) entry.code = code;
    delete run.action;
    if (run.state === 'recovering') advance(run, { kind: 'resume', phase: 'diagnose' });
    advance(run, { kind: 'owner', code, ...(note ? { note } : {}) });
  });
}

// 恢复一份诊断动作：和写手那一步一样的两个崩溃窗口，只是收尾交给 settleDiagnosis。
async function recoverDiagnosis(id: string, deps: AutopilotDeps): Promise<'ended' | 'waiting' | 'acted' | 'idle'> {
  const runner = depsOf(deps);
  const run = await readAutopilot(id);
  const action = run.action;
  if (!action || action.phase !== 'diagnose') return 'idle';
  if (isEndedState(run.state)) return 'ended';
  let jobs = action.jobs?.length ? action.jobs : undefined;
  if (!jobs) {
    const found = await runner.find(run, action);
    if (!found) return dispatchDiagnosis(id, action, deps);   // 记了意图还没动手：同一个令牌补一次
    await updateAutopilot(id, current => {
      if (current.action?.token !== action.token) return;
      current.action.jobs = found;
      const entry = diagnosesOf(current).find(item => item.token === action.token);
      if (entry) entry.jobs = found;
    });
    jobs = found;
  }
  const result = await runner.diagnose(jobs);
  if (result.state === 'running') return 'waiting';
  // 诊断针对的是这个节点最近一次写手尝试：重做之前要用它的副本再做一次权威核对。
  const source = run.attempts.filter(item => item.node === action.node).at(-1)?.jobs ?? [];
  await settleDiagnosis(id, action, jobs, result, deps, source);
  // 收下诊断之后要么接着走，要么当场有界结束（循环、交给主人、次数用完）：两种都如实报回去。
  return isEndedState((await readAutopilot(id)).state) ? 'ended' : 'acted';
}

// 收下诊断结果并按受控动作推进。这里是"AI 说什么"和"平台允许什么"的分界线：
// 解析、白名单、动作与证据是否相容（有改动不许 retry、次数和预算够不够、是不是在循环）都在这一处，
// 不过关的一律有界结束为 needs_owner，绝不执行一半。
async function settleDiagnosis(
  id: string, action: AutopilotAction, jobs: string[], result: DiagnosisSettled, deps: AutopilotDeps, sourceJobs: string[] = [],
): Promise<void> {
  const runner = depsOf(deps);
  const usage = await runner.usage(jobs).catch(() => undefined);
  // 选"重做"时，真正动手前再用原副本当前的 Git 状态权威核对一次：诊断那一刻的快照可能已经过期，
  // 上游/外部也可能在这中间往副本里放过东西。确认不了就当"不能推断干净"，一律不重做（评审第 3 条）。
  let fresh: number | null | undefined;
  if (result.state === 'done') {
    const probe = parseDiagnosis(result.text);
    if (probe.ok && probe.reply.action === 'retry') fresh = await runner.changes(sourceJobs).catch(() => null);
  }
  // 诊断没成（超时、崩溃、丢了）：先把它留下的进程收干净，再落盘原因码，保证结束之后没有活着的进程。
  if (result.state === 'failed') for (const job of jobs) await runner.stopJob(job).catch(() => {});
  await updateAutopilot(id, run => {
    if (run.action?.token !== action.token) return;
    const entry = diagnosesOf(run).find(item => item.token === action.token);
    if (entry) entry.jobs = jobs;
    delete run.action;
    // 推进器中途没了再回来：先把状态接回"在诊断"，不然下面的决定会被状态机拒掉。
    if (run.state === 'recovering') advance(run, { kind: 'resume', phase: 'diagnose' });
    if (!entry) {
      advance(run, { kind: 'blocked', note: '诊断记录不见了，没法按它推进；请主人接手。' });
      return;
    }
    // 诊断自己不占写手的尝试序号，但它花掉的用量照样算进这台执行的预算。
    if (usage && !entry.usage) {
      entry.usage = { ...usage };
      run.usage ??= { read: 0, cached: 0, out: 0 };
      run.usage.read += usage.read; run.usage.cached += usage.cached; run.usage.out += usage.out;
    }
    if (result.state === 'failed') {
      const code: OwnerCode = result.kind === 'quota' ? 'diagnosis_quota_exhausted'
        : result.kind === 'timeout' ? 'diagnosis_timeout' : 'diagnosis_crashed';
      entry.code = code;
      advance(run, { kind: 'owner', code });
      return;
    }
    const parsed = parseDiagnosis(result.text);
    if (!parsed.ok) {
      entry.code = 'diagnosis_invalid';
      entry.note = redactText(parsed.problem, 300);
      advance(run, { kind: 'owner', code: 'diagnosis_invalid', note: redactText(parsed.problem, 120) });
      return;
    }
    const reply = parsed.reply;
    // 同一份证据又得到同样的动作：这是循环，停下来交给主人，不再执行。
    if (diagnosesOf(run).some(item => item.token !== entry.token && item.action === reply.action && item.fingerprint === entry.fingerprint)) {
      entry.code = 'diagnosis_loop';
      entry.note = redactText(reply.reason, 300);
      advance(run, { kind: 'owner', code: 'diagnosis_loop' });
      return;
    }
    const node = run.nodes.find(item => item.id === action.node);
    if (!node) {
      advance(run, { kind: 'blocked', note: `诊断说的节点 ${action.node} 已经不在登记里，请主人接手。` });
      return;
    }
    // 依据和补充说明都只是文字：记进登记前先脱敏、按长度截断。
    entry.note = redactText(reply.reason, 300);
    const reject = (code: OwnerCode, note?: string) => {
      entry.code = code;
      advance(run, { kind: 'owner', code, ...(note ? { note: redactText(note, 120) } : {}) });
    };
    switch (reply.action) {
      case 'owner':
        entry.action = 'owner';
        advance(run, { kind: 'owner', code: 'owner_requested', note: redactText(reply.ownerReason, 120) });
        return;
      case 'continue': {
        if (!canContinue(run, node.id)) { reject('recovery_budget', `${node.id} 的补做次数或预算已经用完`); return; }
        node.continues += 1;
        run.nextPrompt = { node: node.id, mode: 'continue', prompt: reply.prompt };
        if (!advance(run, { kind: 'continue' })) { reject('recovery_budget', '这一台执行现在不能开始补做'); return; }
        entry.action = 'continue';
        return;
      }
      case 'retry': {
        // 有没被接受的改动时不许从头重做：那等于把已经写好的代码丢掉。确认不了也算不许。
        const changes = fresh;
        if (changes === undefined || changes === null) {
          reject('retry_unverified_changes', '没能确认上一轮副本里还有没有没被接受的改动'); return;
        }
        entry.changes = changes;
        if (changes > 0) { reject('retry_refused_changes', `上一轮有 ${changes} 个文件还没被接受`); return; }
        if (!canRetry(run, node.id)) { reject('recovery_budget', `${node.id} 的重试次数或预算已经用完`); return; }
        node.retries += 1;
        run.nextPrompt = { node: node.id, mode: 'retry', prompt: reply.prompt || '按原任务目标重试，保留原成果证据。' };
        if (!advance(run, { kind: 'retry' })) { reject('recovery_budget', '这一台执行现在不能重试'); return; }
        entry.action = 'retry';
        return;
      }
      case 'verify':
        if (!advance(run, { kind: 'verify' })) { reject('diagnosis_invalid', '状态机不接受转验收'); return; }
        entry.action = 'verify';
        return;
      case 'split': {
        // 只存候选图，不执行（执行留给 TASK-011）；节点数还要按这台执行剩下的节点预算复查一遍。
        const remaining = run.policy.nodes - run.nodeCount;
        if (reply.nodes.length > remaining) {
          reject('recovery_budget', `候选图 ${reply.nodes.length} 个节点，这台执行只剩 ${remaining} 个节点的预算`);
          return;
        }
        entry.action = 'split';
        run.split = {
          at: new Date().toISOString(), source: redactText(reply.reason, 200),
          nodes: reply.nodes.map(item => ({ ...item, deps: [...item.deps] })),
        };
        if (run.flow) {
          if (!activateFlowSplit(run, node.id, reply.nodes)) reject('recovery_budget', '细拆深度、节点编号或剩余预算不满足约束');
          return;
        }
        advance(run, { kind: 'owner', code: 'split_pending' });
        return;
      }
      default:
        reject('diagnosis_invalid');
    }
  });
}

// 转成"等验收"之后：自动验收还没接到这一版（TASK-011），有界结束，不留推进器空转。
async function endVerify(id: string): Promise<'ended'> {
  await updateAutopilot(id, run => {
    if (isEndedState(run.state) || run.state !== 'verifying') return;
    advance(run, { kind: 'owner', code: 'verify_pending' });
  });
  return 'ended';
}

// 推进器主体：单飞轮。已有活着的推进器时这个进程直接退出（同一台执行只有一个推进器）。
export async function runAutopilot(id: string, deps: AutopilotDeps = {}): Promise<void> {
  if (inProcess.has(id)) { console.error('无人看守的推进进程已经在跑，这个进程退出。'); return; }
  inProcess.add(id);
  let stopping = false;
  const onStop = () => { stopping = true; };
  process.on('SIGTERM', onStop); process.on('SIGINT', onStop);
  const clock = deps.now ?? Date.now;
  try {
    // 执行权在登记锁里复核并领取：先读后写会留下"两个进程都看到没有推进器、各写各的 pid"的窗口，
    // 所以"看有没有活的推进器"和"把 pid 写成自己"必须在同一次锁内改写里做完。
    const claim: { ok: boolean; taken: boolean } = { ok: false, taken: false };
    await updateAutopilot(id, run => {
      if (!isActiveState(run.state)) return;
      if (engineAlive(run) && run.pid !== process.pid) { claim.taken = true; return; }
      run.pid = process.pid;
      const since = processSince(process.pid);
      if (since === undefined) delete run.pidSince; else run.pidSince = since;
      claim.ok = true;
    });
    if (!claim.ok) {
      console.error(claim.taken ? '无人看守的推进进程已经在跑，这个进程退出。' : '无人看守已经停下，这个进程退出。');
      return;
    }
    let previous = clock();
    while (!stopping) {
      const elapsedBefore = (await readAutopilot(id)).elapsedSeconds;
      const result = await stepAutopilot(id, deps);
      if (result === 'ended') return;
      const now = clock();
      // 运行时长按秒累计，扣掉电脑休眠（两次采样间隔超过一分钟就当睡过）。
      const gapMs = now - previous;
      await updateAutopilot(id, run => {
        if (!isActiveState(run.state)) return;
        if (gapMs > SLEEP_GAP_MS && !run.flow) run.sleeps += gapMs / 1000;
        else run.elapsedSeconds += Math.max(0, gapMs / 1000 - Math.max(0, run.elapsedSeconds - elapsedBefore));
      });
      previous = now;
      // 等外部工作、或者没活可干，都歇一轮再走，绝不热循环。
      if (result === 'waiting' || result === 'idle') {
        try { await sleep(deps.pollMs ?? POLL_MS); } catch { return; }
        continue;
      }
      // 刚做完一步：立刻再走一步（多半是"活干完了转交主人"这种收尾），但先让出一次事件循环。
      await sleep(0);
    }
  } finally {
    process.off('SIGTERM', onStop); process.off('SIGINT', onStop);
    inProcess.delete(id);
    // 自己走完了就把进程号清掉：登记里不留一个已经不在的 pid。别人的 pid 一个字都不碰。
    await updateAutopilot(id, run => {
      if (run.pid === process.pid && isEndedState(run.state)) { delete run.pid; delete run.pidSince; }
    }).catch(() => {});
  }
}

// 受控启动：登记建好后才叫推进器。登记建不成（不可执行任务、非法预算、非法选手）在这里就失败，不留进程。
// 叫不起来（spawn 出错）也不留"活跃但没有推进器"的半截状态：记成等恢复，下一次启动接着走。
export async function startAutopilot(
  options: AutopilotStartOptions, deps: { launch?: (id: string) => Promise<void> } = {},
): Promise<AutopilotRun> {
  const run = await createAutopilot(options);
  try { await (deps.launch ?? launchAutopilotEngine)(run.id); }
  catch (error) {
    await markLost(run.id, '推进进程没能启动，用 autopilot resume 接着起来。').catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`推进器没能启动（${message}）。登记 ${run.id} 已经留好，用 xagents autopilot resume ${run.id} 接着起来。`);
  }
  return readAutopilot(run.id);
}

// 受控恢复：只接编号，别的什么都不接。原任务、选手、权限、联网快照、预算和动作令牌一个字都不改，
// 只是把推进器重新叫起来接着走（不会建新登记，也就不会另起一台）。
// 结束的、读不出来的登记一律拒绝；已经有活着的推进器也拒绝，不重复启动。
export async function resumeAutopilot(
  id: string, deps: { launch?: (id: string) => Promise<boolean> } = {},
): Promise<AutopilotRun> {
  const run = await readAutopilot(id);
  if (isEndedState(run.state)) {
    throw new Error(`无人看守 ${id} 已经停在「${stateNames[run.state]}」，不用恢复；要重来请用 xagents autopilot start 另开一台。`);
  }
  const launched = await (deps.launch ?? launchAutopilotEngine)(id);
  const now = await readAutopilot(id);
  if (!launched) {
    if (isEndedState(now.state)) throw new Error(`无人看守 ${id} 已经停在「${stateNames[now.state]}」，不用恢复。`);
    throw new Error(`无人看守 ${id} 的推进器已经在跑（进程号 ${String(now.pid)}），不用恢复；用 xagents autopilot status ${id} 看进展。`);
  }
  return now;
}

// 叫起推进器。返回值：true 表示这次真的起了新进程，false 表示已经有推进器在跑或者登记已经结束。
// "有没有活的推进器"和"把 pid 记成新进程"在同一个登记锁里复核，不会两边各起一台。
export async function launchAutopilotEngine(id: string): Promise<boolean> {
  const entry = await engineSnapshot(autopilotDir(id), 'autopilot-entry.ts');
  const fd = await open(join(autopilotDir(id), 'engine.log'), 'a', 0o600);
  const launched = { ok: false };
  try {
    await updateAutopilot(id, async run => {
      if (!isActiveState(run.state)) return;
      if (engineAlive(run)) return;
      const node = nodeCommand([entry, id], engineEnvironment());
      const child = spawn(node.file, node.args, { ...backgroundSpawn(), stdio: ['ignore', fd.fd, fd.fd], env: node.env });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      const since = processSince(child.pid);
      if (since === undefined) delete run.pidSince; else run.pidSince = since;
      run.pid = child.pid;
      launched.ok = true;
    });
  } finally { await fd.close(); }
  return launched.ok;
}

// 受控停止：先停推进器，再停它派出去的活（含诊断），最后落盘 stopped。停下之后不留推进器进程。
export async function stopAutopilot(id: string, deps: AutopilotDeps = {}): Promise<AutopilotRun> {
  const runner = depsOf(deps);
  const before = await readAutopilot(id);
  if (isEndedState(before.state)) return before;
  // 先拿这台执行的动作锁：正在派活的那一步要么先把任务号写回来（我们随后把它停掉），
  // 要么已经发现"收了"而根本不派。停下之后再进来的一步，只会在锁里读到 stopped 然后什么都不做。
  return withLock(actionLockDir(id), async () => {
    const run = await readAutopilot(id);
    if (isEndedState(run.state)) return run;
    await killEngine(run.pid, run.pidSince);
    const jobs = new Set(allJobs(run));
    if (run.action && !run.action.jobs?.length) {
      const found = await runner.find(run, run.action).catch(() => null);
      for (const job of found ?? []) jobs.add(job);
    }
    for (const job of jobs) await runner.stopJob(job).catch(() => {});
    return updateAutopilot(id, current => {
      if (isEndedState(current.state)) return;
      advance(current, { kind: 'stop', note: '主人收手了：推进器和在动的活都停下了。' });
      delete current.pid; delete current.pidSince;
    });
  }, ACTION_LOCK_WAIT_MS);
}

// 推进器还在不在：只有进程号合法、进程真的还在、启动时间也对得上，才算它自己的推进器。
// pid 为 0、负数、或者 pidSince 对不上（进程号被别人复用了），一律当"不是它"。
export function engineAlive(run: { pid?: number; pidSince?: number }): boolean {
  if (!Number.isInteger(run.pid) || (run.pid as number) <= 0) return false;
  if (run.pidSince !== undefined) {
    let since: number | undefined;
    // Windows 读不到出生时间就说明进程已经不在；macOS 那边一律拿不到，只按进程号判。
    try { since = processSince(run.pid); } catch { return false; }
    if (since !== undefined && since !== run.pidSince) return false;   // 进程号被别人复用了
  }
  return alive(run.pid, run.pidSince);
}

// 推进器丢了：原子地把活跃登记转成 recovering 并清掉无效的进程号，写明原因。
// 只在锁里再确认一次——可能刚好有推进器接手，那就一个字都不改。
async function markLost(id: string, note = `推进进程不在了，用 xagents autopilot resume ${id} 接着走。`): Promise<AutopilotRun> {
  return updateAutopilot(id, current => {
    if (!isActiveState(current.state) || engineAlive(current)) return;
    if (current.state === 'recovering') { current.reason = note; }
    else advance(current, { kind: 'lost', note });
    delete current.pid; delete current.pidSince;
  });
}

// 只读列表和启动命令用：活跃登记却没有推进器（新建没叫起来、进程号非法、进程已经死了）都记成等恢复，
// 不让它永久卡在 planning/executing。结束状态（已归档、等主人、已停止）一个字都不动。
export async function reconcileAutopilot(run: AutopilotRun): Promise<AutopilotRun> {
  if (!isActiveState(run.state) || engineAlive(run)) return run;
  try { return await markLost(run.id); }
  catch (error) {
    if (hasCode(error, 'ENOENT')) return run;
    throw error;
  }
}
