import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec, root } from './helpers.ts';
import { runPreparedChannelProbe, PROBE_FILE, PROBE_CONTENT } from '../src/core/channel-probe.ts';

async function fixture(t: import('node:test').TestContext, exit = 0) {
  const c = await context(t, false), marker = join(c.temp, 'observed.json'), fake = join(c.temp, 'probe-worker.mjs');
  await mkdir(join(c.home, 'cache'), { recursive: true });
  await writeFile(join(c.home, 'cache', 'quota.json'), JSON.stringify({ queriedAt: new Date().toISOString(), providers: [] }));
  await writeFile(fake, `import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2), get=k=>args[args.indexOf(k)+1];
const sandbox=JSON.parse(readFileSync(get('--settings'),'utf8'));
const cwd=process.cwd();
const data={args,cwd,git:existsSync(join(cwd,'.git','HEAD')),gitConfig:readFileSync(join(cwd,'.git','config'),'utf8'),hooks:existsSync(join(cwd,'.git','hooks')),home:process.env.HOME,store:process.env.AGENT_CLI_CREDENTIAL_STORE,
secret:process.env.PARENT_API_KEY??null,sandbox:!!sandbox.filesystem,workspace:get('--workspace'),
prompt:args.at(-1),count:existsSync(${JSON.stringify(marker)})?JSON.parse(readFileSync(${JSON.stringify(marker)},'utf8')).count+1:1};
writeFileSync(${JSON.stringify(marker)},JSON.stringify(data));
if(get('--mode')!=='ask'||get('--workspace')!==cwd||data.store!=='memory'||data.secret!==null)process.exit(3);
console.log(JSON.stringify({type:'tool_call',subtype:'started'}));
const result=readFileSync(join(cwd,'probe-input.txt'),'utf8').trim();
console.log(JSON.stringify({type:'tool_call',subtype:'completed'}));
console.log(JSON.stringify({type:'result',result}));process.exit(${exit});`);
  const run = (body: string, env: NodeJS.ProcessEnv = {}) => exec(process.execPath, ['--input-type=module', '-e', `
import {workerProbeFixtureIntent,runWorkerProbeFixture} from './src/core/channel-probe-worker-fixture.ts';
import {issueProbeApproval} from './src/core/channel-probe-consent.ts';
const store=${JSON.stringify(join(c.temp, 'approval'))}, choice='cursor-sonnet:high';
${body}`], root, { ...c.env, XAGENTS_FAKE_WORKER: fake, PARENT_API_KEY: 'must-not-pass', ...env });
  return { ...c, fake, marker, run };
}
const grant = `const token=await issueProbeApproval(store,workerProbeFixtureIntent(choice),{actor:'owner',trigger:'manual'});`;

test('Git临时仓库禁父配置模板且选手只读固定文件', async t => {
  const c = await fixture(t), poison = join(c.temp, 'parent-git-config');
  await writeFile(poison, '[user]\nname = must-not-inherit\n[init]\ntemplateDir = /missing-parent-template\n');
  const r = await c.run(`${grant}console.log(JSON.stringify(await runWorkerProbeFixture(store,token,choice,'offline_fixture')));`,
    { GIT_CONFIG_GLOBAL: poison, GIT_DIR: '/missing-parent-repository', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'init.templateDir', GIT_CONFIG_VALUE_0: '/missing' });
  assert.equal(r.code, 0, r.stderr); assert.equal(JSON.parse(r.stdout).report.outcome, 'success');
  const seen = JSON.parse(await readFile(c.marker, 'utf8'));
  assert.equal(seen.git, true); assert.equal(seen.hooks, false); assert.ok(!seen.gitConfig.includes('must-not-inherit'));
  assert.equal(seen.count, 1); await assert.rejects(access(seen.cwd));
});
test('Git准备失败零启动且不消费单次审批', async t => {
  const c = await fixture(t);
  const r = await c.run(`${grant}
const cp=await import('node:child_process'), module=await import('node:module'), original=cp.default.execFile;
cp.default.execFile=(...args)=>{queueMicrotask(()=>args.at(-1)(new Error('fixture git failure')));};module.syncBuiltinESMExports();
try{await runWorkerProbeFixture(store,token,choice,'offline_fixture');process.exit(4);}catch{}
const fs=await import('node:fs/promises');try{await fs.access(${JSON.stringify(c.marker)});process.exit(5);}catch{}
cp.default.execFile=original;module.syncBuiltinESMExports();
console.log(JSON.stringify(await runWorkerProbeFixture(store,token,choice,'offline_fixture')));`);
  assert.equal(r.code, 0, r.stderr); assert.equal(JSON.parse(r.stdout).report.outcome, 'success');
  assert.equal(JSON.parse(await readFile(c.marker, 'utf8')).count, 1);
  assert.deepEqual(await readdir(join(c.home, 'jobs')), []);
});

