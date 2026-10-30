import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { context, exec, root } from './helpers.ts';
async function fixture(t: import('node:test').TestContext) {
  const c = await context(t, false), fake = join(c.temp,'fake.mjs'); await writeFile(fake,'');
  const run = (body: string) => exec(process.execPath,['--input-type=module','-e',`
import {mkdir,writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';
import {jobDir} from './src/core/paths.ts';import {readJob,updateJob} from './src/core/job.ts';
import {OfflineGuardConsumer} from './src/core/execution-guard-consumer.ts';
import {initialProgress,advanceProgress} from './src/core/execution-progress.ts';
import {PRESETS,autopilotDir,runFile,parseRun,readAutopilot,updateAutopilot} from './src/core/autopilot.ts';
const fake=${JSON.stringify(fake)},options={mode:'offline_fixture',fakeExecutable:fake,policy:{firstEventMs:100,unfinishedReadMs:200,graceMs:50,calibration:'offline-test'}};
const obs=n=>({state:advanceProgress(initialProgress({at:0,asleepMs:0}),{at:n,asleepMs:0}),unavailable:false,backlog:false,ended:false});
const now=new Date().toISOString();
async function makeRun(id='1029-0001-auto',jobs=['A']){const r={id,version:1,project:'demo',repo:${JSON.stringify(c.repo)},base:'a'.repeat(40),taskId:'TASK-001',spec:'docs/tasks/TASK-001.md',who:['codex:high'],network:false,ro:false,policy:PRESETS.standard,state:'executing',created:now,updated:now,elapsedSeconds:0,sleeps:0,attemptCount:1,nodeCount:1,nodes:[{id:'TASK-001',depth:0,state:'running',attempts:1,continues:0,retries:0}],attempts:[{node:'TASK-001',attempt:1,token:'token-A',at:now,jobs}],action:{node:'TASK-001',attempt:1,token:'token-A',at:now,jobs}};
parseRun(r,id);await mkdir(autopilotDir(id),{recursive:true});await writeFile(runFile(id),JSON.stringify(r));}
async function makeJob(id='A',auto=true){await mkdir(jobDir(id),{recursive:true});await writeFile(join(jobDir(id),'job.json'),JSON.stringify({id,state:'running',command:{args:[fake]},...(auto?{autopilot:{run:'1029-0001-auto',token:'token-A'}}:{})}));const x=new OfflineGuardConsumer(id,1,options);await x.sample(obs(100));await x.sample(obs(150));await updateJob(id,j=>j.state='stopped');return x;}
${body}`],root,{...c.env,XAGENTS_FAKE_WORKER:fake});
  return {...c,run};
}
test('离线停止消费者→既有transition/advance→needs_owner，重复不新建事件或执行', async t => {
  const c=await fixture(t);const r=await c.run(`await makeRun();const x=await makeJob();const first=await x.handoff(),second=await x.handoff();console.log(JSON.stringify({first,second,run:await readAutopilot('1029-0001-auto'),job:await readJob('A')}));`);
  assert.equal(r.code,0,r.stderr);const out=JSON.parse(r.stdout);
  assert.equal(out.run.state,'needs_owner');assert.equal(out.run.ownerCode,'owner_requested');
  assert.equal(out.first.event,out.second.event);assert.equal(out.second.repeated,true);assert.equal(out.run.attemptCount,1);
  assert.equal(out.run.action,undefined);assert.equal(out.job.decision,undefined);
  assert.match(out.run.ownerNote,/核对报告和改动归档/);assert.ok(!out.run.ownerNote.includes('改动已保留'));
});
test('普通job只留检查点，默认零IO；未停止/旧轮次拒绝',async t=>{
  const c=await fixture(t);const r=await c.run(`const disabled=new OfflineGuardConsumer('missing',1);if((await disabled.handoff()).kind!=='disabled')process.exit(4);
const x=await makeJob('A',false);if((await x.handoff()).kind!=='checkpoint')process.exit(5);
await updateJob('A',j=>j.resume={round:2,prompt:'p'});try{await x.handoff();process.exit(6);}catch{}
await updateJob('A',j=>{delete j.resume;j.state='running'});try{await x.handoff();process.exit(7);}catch{}`);
  assert.equal(r.code,0,r.stderr);
});
test('token过期或当前归属不含本job拒绝，不写其他run',async t=>{
  const c=await fixture(t);const r=await c.run(`await makeRun();await makeRun('1029-0002-auto',['B']);const x=await makeJob();
await updateAutopilot('1029-0001-auto',r=>r.action.token='new-token');try{await x.handoff();process.exit(4);}catch{}
await updateAutopilot('1029-0001-auto',r=>{r.action.token='token-A';r.action.jobs=['B']});try{await x.handoff();process.exit(5);}catch{}
console.log(JSON.stringify({a:await readAutopilot('1029-0001-auto'),b:await readAutopilot('1029-0002-auto')}));`);
  assert.equal(r.code,0,r.stderr);const out=JSON.parse(r.stdout);assert.equal(out.a.state,'executing');assert.equal(out.b.state,'executing');
});
test('同动作其他job运行时拒绝且run原字节不变，终态后才能交owner',async t=>{
  const c=await fixture(t);const r=await c.run(`await makeRun('1029-0001-auto',['A','B']);const x=await makeJob();
await mkdir(jobDir('B'),{recursive:true});await writeFile(join(jobDir('B'),'job.json'),JSON.stringify({id:'B',state:'running'}));
const before=await readFile(runFile('1029-0001-auto'),'utf8');
try{await x.handoff();process.exit(4);}catch{}
if(await readFile(runFile('1029-0001-auto'),'utf8')!==before)process.exit(5);
if((await readJob('B')).stopRequested)process.exit(6);
await updateJob('B',j=>j.state='done');if((await x.handoff()).kind!=='needs_owner')process.exit(7);`);
  assert.equal(r.code,0,r.stderr);
});
