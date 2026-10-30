import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec, root } from './helpers.ts';

async function fixture(t: import('node:test').TestContext) {
  const c = await context(t, false), fake = join(c.temp, 'fake-worker.mjs'); await writeFile(fake, '');
  const run = (body: string) => exec(process.execPath, ['--input-type=module', '-e', `
import {OfflineGuardConsumer} from './src/core/execution-guard-consumer.ts';
import {initialProgress,advanceProgress} from './src/core/execution-progress.ts';
import {mkdir,writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';
import {jobDir} from './src/core/paths.ts';import {readJob,updateJob} from './src/core/job.ts';
const policy={firstEventMs:100,unfinishedReadMs:200,graceMs:50,calibration:'offline-test'},fake=${JSON.stringify(fake)};
const options={mode:'offline_fixture',fakeExecutable:fake,policy};
const obs=at=>({state:advanceProgress(initialProgress({at:0,asleepMs:0}),{at,asleepMs:0}),unavailable:false,backlog:false,ended:false});
async function job(id){await mkdir(jobDir(id),{recursive:true});await writeFile(join(jobDir(id),'job.json'),JSON.stringify({id,state:'running',command:{args:[fake]},workerPid:123,workerSince:1}));}
${body}`], root, { ...c.env, XAGENTS_FAKE_WORKER: fake });
  return { ...c, fake, run };
}
test('默认零IO；离线消费先证据后停止请求，重复/并发幂等且不碰另一任务或补丁', async t => {
  const c = await fixture(t);
  const r = await c.run(`
const disabled=new OfflineGuardConsumer('not-created',1);if(!(await disabled.sample(obs(200))).disabled)process.exit(3);
await job('A');await job('B');await writeFile(join(jobDir('A'),'diff.patch'),'keep-patch');
const consumer=new OfflineGuardConsumer('A',1,options);
const warning=await consumer.sample(obs(100));if(warning.events[0]?.type!=='warning')process.exit(4);
if((await readJob('A')).stopRequested)process.exit(5);
const results=await Promise.all([consumer.sample(obs(150)),consumer.sample(obs(150))]);
if(results.filter(r=>r.requested).length!==1)process.exit(6);
const evidence=JSON.parse(await readFile(join(jobDir('A'),'execution-guard-1.json'),'utf8'));
console.log(JSON.stringify({a:await readJob('A'),b:await readJob('B'),evidence,patch:await readFile(join(jobDir('A'),'diff.patch'),'utf8')}));`);
  assert.equal(r.code, 0, r.stderr); const out = JSON.parse(r.stdout);
  assert.equal(out.a.stopRequested, true); assert.equal(out.b.stopRequested, undefined); assert.equal(out.patch, 'keep-patch');
  assert.equal(out.evidence.handoff.target, 'lead'); assert.equal(out.evidence.state.plan.reason, 'first-event-wait');
  assert.equal(out.a.workerPid, 123); // 仅写请求，没有根据PID发信号。
  assert.ok(!(await readdir(join(c.home, 'jobs'))).includes('not-created'));
});
test('既有记录/坏JSON/冷消费者拒绝重置，结束与换轮任务不新请求', async t => {
  const c = await fixture(t);
  const r = await c.run(`
await job('A');const one=new OfflineGuardConsumer('A',1,options);await one.sample(obs(100));
try{await new OfflineGuardConsumer('A',1,options).sample(obs(150));process.exit(4);}catch{}
await writeFile(join(jobDir('A'),'execution-guard-1.json'),'{bad');
try{await one.sample(obs(150));process.exit(5);}catch{}
if((await readJob('A')).stopRequested)process.exit(6);
await job('done');await updateJob('done',j=>j.state='done');await new OfflineGuardConsumer('done',1,options).sample(obs(150));
if((await readJob('done')).stopRequested)process.exit(7);
await job('round');await updateJob('round',j=>j.resume={round:2,prompt:'p'});
try{await new OfflineGuardConsumer('round',1,options).sample(obs(150));process.exit(8);}catch{}
`);
  assert.equal(r.code, 0, r.stderr);
});
test('证据无法落盘和错误替身零请求，固定回交不写主人decision', async t => {
  const c = await fixture(t);
  const r = await c.run(`await job('A');await mkdir(join(jobDir('A'),'execution-guard-1.json'));
try{await new OfflineGuardConsumer('A',1,options).sample(obs(100));process.exit(4);}catch{}
if((await readJob('A')).stopRequested)process.exit(5);
delete process.env.XAGENTS_FAKE_WORKER;
try{await new OfflineGuardConsumer('A',1,options).sample(obs(150));process.exit(6);}catch{}
if((await readJob('A')).decision)process.exit(7);`);
  assert.equal(r.code, 0, r.stderr);
});