test('原运行包/只读参数→单次门→临时真实读取→报告和目录回收', async t => {
  const c = await fixture(t);
  const r = await c.run(`${grant}console.log(JSON.stringify(await runWorkerProbeFixture(store,token,choice,'offline_fixture')));`);
  assert.equal(r.code, 0, r.stderr); const out = JSON.parse(r.stdout);
  assert.equal(out.mode, 'offline_fixture'); assert.equal(out.realModelCalled, false); assert.equal(out.amountHardLimit, null);
  assert.equal(out.report.outcome, 'success'); assert.equal(out.report.usage, null); assert.equal(out.report.version, null);
  assert.ok(out.report.toolStartedMs !== null && out.report.toolCompletedMs !== null);
  const seen = JSON.parse(await readFile(c.marker, 'utf8'));
  assert.equal(seen.count, 1); assert.equal(seen.sandbox, true); assert.equal(seen.workspace, seen.cwd);
  assert.equal(seen.home, join(seen.cwd, 'home')); assert.equal(seen.secret, null); assert.equal(seen.store, 'memory');
  assert.ok(seen.prompt.includes('只读取当前目录的 probe-input.txt'));
  assert.ok(!seen.args.includes('--resume')); await assert.rejects(access(seen.cwd));
  assert.deepEqual(await readdir(join(c.home, 'jobs')), []);
});
test('缺审批/真实模式/缺替身拒绝，不启动也不创建任务目录', async t => {
  const c = await fixture(t);
  const r = await c.run(`for(const [token,mode] of [[null,'offline_fixture'],['not-a-token','real']]) {try{await runWorkerProbeFixture(store,token,choice,mode);process.exit(4);}catch{}}
delete process.env.XAGENTS_FAKE_WORKER;try{workerProbeFixtureIntent(choice);process.exit(5);}catch{}`);
  assert.equal(r.code, 0, r.stderr); await assert.rejects(access(c.marker)); await assert.rejects(access(join(c.home, 'jobs')));
});
test('本地额度准备失败和缺假程序均零启动，不进行网络补查', async t => {
  const c = await fixture(t);
  await writeFile(join(c.home, 'cache', 'quota.json'), '{bad');
  const first = await c.run(`${grant}try{await runWorkerProbeFixture(store,token,choice,'offline_fixture');process.exit(4);}catch{}`);
  assert.equal(first.code, 0, first.stderr); await assert.rejects(access(c.marker));
  await writeFile(join(c.home, 'cache', 'quota.json'), JSON.stringify({ queriedAt: new Date().toISOString(), providers: [] }));
  const second = await c.run(`${grant}try{await runWorkerProbeFixture(store,token,choice,'offline_fixture');process.exit(4);}catch{}`, { XAGENTS_FAKE_WORKER: join(c.temp, 'missing.mjs') });
  assert.equal(second.code, 0, second.stderr); await assert.rejects(access(c.marker));
  assert.deepEqual(await readdir(join(c.home, 'jobs')), []);
});
test('假程序失败后同审批不再启动，运行包独立清理', async t => {
  const c = await fixture(t, 1);
  const r = await c.run(`${grant}const r=await runWorkerProbeFixture(store,token,choice,'offline_fixture');if(r.report.outcome!=='failed')process.exit(3);
try{await runWorkerProbeFixture(store,token,choice,'offline_fixture');process.exit(4);}catch{}`);
  assert.equal(r.code, 0, r.stderr); assert.equal(JSON.parse(await readFile(c.marker, 'utf8')).count, 1);
  assert.deepEqual(await readdir(join(c.home, 'jobs')), []);
});
test('保存策略关闭或本地额度到线不能被替身/审批绕过', async t => {
  for (const reason of ['policy', 'quota']) {
    const c = await fixture(t);
    if (reason === 'policy') await writeFile(join(c.home, 'config.json'), JSON.stringify({ workers: { 'cursor-sonnet': { enabled: false, efforts: ['high'], fast: false } } }));
    else await writeFile(join(c.home, 'cache', 'quota.json'), JSON.stringify({ queriedAt: new Date().toISOString(), providers: [
      { icon: 'cursor', bars: [{ label: '其他模型池', used: 100, reset: null }] }
    ] }));
    const r = await c.run(`${grant}try{await runWorkerProbeFixture(store,token,choice,'offline_fixture');process.exit(4);}catch{}`);
    assert.equal(r.code, 0, r.stderr); await assert.rejects(access(c.marker)); await assert.rejects(access(join(c.home, 'jobs')));
  }
});
test('可信准备路径保留固定stdin，核心不删除调用方拥有目录', async t => {
  const c = await context(t, false), folder = join(c.temp, 'prepared'); await mkdir(folder);
  await writeFile(join(folder, PROBE_FILE), PROBE_CONTENT + '\n');
  const report = await runPreparedChannelProbe({ folder, env: {}, stdin: PROBE_CONTENT,
    command: { file: process.execPath, args: ['-e', `const fs=require('node:fs');console.log(JSON.stringify({type:'result',result:fs.readFileSync(0,'utf8')}));`] } });
  assert.equal(report.outcome, 'success'); assert.equal(report.resultVerified, true); await access(folder);
});
