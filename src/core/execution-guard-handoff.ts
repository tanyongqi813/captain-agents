// 仅离线回交适配：不启动推进器/诊断AI，不修改状态机的权限与规划规则。
import { isAbsolute, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { jobDir } from './paths.ts';
import { readJob } from './job.ts';
import { readJson, withLock } from './fsx.ts';
import { readAutopilot, transition, advance } from './autopilot.ts';
import type { AutopilotRun } from './autopilot.ts';

const object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
export async function deliverOfflineGuardHandoff(id: string, round: number, fake: string) {
  if (!/^[\w-]{1,128}$/.test(id) || !Number.isSafeInteger(round) || round < 1 || !isAbsolute(fake) || process.env.XAGENTS_FAKE_WORKER !== fake)
    throw new Error('离线回交范围无效。');
  const file = join(jobDir(id), `execution-guard-${round}.json`);
  return withLock(join(jobDir(id), `execution-guard-lock-${round}`), async () => {
    const job = await readJob(id);
    const checkJob = (j: typeof job) => {
      if ((j.resume?.round ?? 1) !== round || j.state !== 'stopped' || !j.stopRequested || !j.command?.args.includes(fake))
        throw new Error('只回交已停止且轮次匹配的离线任务。');
    };
    checkJob(job);
    if ((await stat(file)).size > 64 * 1024) throw new Error('观察证据过大，须负责人核对。');
    const record = object(await readJson(file)), state = object(record.state), plan = object(state.plan), handoff = object(record.handoff);
    if (record.schema !== 1 || record.jobId !== id || record.round !== round || state.jobId !== id || state.round !== round
      || plan.jobId !== id || plan.round !== round || !['first-event-wait','unfinished-read'].includes(String(plan.reason))
      || handoff.target !== 'lead' || handoff.jobId !== id || handoff.round !== round || handoff.code !== `execution_guard_${plan.reason}`)
      throw new Error('停止与回交证据不匹配。');
    const note = `执行通道异常（${plan.reason}），任务${id}第${round}轮已停止。观察证据已保留，请负责人核对报告和改动归档，不自动续跑。`;
    if (!job.autopilot) return { kind: 'checkpoint' as const, jobId: id, round, evidence: file };
    const { run: runId, token } = job.autopilot;
    const ownsAttempt = (run: AutopilotRun, node?: string) => run.attempts.some(a => a.token === token && a.jobs?.includes(id)
      && (node === undefined || a.node === node));
    const already = (run: AutopilotRun) => run.state === 'needs_owner' && run.ownerCode === 'owner_requested'
      && run.ownerNote === note && !!run.ownerEvent && ownsAttempt(run);
    const before = await readAutopilot(runId);
    if (already(before)) return { kind: 'needs_owner' as const, runId, event: before.ownerEvent!, repeated: true };
    const action = before.action;
    if (before.state !== 'executing' || !action || action.token !== token || !action.jobs?.includes(id) || !ownsAttempt(before, action.node))
      throw new Error('当前执行动作或任务归属已变化，不回交其他执行。');
    const result = await transition(runId, token, async run => {
      const latest = await readJob(id); checkJob(latest);
      if (latest.autopilot?.run !== runId || latest.autopilot.token !== token || run.state !== 'executing'
        || !ownsAttempt(run, action.node) || !run.nodes.some(n => n.id === action.node && n.state === 'running'))
        throw new Error('回交前执行归属已变化。');
      const related = new Set([...(action.jobs ?? []), ...run.attempts.filter(a => a.token === token).flatMap(a => a.jobs ?? [])]);
      for (const sibling of related) {
        if (sibling === id) continue;
        const other = await readJob(sibling);
        if (!['done', 'failed', 'stopped'].includes(other.state))
          throw new Error('同一动作仍有未收尾任务，只保留检查点，不提前结束整台执行。');
      }
      if (!advance(run, { kind: 'owner', code: 'owner_requested', note })) throw new Error('负责人回交被状态机拒绝。');
    });
    return { kind: 'needs_owner' as const, runId, event: result.ownerEvent!, repeated: false };
  });
}
