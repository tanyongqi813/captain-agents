import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildLeadReviewPacket, parseLeadReview, LEAD_REVIEW_OPEN, LEAD_REVIEW_CLOSE } from './lead-review.ts';
import type { LeadReviewReply } from './lead-review.ts';
import { compileLeadCapsules } from './lead-capsule.ts';
import type { LeadCapsuleCompilation } from './lead-capsule.ts';
import { capsuleFingerprint, contractMetadata, loadHandoffFiles, sourceAnchors } from './task-plan.ts';
import type { DispatchCapsule } from './task-plan.ts';
import type { AutopilotAction, AutopilotRun, AutopilotReview } from './autopilot.ts';
import { selection } from './workers.ts';
import { vendorOf } from './roster.ts';
import { readyTask } from './plan-dispatch.ts';
import { samePath } from './platform.ts';
import { hasCode } from './fsx.ts';
import { readJob } from './job.ts';
import { jobDir } from './paths.ts';
import { assertAutopilotWorktree } from './autopilot-worktree.ts';
import { git } from './worktree.ts';

export type LeadDecision = { token: string; node: string; at: string; jobs: string[]; reply: LeadReviewReply; compilation?: LeadCapsuleCompilation };
export type LeadRuntime = { version: 1; authority: string; origin: DispatchCapsule; decisions: LeadDecision[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: unknown, allowed: readonly string[]) => object(v) && Object.keys(v).every(k => allowed.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const fail = (): never => { throw new Error('负责人运行记录或制品绑定不合法，未继续执行。'); };
export function trustedLead(who: string): boolean {
  try { return vendorOf(selection(who).who) === 'codex'; } catch { return false; }
}
function wire(reply: LeadReviewReply): string {
  const body = { schema: 1, action: reply.action, reason: reply.reason, ...reply.binding,
    ...(reply.action === 'correct' ? { change: { goal: reply.proposal.goal, acceptance: reply.proposal.acceptance } } : {}),
    ...(reply.action === 'split' ? { nodes: reply.proposal.nodes } : {}) };
  return `${LEAD_REVIEW_OPEN}\n${JSON.stringify(body)}\n${LEAD_REVIEW_CLOSE}`;
}
function body(capsule: string, name: string): string {
  const parts = capsule.replace(/\r\n?/g, '\n').split(/^##\s+(.+?)\s*$/m);
  const index = parts.indexOf(name); if (index < 0) return fail();
  return parts[index + 1];
}
const quote = (text: string) => text.split(/\r\n?|\n|\u2028|\u2029/).map(line => `> ${line}`).join('\n');
const IMMUTABLE = ['源码锚点（最多 5 个）', '修改白名单', '明确非目标', '定向验证（最多 5 条）', '禁止验证', '已知基线失败', '单次执行预算', '停止条件', '精简 Implementation Report（固定格式）'];
function checkCompilation(compilation: LeadCapsuleCompilation, reply: LeadReviewReply, origin: DispatchCapsule): void {
  if (!keys(compilation, ['kind', 'action', 'source', 'findingIds', 'capsules']) || compilation.kind !== 'uncommitted-capsule-proposals'
    || compilation.action !== reply.action || !isDeepStrictEqual(compilation.source, reply.binding)
    || !Array.isArray(compilation.findingIds) || compilation.findingIds.length !== 1 || !/^F-\d{2,}$/.test(compilation.findingIds[0])
    || !Array.isArray(compilation.capsules)) return fail();
  const count = reply.action === 'correct' ? 1 : reply.action === 'split' ? reply.proposal.nodes.length : 0;
  if (!count || compilation.capsules.length !== count) return fail();
  for (const [i, c] of compilation.capsules.entries()) {
    const attempt = String(Number(origin.attempt) + i + 1).padStart(2, '0');
    if (!keys(c, ['rel', 'attempt', 'text', 'fingerprint', 'node', 'dependsOn']) || c.attempt !== attempt
      || c.rel !== `docs/execution/${origin.taskId}/attempt-${attempt}.md` || typeof c.text !== 'string'
      || !hash(c.fingerprint) || c.fingerprint !== capsuleFingerprint(c.text)) return fail();
    const expectedNode = reply.action === 'split' ? reply.proposal.nodes[i] : null;
    if (c.node !== (expectedNode?.id ?? null) || !isDeepStrictEqual(c.dependsOn, expectedNode?.deps ?? [])) return fail();
    buildLeadReviewPacket({ event: 'completed', capsule: { taskId: origin.taskId, attempt, text: c.text }, candidate: reply.binding.candidate,
      report: null, diffSummary: null, activity: null, verification: null,
      budget: { minutesLeft: 0, attemptsLeft: 0, nodesLeft: 0, usageTokensLeft: null } });
    for (const s of IMMUTABLE) if (body(c.text, s) !== body(origin.text, s)) return fail();
    const header = contractMetadata(c.text.split(/^##\s/m, 1)[0]), original = contractMetadata(origin.text.split(/^##\s/m, 1)[0]);
    if (!isDeepStrictEqual(header, { ...original, attempt, dispatch_state: 'READY', revision_reason: 'changes_requested' })) return fail();
    const ids = [...body(c.text, 'Active findings').matchAll(/^- `(F-\d+)`\s*$/gm)].map(m => m[1]);
    if (!isDeepStrictEqual(ids, compilation.findingIds)) return fail();
    const goal = reply.action === 'correct' ? reply.proposal.goal : expectedNode!.goal;
    const acceptance = reply.action === 'correct' ? reply.proposal.acceptance : [expectedNode!.acceptance];
    if (body(c.text, '本轮唯一目标').trim() !== quote(goal)
      || body(c.text, '本轮验收切片').trim() !== acceptance.map((item, n) => quote(`${n + 1}. ${item}`)).join('\n')
      || body(c.text, 'Active findings').trim() !== `${compilation.findingIds.map(id => `- \`${id}\``).join('\n')}\n\n${quote(reply.reason)}`) return fail();
    const facts = body(origin.text, '已确认事实（禁止重新推导）').trim() + '\n\n- 本轮只处理当前 findings，原执行边界及已接受成果保持不变。'
      + (expectedNode ? `\n- 平台子节点：${expectedNode.id}；前置子节点：${expectedNode.deps.join(', ') || 'none'}；必须由运行侧核对已接受依赖后才可启动。` : '');
    if (body(c.text, '已确认事实（禁止重新推导）').trim() !== facts) return fail();
  }
}
// 读登记和每次写入前共用。没有 lead 字段的旧记录不进入这里，不做隐式升级。
export function assertLeadRuntime(value: unknown, context: { taskId: string; reviewer: string; reviews: AutopilotReview[] }): asserts value is LeadRuntime {
  if (!keys(value, ['version', 'authority', 'origin', 'decisions'])) return fail();
  const v = value as LeadRuntime;
  if (v.version !== 1 || v.authority !== context.reviewer || !trustedLead(v.authority)
    || !keys(v.origin, ['taskId', 'attempt', 'rel', 'text', 'fingerprint', 'anchors'])
    || v.origin.taskId !== context.taskId || v.origin.rel !== `docs/execution/${context.taskId}/attempt-${v.origin.attempt}.md`
    || typeof v.origin.text !== 'string' || v.origin.fingerprint !== capsuleFingerprint(v.origin.text)
    || !isDeepStrictEqual(v.origin.anchors, sourceAnchors(v.origin.text)) || !Array.isArray(v.decisions)
    || v.decisions.length > context.reviews.length) return fail();
  buildLeadReviewPacket({ event: 'completed', capsule: v.origin, candidate: '0'.repeat(64), report: null, diffSummary: null, activity: null,
    verification: null, budget: { minutesLeft: 0, attemptsLeft: 0, nodesLeft: 0, usageTokensLeft: null } });
  const tokens = new Set<string>();
  for (const d of v.decisions) {
    if (!keys(d, ['token', 'node', 'at', 'jobs', 'reply', 'compilation']) || !text(d.token, 200) || tokens.has(d.token)
      || !text(d.node, 200) || typeof d.at !== 'string' || !Number.isFinite(Date.parse(d.at)) || !Array.isArray(d.jobs) || !d.jobs.length
      || !object(d.reply)) return fail();
    tokens.add(d.token);
    const entry = context.reviews.find(r => r.token === d.token);
    if (!entry || entry.node !== d.node || !isDeepStrictEqual(entry.jobs, d.jobs) || !hash(entry.candidate)) return fail();
    const parsed = parseLeadReview(wire(d.reply), { candidate: entry.candidate, capsule: v.origin.fingerprint });
    if (!parsed.ok || !isDeepStrictEqual(parsed.reply, d.reply)) return fail();
    if (entry.verdict !== (d.reply.action === 'accept' ? 'pass' : ['correct', 'split'].includes(d.reply.action) ? 'changes' : 'unclear')) return fail();
    if (d.reply.action === 'correct' || d.reply.action === 'split') {
      if (!d.compilation) return fail();
      checkCompilation(d.compilation, d.reply, v.origin);
      if (d.compilation.findingIds[0] !== `F-${String(context.reviews.indexOf(entry) + 1).padStart(2, '0')}`) return fail();
    } else if (d.compilation !== undefined) return fail();
  }
  if (context.reviews.some(r => r.verdict !== undefined && !tokens.has(r.token))) return fail();
}
export function makeLeadRuntime(origin: DispatchCapsule, authority: string): LeadRuntime {
  const value: LeadRuntime = { version: 1, authority, origin: structuredClone(origin), decisions: [] };
  assertLeadRuntime(value, { taskId: origin.taskId, reviewer: authority, reviews: [] }); return value;
}
export async function assertLeadOrigin(run: AutopilotRun) {
  const lead = run.flow?.lead; if (!lead) return fail();
  const current = await readyTask(run.project, run.taskId);
  if (!samePath(current.project.repo, run.repo) || current.capsule.rel !== lead.origin.rel
    || current.capsule.fingerprint !== lead.origin.fingerprint) throw new Error('负责人运行的原胶囊或项目已改变，请主人核对后重新派发。');
  return current.capsule;
}
async function optionalReport(id: string): Promise<string | null> {
  const file = join(jobDir(id), 'report.md');
  try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 256_000) return fail(); return await readFile(file, 'utf8'); }
  catch (error) { if (hasCode(error, 'ENOENT')) return null; throw error; }
}
export async function leadPacket(run: AutopilotRun): Promise<string> {
  await assertLeadOrigin(run);
  const lead = run.flow!.lead!, candidate = run.flow!.candidate;
  if (!candidate || candidate.jobs.length !== 1) return fail();
  const job = await readJob(candidate.jobs[0]), writer = await assertAutopilotWorktree(run, 'writer');
  if (job.autopilot?.run !== run.id || job.autopilotRole !== 'writer' || !samePath(job.worktree, writer.worktree)
    || ['running', 'queued'].includes(job.state)) return fail();
  const diff = await git(writer.worktree, ['diff', '--stat', run.base, '--']);
  const untracked = (await git(writer.worktree, ['ls-files', '--others', '--exclude-standard'])).trim();
  const verify = run.flow!.verification;
  const event = verify && !verify.ok ? 'verify_failed' : job.termination ? 'interrupted' : job.state === 'done' ? 'completed' : 'failed';
  const usage = run.usage ? run.usage.read + run.usage.out : null;
  return buildLeadReviewPacket({ event, capsule: lead.origin, candidate: candidate.hash,
    report: await optionalReport(job.id), diffSummary: `${diff}\n未跟踪文件：\n${untracked || '无'}`,
    activity: job.activity ? job.activity.slice(-12).map(a => `${a.kind}: ${a.text}`).join('\n') : null,
    verification: verify ? { ok: verify.ok, summary: verify.steps.map(s => s.summary).join('\n') } : null,
    budget: { minutesLeft: Math.max(0, run.policy.minutes - run.elapsedSeconds / 60),
      attemptsLeft: Math.max(0, run.policy.attempts - run.attemptCount - run.flow!.reviews.length - (run.diagnoses?.length ?? 0)),
      nodesLeft: Math.max(0, run.policy.nodes - run.nodeCount), usageTokensLeft: run.usageLimit === undefined || usage === null ? null : Math.max(0, run.usageLimit - usage) },
    redact: { repo: run.repo, worktree: writer.worktree } }).text;
}
export async function makeLeadDecision(run: AutopilotRun, action: AutopilotAction, report: string, jobs: string[]): Promise<LeadDecision> {
  await assertLeadOrigin(run);
  const lead = run.flow!.lead!, candidate = run.flow!.candidate;
  if (!candidate || run.action?.token !== action.token || action.phase !== 'review') return fail();
  const writer = await assertAutopilotWorktree(run, 'writer');
  const parsed = parseLeadReview(report, { candidate: candidate.hash, capsule: lead.origin.fingerprint }, { repo: run.repo, worktree: writer.worktree });
  if (!parsed.ok) throw new Error('负责人回包无效或版本过期，未接受成果。');
  const decision: LeadDecision = { token: action.token, node: action.node, at: new Date().toISOString(), jobs: [...jobs], reply: parsed.reply };
  if (parsed.reply.action === 'correct' || parsed.reply.action === 'split') {
    const files = await loadHandoffFiles(run.repo);
    decision.compilation = compileLeadCapsules({ files, taskId: run.taskId, currentAttempt: lead.origin.attempt,
      candidate: candidate.hash, replyText: wire(parsed.reply), findingIds: [`F-${String(run.flow!.reviews.length).padStart(2, '0')}`] });
  }
  return decision;
}
