// 仅离线组合入口；不提供真实启用参数，不发进程信号/续跑，也不代写autopilot状态机。
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { readJob, updateJob } from './job.ts';
import { jobDir } from './paths.ts';
import { readJson, writeJson, withLock, hasCode } from './fsx.ts';
import { guardTick, initialGuard } from './execution-guard.ts';
import type { GuardPolicy, GuardObservation, GuardState } from './execution-guard.ts';
import { deliverOfflineGuardHandoff } from './execution-guard-handoff.ts';

export class OfflineGuardConsumer {
  private state: GuardState;
  private session = randomUUID();
  private established = false;
  private expected: string | undefined;
  private policy: GuardPolicy | null;
  private fake: string;
  constructor(jobId: string, round: number, options?: { mode: 'offline_fixture'; fakeExecutable: string; policy: GuardPolicy }) {
    this.policy = options ? { ...options.policy } : null;
    this.fake = options?.fakeExecutable ?? '';
    if (options && (options.mode !== 'offline_fixture' || !isAbsolute(this.fake))) throw new Error('仅支持明确离线假选手。');
    this.state = initialGuard(jobId, round, this.policy);
  }
  async handoff() {
    if (this.policy === null) return { kind: 'disabled' as const };
    return deliverOfflineGuardHandoff(this.state.jobId, this.state.round, this.fake);
  }
  async sample(observation: GuardObservation, exited = false) {
    if (this.policy === null) return { disabled: true as const, requested: false };
    if (process.env.XAGENTS_FAKE_WORKER !== this.fake) throw new Error('离线替身环境不匹配。');
    const id = this.state.jobId, round = this.state.round, file = join(jobDir(id), `execution-guard-${round}.json`);
    return withLock(join(jobDir(id), `execution-guard-lock-${round}`), async () => {
      const job = await readJob(id);
      if ((job.resume?.round ?? 1) !== round || !job.command?.args.includes(this.fake)) throw new Error('任务轮次或假选手命令不匹配。');
      let saved: unknown;
      try {
        if ((await stat(file)).size > 64 * 1024) throw new Error('观察记录过大，须人工核对。');
        saved = await readJson(file);
      } catch (e) { if (!hasCode(e, 'ENOENT')) throw e; }
      // 新消费者不重置旧记录；不能用旧纯状态JSON当冷进程重新认领许可。
      if (this.established ? JSON.stringify(saved) !== this.expected : saved !== undefined) throw new Error('已有或变化的观察记录须负责人核对，不自动恢复。');
      const tick = guardTick(this.policy, this.state, { jobId: id, round, observation, exited: exited || job.state !== 'running' });
      const at = new Date().toISOString();
      const record = { schema: 1, session: this.session, jobId: id, round, at, state: tick.state,
        evidence: { errors: observation.state.errors, reconnects: observation.state.reconnects,
          activeTools: observation.state.active.length, incomplete: observation.state.incomplete,
          unavailable: observation.unavailable, backlog: observation.backlog },
        handoff: tick.state.plan ? { target: 'lead', code: `execution_guard_${tick.state.plan.reason}`, jobId: id, round } : null };
      // 先保存停止计划和脱敏证据；写失败不会发停止请求。保留日志、报告和候选改动。
      await writeJson(file, record);
      this.state = tick.state; this.expected = JSON.stringify(record); this.established = true;
      let requested = false;
      if (tick.state.plan && !tick.state.exited) {
        await updateJob(id, j => {
          if ((j.resume?.round ?? 1) !== round || j.state !== 'running' || !j.command?.args.includes(this.fake)) return;
          if (!j.stopRequested) {
            j.stopRequested = true; j.error = '执行通道持续异常，已请求停止；请负责人核对本轮观察证据，不自动续跑。'; requested = true;
          }
        });
      }
      return { disabled: false as const, requested, events: tick.events, evidenceFile: file, handoff: record.handoff };
    });
  }
}
