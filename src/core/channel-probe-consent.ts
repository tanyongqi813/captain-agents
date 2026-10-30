// 可信手动控制面的持久单次门；不是身份鉴权，也不授予网络/凭据/隔离权限。
// 当前无应用/CLI消费者。真实适配器必须在原有安全准备与人工批准之后才调用。
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { hasCode, readJson, withLock, writeJson } from './fsx.ts';
import { runChannelProbe } from './channel-probe.ts';
import type { ProbeReport } from './channel-probe.ts';

export type ProbeInvocation = { command: { file: string; args: string[] }; model: string | null; version: string | null };
type Approval = { schema: 1; binding: string; issued: number; expires: number; state: 'ready' | 'consumed' };
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const denied = () => new Error('本次诊断没有有效的单次手动审批，未启动。');
function snapshot(input: ProbeInvocation): ProbeInvocation {
  const metadata = (v: unknown) => v === null || typeof v === 'string' && v.length > 0 && v.length <= 160
    && /^[\w .+/:()-]+$/.test(v) && !/bearer|api[_-]?key|secret|sk-/i.test(v);
  if (!input || !input.command || !isAbsolute(input.command.file) || !Array.isArray(input.command.args)
    || input.command.args.length > 128 || input.command.args.some(a => typeof a !== 'string' || a.length > 8192 || a.includes('\0'))
    || !metadata(input.model) || !metadata(input.version)) throw denied();
  return { command: { file: input.command.file, args: [...input.command.args] }, model: input.model, version: input.version };
}
function location(store: string, token: string) {
  if (!isAbsolute(store) || !/^[a-f0-9-]{36}$/.test(token)) throw denied();
  return { file: join(store, digest(token) + '.json'), lock: join(store, digest(token) + '.lock') };
}
function checked(value: unknown): Approval {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw denied();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'binding,expires,issued,schema,state' || v.schema !== 1
    || typeof v.binding !== 'string' || !/^[a-f0-9]{64}$/.test(v.binding)
    || !Number.isSafeInteger(v.issued) || !Number.isSafeInteger(v.expires)
    || (v.issued as number) < 0 || (v.expires as number) <= (v.issued as number) || (v.expires as number) - (v.issued as number) > 300000
    || !['ready', 'consumed'].includes(String(v.state))) throw denied();
  return v as Approval;
}

// decision必须由可信人工入口提供；普通布尔值不能替代真实权限检查。
export async function issueProbeApproval(store: string, input: ProbeInvocation, decision: { actor: 'owner'; trigger: 'manual' }, now = Date.now()): Promise<string> {
  const frozen = snapshot(input);
  if (decision?.actor !== 'owner' || decision?.trigger !== 'manual' || !Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(now + 300000)) throw denied();
  const token = randomUUID(), { file, lock } = location(store, token);
  await mkdir(store, { recursive: true, mode: 0o700 });
  await withLock(lock, () => writeJson(file, { schema: 1, binding: digest(JSON.stringify(frozen)), issued: now, expires: now + 300000, state: 'ready' }));
  return token;
}

export async function runApprovedChannelProbe(store: string, token: string | null, input: ProbeInvocation, action: { trigger: 'manual' },
  run: typeof runChannelProbe = runChannelProbe, now = Date.now()): Promise<ProbeReport> {
  const frozen = snapshot(input);
  if (!token || action?.trigger !== 'manual' || !Number.isSafeInteger(now) || now < 0) throw denied();
  // now可供离线夹具定位时间，但不能把锁等待/落盘时间冻结在入口。
  const began = performance.now(), wallBegan = Date.now();
  let lastWall = wallBegan;
  const assertLive = (approval: Approval) => {
    const wall = Date.now(), elapsed = performance.now() - began;
    if (!Number.isSafeInteger(wall) || wall < lastWall || !Number.isFinite(elapsed) || elapsed < 0) throw denied();
    lastWall = wall;
    const current = now + Math.max(elapsed, wall - wallBegan);
    if (current < approval.issued || current >= approval.expires) throw denied();
  };
  const { file, lock } = location(store, token);
  let consumed: Approval | undefined;
  await withLock(lock, async () => {
    let value: unknown;
    try { value = await readJson(file); } catch (e) { if (hasCode(e, 'ENOENT') || e instanceof SyntaxError) throw denied(); throw e; }
    const approval = checked(value);
    if (approval.state !== 'ready' || approval.binding !== digest(JSON.stringify(frozen))) throw denied();
    assertLive(approval);
    // 执行前先消费；进程崩溃/错误也不允许自动重试同一审批。
    await writeJson(file, { ...approval, state: 'consumed' });
    consumed = approval;
  });
  // 原子写/释放锁也会等待；过期或回退后保留consumed，绝不退回ready重试。
  if (!consumed) throw denied();
  assertLive(consumed);
  const claimed = consumed;
  let dispatched = false;
  const authorizeSpawn = async (start: () => void) => {
    if (dispatched) throw denied(); dispatched = true;
    await withLock(lock, async () => {
      const latest = checked(await readJson(file));
      if (latest.state !== 'consumed' || latest.binding !== claimed.binding || latest.issued !== claimed.issued || latest.expires !== claimed.expires) throw denied();
      assertLive(latest);
      // 无await夹在最后核验和实际spawn之间；监听同步装好后再释放文件锁。
      start();
    });
  };
  return run(frozen.command, { expectedModel: frozen.model, expectedVersion: frozen.version, authorizeSpawn });
}
