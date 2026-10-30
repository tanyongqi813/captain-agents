import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { issueProbeApproval, runApprovedChannelProbe } from '../src/core/channel-probe-consent.ts';
import { runChannelProbe } from '../src/core/channel-probe.ts';

const manual = { actor: 'owner', trigger: 'manual' } as const;
async function fixture(t: import('node:test').TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'probe-spawn-gate-')), marker = join(dir, 'launched');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = { command: { file: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'once');console.log(JSON.stringify({type:'result',result:'probe-read-v1'}));`] }, model: null, version: null };
  return { dir, marker, input };
}
test('消费后异步准备跨过有效期，实际spawn门拒绝且无选手', async t => {
  const c = await fixture(t); let wall = 1000; t.mock.method(Date, 'now', () => wall);
  const token = await issueProbeApproval(c.dir, c.input, manual, 1000);
  await assert.rejects(runApprovedChannelProbe(c.dir, token, c.input, manual, async (cmd, opts) => {
    wall = 301000; return runChannelProbe(cmd, opts);
  }, 1000));
  await assert.rejects(access(c.marker));
  const file = (await readdir(c.dir)).find(f => f.endsWith('.json'))!;
  assert.equal(JSON.parse(await readFile(join(c.dir, file), 'utf8')).state, 'consumed');
});
test('消费后绑定被篡改，实际spawn门零执行且不自动重建', async t => {
  const c = await fixture(t), token = await issueProbeApproval(c.dir, c.input, manual);
  await assert.rejects(runApprovedChannelProbe(c.dir, token, c.input, manual, async (cmd, opts) => {
    const file = join(c.dir, createHash('sha256').update(token).digest('hex') + '.json');
    const value = JSON.parse(await readFile(file, 'utf8')); value.binding = '0'.repeat(64); await writeFile(file, JSON.stringify(value));
    return runChannelProbe(cmd, opts);
  }));
  await assert.rejects(access(c.marker));
});
test('实际spawn发生在审批锁内且仅一次，快速退出不漏结果', async t => {
  const c = await fixture(t), token = await issueProbeApproval(c.dir, c.input, manual);
  const lock = join(c.dir, createHash('sha256').update(token).digest('hex') + '.lock', '.lock'); let starts = 0;
  const report = await runApprovedChannelProbe(c.dir, token, c.input, manual, (cmd, opts) => {
    const authorize = opts!.authorizeSpawn!;
    return runChannelProbe(cmd, { ...opts, authorizeSpawn: async start => {
      await authorize(() => { assert.equal(existsSync(lock), true); starts++; start(); });
      await assert.rejects(authorize(() => { starts++; }));
    } });
  });
  assert.equal(starts, 1); assert.equal(report.outcome, 'success'); assert.equal(report.resultVerified, true);
  assert.equal(await readFile(c.marker, 'utf8'), 'once'); assert.equal(existsSync(lock), false);
});
test('等待启动门也计入时限，迟到放行不能再启动', async t => {
  const c = await fixture(t); let release!: () => void;
  const blocked = new Promise<void>(r => { release = r; });
  const report = await runChannelProbe(c.input.command, { timeoutMs: 40, authorizeSpawn: async start => { await blocked; start(); } });
  assert.equal(report.outcome, 'timeout'); release();
  await new Promise(r => setImmediate(r)); await assert.rejects(access(c.marker));
});
