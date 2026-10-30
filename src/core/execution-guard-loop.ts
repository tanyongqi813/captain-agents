// 显式离线调用；不从应用启动/runner定时器自动启用，不创建或直接结束任何进程。
import { randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { readJob } from './job.ts';
import type { Job } from './job.ts';
import { jobDir } from './paths.ts';
import { isolationOf } from './roster.ts';
import { sleptSeconds } from './duration.ts';
import { CursorProgressObserver } from './execution-progress.ts';
import { OfflineGuardConsumer } from './execution-guard-consumer.ts';
import type { GuardPolicy } from './execution-guard.ts';

type Options = { mode: 'offline_fixture'; fakeExecutable: string; policy: GuardPolicy;
  intervalMs: number; maxDurationMs: number; signal?: AbortSignal };
const identity = (j: Job) => JSON.stringify([j.pid, j.pidSince, j.workerPid, j.workerSince, j.started, j.who, j.command]);

export async function watchOfflineExecution(id: string, round: number, options?: Options) {
  if (!options) return { kind: 'disabled' as const };
  const { fakeExecutable: fake, intervalMs, maxDurationMs, signal } = options;
  if (options.mode !== 'offline_fixture' || !isAbsolute(fake) || process.env.XAGENTS_FAKE_WORKER !== fake
    || !Number.isSafeInteger(intervalMs) || intervalMs < 25 || intervalMs > 2000
    || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < intervalMs || maxDurationMs > 90_000)
    throw new Error('离线连续看管范围无效。');
  // 校验id/round/策略在任何任务读取前；复制策略，不让异步调用者变更本轮合同。
  const consumer = new OfflineGuardConsumer(id, round, { mode: 'offline_fixture', fakeExecutable: fake, policy: options.policy });
  const wallStart = Date.now(), deadline = performance.now() + maxDurationMs;
  const checkpoint = () => ({ kind: 'checkpoint' as const, reason: signal?.aborted ? 'cancelled' as const : 'time-limit' as const });
  if (signal?.aborted) return checkpoint();
  const first = await readJob(id), frozen = identity(first);
  if (first.state !== 'running' || !first.command?.args.includes(fake) || (first.resume?.round ?? 1) !== round
    || isolationOf(first.who) !== 'cursor' || !first.workerPid || !first.pid)
    throw new Error('仅观察已启动且身份匹配的Cursor离线任务。');
  const observer = new CursorProgressObserver({ at: wallStart, asleepMs: 0 }, randomBytes(32).toString('hex'));
  let planned = false, previous = wallStart;
  while (true) {
    if (signal?.aborted || performance.now() >= deadline) return checkpoint();
    const job = await readJob(id);
    if (identity(job) !== frozen || (job.resume?.round ?? 1) !== round) throw new Error('观察任务身份已变化，保留原检查点。');
    const terminal = ['done', 'failed', 'stopped'].includes(job.state);
    const at = Date.now();
    // 只消费runner的可信休眠记录；连同任务读取中的本地盲区都不能替新轮次写休眠或累计宽限。
    if (at - previous > 60_000) observer.invalidate();
    previous = at;
    await observer.sample(join(jobDir(id), 'run.log'), { at, asleepMs: Math.round(sleptSeconds(job.sleeps, wallStart, at) * 1000) }, terminal);
    if (Date.now() - at > 60_000) observer.invalidate();
    if (signal?.aborted || performance.now() >= deadline) return checkpoint();
    const result = await consumer.sample(observer.snapshot(), terminal);
    planned ||= !result.disabled && !!result.handoff;
    if (terminal) {
      if (planned && job.state === 'stopped') {
        try { return { kind: 'handed-off' as const, handoff: await consumer.handoff() }; }
        catch { return { kind: 'checkpoint' as const, reason: 'handoff-pending' as const }; }
      }
      return { kind: 'finished' as const, state: job.state };
    }
    try { await sleep(Math.min(intervalMs, Math.max(1, deadline - performance.now())), undefined, { signal }); }
    catch (e) { if (signal?.aborted) return checkpoint(); throw e; }
  }
}
