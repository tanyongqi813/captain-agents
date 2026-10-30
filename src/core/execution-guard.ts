// 仅纯判定与停止计划，不持有PID、不发信号、不表示真实启用权限。
import { progressEvidence } from './execution-progress.ts';
import type { ProgressState } from './execution-progress.ts';
export type GuardPolicy = { firstEventMs: number; unfinishedReadMs: number; graceMs: number; calibration: string | null };
export type GuardReason = 'first-event-wait' | 'unfinished-read' | 'repeated-read';
type Warning = { reason: GuardReason; key: string; since: number };
export type GuardPlan = { jobId: string; round: number; reason: GuardReason; warnedAwakeMs: number; stoppedAwakeMs: number };
export type GuardState = {
  jobId: string; round: number; policyBinding: string; awakeMs: number; progressMs: number | null;
  warnings: Warning[]; suspended: boolean; exited: boolean; plan: GuardPlan | null;
};
export type GuardObservation = { state: ProgressState; unavailable: boolean; backlog: boolean; ended: boolean };
export type GuardInput = { jobId: string; round: number; observation: GuardObservation; exited: boolean };
export type GuardEvent = { type: 'warning'; warning: Warning } | { type: 'stop-plan'; plan: GuardPlan } | { type: 'cleared' };
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
function binding(policy: GuardPolicy | null) {
  if (policy === null) return 'disabled';
  if (![policy.firstEventMs, policy.unfinishedReadMs, policy.graceMs].every(n => time(n) && n > 0 && n <= 86_400_000)
    || (policy.calibration !== null && !/^[\w.-]{1,100}$/.test(policy.calibration))) throw new Error('看管策略无效。');
  return JSON.stringify([policy.firstEventMs, policy.unfinishedReadMs, policy.graceMs, policy.calibration]);
}
export function initialGuard(jobId: string, round: number, policy: GuardPolicy | null): GuardState {
  if (!/^[\w-]{1,128}$/.test(jobId) || !Number.isSafeInteger(round) || round < 1) throw new Error('看管任务范围无效。');
  return { jobId, round, policyBinding: binding(policy), awakeMs: 0, progressMs: null,
    warnings: [], suspended: false, exited: false, plan: null };
}
export function guardTick(policy: GuardPolicy | null, previous: GuardState, input: GuardInput): { state: GuardState; events: GuardEvent[] } {
  if (previous.jobId !== input.jobId || previous.round !== input.round || previous.policyBinding !== binding(policy))
    throw new Error('看管范围或策略已变化，不能复用旧状态。');
  const observation = input.observation, p = observation.state;
  if (!time(p.awakeMs) || p.awakeMs < previous.awakeMs || (p.progressMs !== null && (!time(p.progressMs) || p.progressMs > p.awakeMs)))
    throw new Error('看管观察时钟无效。');
  const s: GuardState = { ...previous, awakeMs: p.awakeMs, warnings: previous.warnings.map(w => ({ ...w })),
    plan: previous.plan ? { ...previous.plan } : null };
  if (previous.exited || input.exited) { s.exited = true; return { state: s, events: [] }; }
  if (s.plan || policy === null) return { state: s, events: [] };
  if (observation.unavailable || observation.backlog || p.incomplete) {
    s.suspended = true; return { state: s, events: [] };
  }
  // 不用错误计数/日志字节解除预警；只有明确新进展可清。
  if (p.progressMs !== null && p.progressMs > (s.progressMs ?? -1)) {
    const cleared = s.warnings.length > 0;
    s.progressMs = p.progressMs; s.warnings = []; s.suspended = false;
    return { state: s, events: cleared ? [{ type: 'cleared' }] : [] };
  }
  if (s.suspended) { s.warnings = s.warnings.map(w => ({ ...w, since: p.awakeMs })); s.suspended = false; }
  const conditions: { reason: GuardReason; key: string }[] = [];
  if (p.firstEventMs === null && p.awakeMs >= policy.firstEventMs) conditions.push({ reason: 'first-event-wait', key: 'first' });
  const read = p.active.filter(t => t.operation === 'read' && p.awakeMs - t.from >= policy.unfinishedReadMs)
    .sort((a, b) => a.from - b.from || a.id.localeCompare(b.id))[0];
  if (read) conditions.push({ reason: 'unfinished-read', key: read.id });
  const repeated = progressEvidence(p).repeatedReadCandidates.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))[0];
  if (repeated) conditions.push({ reason: 'repeated-read', key: repeated.fingerprint });
  const events: GuardEvent[] = [];
  for (const condition of conditions) {
    let warning = s.warnings.find(w => w.reason === condition.reason);
    if (!warning || warning.key !== condition.key) {
      warning = { ...condition, since: p.awakeMs };
      s.warnings = s.warnings.filter(w => w.reason !== condition.reason); s.warnings.push(warning);
      events.push({ type: 'warning', warning: { ...warning } });
    } else if (policy.calibration !== null && condition.reason !== 'repeated-read' && p.awakeMs - warning.since >= policy.graceMs) {
      // 校准引用仅是可信控制面元数据，不是身份/信号权限；返回纯计划供后续适配器审查。
      s.plan = { jobId: s.jobId, round: s.round, reason: warning.reason, warnedAwakeMs: warning.since, stoppedAwakeMs: p.awakeMs };
      events.push({ type: 'stop-plan', plan: { ...s.plan } }); break;
    }
  }
  return { state: s, events };
}
