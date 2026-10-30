import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec, root, until } from './helpers.ts';
import { alive } from '../src/core/platform.ts';
import { spawn } from 'node:child_process';

async function fixture(t: import('node:test').TestContext, hang = false) {
  const c = await context(t, false), marker = join(c.temp, 'worker.json'), fake = join(c.temp, 'probe.mjs');
  await mkdir(join(c.home, 'cache'), { recursive: true });
  await writeFile(join(c.home, 'cache', 'quota.json'), JSON.stringify({ queriedAt: new Date().toISOString(), providers: [] }));
  await writeFile(fake, `import {readFileSync,writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';import {join} from 'node:path';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref();
writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,grandchild:child.pid,cwd:process.cwd(),count:1}));
${hang ? 'setInterval(()=>{},1000);' : `console.log(JSON.stringify({type:'result',result:readFileSync(join(process.cwd(),'probe-input.txt'),'utf8').trim()}));process.exit(0);`}`);
  const start = (body: string) => exec(process.execPath, ['--input-type=module', '-e', `
import {runBoundedWorkerProbeFixture} from './src/core/channel-probe-bounded-fixture.ts';
import {workerProbeFixtureIntent} from './src/core/channel-probe-worker-fixture.ts';
import {issueProbeApproval} from './src/core/channel-probe-consent.ts';
import {existsSync} from 'node:fs';
const choice='cursor-sonnet:high',store=${JSON.stringify(join(c.temp, 'approvals'))};
const token=await issueProbeApproval(store,workerProbeFixtureIntent(choice),{actor:'owner',trigger:'manual'});
${body}`], root, { ...c.env, XAGENTS_FAKE_WORKER: fake });
  return { ...c, marker, start };
}
async function gone(c: { marker: string }) {
  const p = JSON.parse(await readFile(c.marker, 'utf8'));
  await until(async () => !alive(p.pid) && !alive(p.grandchild), Boolean, 4000);
  await assert.rejects(access(p.cwd));
}
test('外层总闸门覆盖正常准备与单次执行，正常退出也回收假选手遗留子孙', async t => {
  const c = await fixture(t), r = await c.start(`console.log(JSON.stringify(await runBoundedWorkerProbeFixture(store,token,choice,{timeoutMs:5000})));`);
  assert.equal(r.code, 0, r.stderr); const result = JSON.parse(r.stdout);
  assert.equal(result.scope, 'helper_preparation_and_execution'); assert.equal(result.realModelCalled, false);
  assert.equal(result.report.outcome, 'success'); assert.equal(result.report.toolStartedMs, null);
  assert.equal(result.report.model, null); assert.equal(result.report.usage, null); await gone(c);
});
test('准备阶段挂起在外层时限停止，零选手启动且原审批已消费', async t => {
  const c = await fixture(t), began = performance.now();
  const r = await c.start(`const r=await runBoundedWorkerProbeFixture(store,token,choice,{timeoutMs:700,scenario:'prepare_hang'});console.log(JSON.stringify(r));
try{await runBoundedWorkerProbeFixture(store,token,choice,{timeoutMs:700});process.exitCode=5;}catch{}`);
  assert.equal(r.code, 0, r.stderr); assert.equal(JSON.parse(r.stdout).report.outcome, 'timeout');
  assert.ok(performance.now() - began < 4000); await assert.rejects(access(c.marker));
});
test('执行阶段总时限回收helper、假选手及子孙，不留下独立进程组', async t => {
  const c = await fixture(t, true);
  const r = await c.start(`console.log(JSON.stringify(await runBoundedWorkerProbeFixture(store,token,choice,{timeoutMs:1200})));`);
  assert.equal(r.code, 0, r.stderr); assert.equal(JSON.parse(r.stdout).report.outcome, 'timeout'); await gone(c);
});
for (const action of ['abort', 'SIGTERM']) test(`外层${action}取消后先回收再删除目录`, { skip: action === 'SIGTERM' && process.platform === 'win32' ? 'Windows不能以POSIX外部SIGTERM语义作此保证' : false }, async t => {
  const c = await fixture(t, true);
  const r = await c.start(`const controller=new AbortController();
const timer=setInterval(()=>{if(existsSync(${JSON.stringify(c.marker)})){clearInterval(timer);${action === 'abort' ? 'controller.abort();' : "process.kill(process.pid,'SIGTERM');"}}},20);
try{console.log(JSON.stringify(await runBoundedWorkerProbeFixture(store,token,choice,{timeoutMs:4000,signal:controller.signal})));}finally{clearInterval(timer);}`);
  assert.equal(r.code, 0, r.stderr); const result = JSON.parse(r.stdout);
  assert.equal(result.cancelled, true); assert.equal(result.report.outcome, 'failed'); await gone(c);
});
test('直接辅助协议没有外层拥有标记时零写入其他目录', async t => {
  const c = await fixture(t);
  const p = spawn(process.execPath, [join(root, 'src/core/channel-probe-bounded-fixture.ts'), '--offline-helper'],
    { cwd: c.repo, env: c.env, stdio: ['pipe', 'ignore', 'pipe'] });
  let error = ''; p.stderr.on('data', b => { error += b; });
  const closed = new Promise<number | null>((resolve, reject) => { p.on('error', reject); p.on('close', resolve); });
  p.stdin.end(JSON.stringify({ root: c.repo, choice: 'cursor-sonnet:high', fake: c.env.XAGENTS_FAKE_WORKER, source: c.home, scenario: 'normal', nonce: 'not-owned' }));
  assert.equal(await closed, 1); assert.ok(!error.includes(c.repo));
  await assert.rejects(access(join(c.repo, 'registry'))); await assert.rejects(access(c.marker));
});
test('内部入口缺协议及超限时限均拒绝，不启动真实通道', async t => {
  const c = await fixture(t);
  const r = await c.start(`for(const timeoutMs of [0,90001])try{await runBoundedWorkerProbeFixture(store,token,choice,{timeoutMs});process.exitCode=4;}catch{}`);
  assert.equal(r.code, 0, r.stderr); await assert.rejects(access(c.marker));
  const direct = await exec(process.execPath, [join(root, 'src/core/channel-probe-bounded-fixture.ts'), '--real'], root, c.env);
  assert.equal(direct.code, 1); assert.ok(!direct.stderr.includes(c.temp));
});
