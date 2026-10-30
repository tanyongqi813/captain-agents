import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withLock } from '../src/core/fsx.ts';
import { issueProbeApproval, runApprovedChannelProbe } from '../src/core/channel-probe-consent.ts';
import type { runChannelProbe } from '../src/core/channel-probe.ts';

const input = { command: { file: process.execPath, args: ['-e', 'process.exit(0)'] }, model: null, version: null };
const manual = { actor: 'owner', trigger: 'manual' } as const;
async function context(t: import('node:test').TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'probe-expiry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const token = await issueProbeApproval(dir, input, manual, 1000);
  const digest = createHash('sha256').update(token).digest('hex');
  return { dir, token, file: join(dir, digest + '.json'), lock: join(dir, digest + '.lock') };
}
test('审批调用时有效，等待真实文件锁后过期：零执行且不重建审批', async t => {
  const c = await context(t); let wall = 1000, calls = 0;
  t.mock.method(Date, 'now', () => wall);
  let release!: () => void, acquired!: () => void;
  const ready = new Promise<void>(r => { acquired = r; });
  const holding = withLock(c.lock, async () => { acquired(); await new Promise<void>(r => { release = r; }); });
  await ready;
  const run: typeof runChannelProbe = async () => { calls++; throw Error('不应启动'); };
  // 即刻捕获拒绝，避免异步锁释放时出现未处理拒绝。
  const rejected = assert.rejects(runApprovedChannelProbe(c.dir, c.token, input, manual, run, 1000));
  wall = 301000; release(); await holding; await rejected;
  assert.equal(calls, 0); assert.equal(JSON.parse(await readFile(c.file, 'utf8')).state, 'ready');
});
test('消费落盘后过期/时钟回退：已消费不恢复、零执行', async t => {
  for (const finalWall of [301000, 999]) {
    const c = await context(t); let reads = 0, calls = 0;
    // 捕获入口与消费检查为有效，调用执行器前才跳变；不等待真实五分钟。
    // withLock还读取一次等待截止时间：入口、锁截止、锁内核验之后再跳变。
    const mocked = t.mock.method(Date, 'now', () => ++reads < 4 ? 1000 : finalWall);
    const run: typeof runChannelProbe = async () => { calls++; throw Error('不应启动'); };
    await assert.rejects(runApprovedChannelProbe(c.dir, c.token, input, manual, run, 1000));
    mocked.mock.restore();
    assert.equal(calls, 0); assert.equal(JSON.parse(await readFile(c.file, 'utf8')).state, 'consumed');
  }
});
test('发放时间溢出：零登记文件', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'probe-overflow-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(issueProbeApproval(dir, input, manual, Number.MAX_SAFE_INTEGER));
  assert.deepEqual(await readdir(dir), []);
});
