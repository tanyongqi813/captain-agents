import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { issueProbeApproval, runApprovedChannelProbe } from '../src/core/channel-probe-consent.ts';
import { runChannelProbe } from '../src/core/channel-probe.ts';

const input = () => ({ command: { file: process.execPath, args: ['-e', `console.log(JSON.stringify({type:'system',subtype:'init',model:'test-model',version:'1.2.3'}));console.log(JSON.stringify({type:'result',result:'probe-read-v1'}));`] }, model: 'test-model', version: '1.2.3' });
const manual = { actor: 'owner', trigger: 'manual' } as const;
async function store(t: import('node:test').TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'probe-approval-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
test('无审批/错误动作/身份变更零启动，过期与回退拒绝', async t => {
  const dir = await store(t); let calls = 0;
  const run: typeof runChannelProbe = async () => { calls++; throw new Error('不得执行'); };
  await assert.rejects(runApprovedChannelProbe(dir, null, input(), manual, run));
  const token = await issueProbeApproval(dir, input(), manual, 1000);
  await assert.rejects(runApprovedChannelProbe(dir, token, { ...input(), model: 'other' }, manual, run, 1001));
  await assert.rejects(runApprovedChannelProbe(dir, token, input(), manual, run, 999));
  await assert.rejects(runApprovedChannelProbe(dir, token, input(), manual, run, 301000));
  assert.equal(calls, 0);
});
test('并发只消费一次，执行失败仍不重试，磁盘不存命令/token', async t => {
  const dir = await store(t), token = await issueProbeApproval(dir, input(), manual); let calls = 0;
  const run: typeof runChannelProbe = async () => { calls++; throw new Error('假执行失败'); };
  await Promise.allSettled([runApprovedChannelProbe(dir, token, input(), manual, run), runApprovedChannelProbe(dir, token, input(), manual, run)]);
  assert.equal(calls, 1);
  await assert.rejects(runApprovedChannelProbe(dir, token, input(), manual, run)); assert.equal(calls, 1);
  const file = (await readdir(dir)).find(f => f.endsWith('.json'))!;
  const raw = await readFile(join(dir, file), 'utf8'); assert.ok(!raw.includes(token)); assert.ok(!raw.includes('test-model'));
  assert.equal(JSON.parse(raw).state, 'consumed');
});
test('独立冷进程争用只消费一次，重启不能再次执行', async t => {
  const dir = await store(t), token = await issueProbeApproval(dir, input(), manual);
  const moduleUrl = new URL('../src/core/channel-probe-consent.ts', import.meta.url).href;
  async function child(id: string) {
    const code = `const {runApprovedChannelProbe}=await import(${JSON.stringify(moduleUrl)});const {writeFile}=await import('node:fs/promises');try{await runApprovedChannelProbe(${JSON.stringify(dir)},${JSON.stringify(token)},${JSON.stringify(input())},{trigger:'manual'},async()=>{await writeFile(${JSON.stringify(join(dir, id))},'called');throw Error('fixture');});}catch{}`;
    await new Promise<void>((resolve, reject) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', code], { env: {}, stdio: 'ignore' });
      p.on('error', reject); p.on('close', n => n === 0 ? resolve() : reject(Error('fixture child failed')));
    });
  }
  await Promise.all([child('first'), child('second')]);
  assert.equal((await readdir(dir)).filter(f => f === 'first' || f === 'second').length, 1);
  await child('third');
  assert.ok(!(await readdir(dir)).includes('third'));
});
test('坏审批原样拒绝不覆盖，不能凭空重建', async t => {
  const dir = await store(t), token = await issueProbeApproval(dir, input(), manual);
  const file = join(dir, (await readdir(dir)).find(f => f.endsWith('.json'))!);
  await writeFile(file, '{bad');
  await assert.rejects(runApprovedChannelProbe(dir, token, input(), manual)); assert.equal(await readFile(file, 'utf8'), '{bad');
});
test('授权后真实Node替身一次，元数据精确核对；不匹配未知，不拿请求值冒充实际', async t => {
  const dir = await store(t), token = await issueProbeApproval(dir, input(), manual);
  const report = await runApprovedChannelProbe(dir, token, input(), manual);
  assert.equal(report.outcome, 'success'); assert.equal(report.model, 'test-model'); assert.equal(report.version, '1.2.3'); assert.equal(report.usage, null);
  const r = await runChannelProbe(input().command, { expectedModel: 'other', expectedVersion: '0.0.0' });
  assert.equal(r.model, null); assert.equal(r.version, null);
});
