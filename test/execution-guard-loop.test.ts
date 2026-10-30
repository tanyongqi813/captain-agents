import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { context, exec, root, until } from './helpers.ts';

test('离线循环默认零IO/取消/总闸门，无启动或停止', async t => {
  const c = await context(t, false), fake = join(c.temp, 'fake.mjs'); await writeFile(fake, '');
  const r = await exec(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';import {mkdir,writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';
import {jobDir} from './src/core/paths.ts';import {watchOfflineExecution} from './src/core/execution-guard-loop.ts';
assert.equal((await watchOfflineExecution('missing',1)).kind,'disabled');
const dir=jobDir('A');await mkdir(dir,{recursive:true});await writeFile(join(dir,'run.log'),'');
await writeFile(join(dir,'job.json'),JSON.stringify({id:'A',who:'cursor-sonnet',state:'running',pid:1,workerPid:2,command:{args:[${JSON.stringify(fake)}]}}));
const options={mode:'offline_fixture',fakeExecutable:${JSON.stringify(fake)},policy:{firstEventMs:10000,unfinishedReadMs:10000,graceMs:10000,calibration:'offline'},intervalMs:25,maxDurationMs:100};
const abort=new AbortController();setTimeout(()=>abort.abort(),40);assert.equal((await watchOfflineExecution('A',1,{...options,signal:abort.signal})).reason,'cancelled');
await assert.rejects(()=>watchOfflineExecution('A',1,options),/不自动恢复/);
const b=jobDir('B');await mkdir(b,{recursive:true});await writeFile(join(b,'run.log'),'');
await writeFile(join(b,'job.json'),JSON.stringify({id:'B',who:'cursor-sonnet',state:'running',pid:1,workerPid:2,command:{args:[${JSON.stringify(fake)}]}}));
assert.equal((await watchOfflineExecution('B',1,{...options,maxDurationMs:50})).reason,'time-limit');`], root, { ...c.env, XAGENTS_FAKE_WORKER: fake });
  assert.equal(r.code, 0, r.stderr);
  assert.equal((await c.jobs())[0].stopRequested, undefined);
});

test('自身观察盲区保守失效，不写休眠或请求停止（可控时钟非OS休眠）', async t => {
  const c=await context(t,false),fake=join(c.temp,'blind.mjs');await writeFile(fake,'');
  const r=await exec(process.execPath,['--input-type=module','-e',`
import assert from 'node:assert/strict';import {mkdir,writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';
import {jobDir} from './src/core/paths.ts';import {watchOfflineExecution} from './src/core/execution-guard-loop.ts';
const dir=jobDir('blind');await mkdir(dir,{recursive:true});await writeFile(join(dir,'run.log'),'');
const raw=JSON.stringify({id:'blind',who:'cursor-sonnet',state:'running',pid:1,workerPid:2,command:{args:[${JSON.stringify(fake)}]}});await writeFile(join(dir,'job.json'),raw);
const real=Date.now;let calls=0;Date.now=()=>real()+(calls++>=2?65000:0);
const result=await watchOfflineExecution('blind',1,{mode:'offline_fixture',fakeExecutable:${JSON.stringify(fake)},policy:{firstEventMs:30,unfinishedReadMs:30,graceMs:30,calibration:'offline'},intervalMs:25,maxDurationMs:160});
Date.now=real;assert.equal(result.reason,'time-limit');assert.equal(await readFile(join(dir,'job.json'),'utf8'),raw);
assert.equal(JSON.parse(await readFile(join(dir,'execution-guard-1.json'),'utf8')).evidence.incomplete,true);`],root,{...c.env,XAGENTS_FAKE_WORKER:fake});
  assert.equal(r.code,0,r.stderr);
});

test('连续观察正常read完成及长命令不误停，runner正常done不回交', {skip:process.platform==='win32',timeout:20000},async t=>{
  const c=await context(t);assert.equal((await c.add()).code,0);const fake=join(c.temp,'normal-loop.mjs');
  await writeFile(fake,`const emit=x=>console.log(JSON.stringify(x));
emit({type:'tool_call',subtype:'started',call_id:'read-ok',tool_call:{readToolCall:{args:{path:'base.txt'}}}});
emit({type:'tool_call',subtype:'completed',call_id:'read-ok',tool_call:{readToolCall:{result:{success:{content:'fixture'}}}}});
emit({type:'tool_call',subtype:'started',call_id:'command-long',tool_call:{shellToolCall:{args:{command:'fixture only'}}}});
setTimeout(()=>{emit({type:'result',subtype:'success',is_error:false,request_id:'normal-result',result:'normal report'});},1500);`);
  const env={...c.env,XAGENTS_FAKE_WORKER:fake};
  const launch=await exec(process.execPath,['--input-type=module','-e',`import {dispatch} from ${JSON.stringify(new URL('../src/core/dispatch.ts',import.meta.url).href)};await dispatch(${JSON.stringify(c.task)},{who:['cursor-sonnet:high'],summary:'normal loop',kind:'实现'});`],c.repo,env);
  assert.equal(launch.code,0,launch.stderr);const [job]=await until(c.jobs,rows=>rows.length===1&&rows[0].state==='running'&&!!rows[0].workerPid);
  const r=await exec(process.execPath,['--input-type=module','-e',`import {watchOfflineExecution} from './src/core/execution-guard-loop.ts';console.log(JSON.stringify(await watchOfflineExecution(${JSON.stringify(job.id)},1,{mode:'offline_fixture',fakeExecutable:${JSON.stringify(fake)},policy:{firstEventMs:100,unfinishedReadMs:100,graceMs:100,calibration:'offline-normal'},intervalMs:50,maxDurationMs:8000})));`],root,env);
  assert.equal(r.code,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{kind:'finished',state:'done'});
  assert.equal((await c.jobs())[0].stopRequested,undefined);
});

test('连续真实日志观察驱动假选手停止/保留报告改动/回交，其他任务不受影响', { skip: process.platform === 'win32', timeout: 25000 }, async t => {
  const c = await context(t); assert.equal((await c.add()).code, 0);
  const fake = join(c.temp, 'guard-loop-worker.mjs');
  await writeFile(fake, `import {writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';
writeFileSync('candidate.txt','candidate');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
writeFileSync('own-child.json',JSON.stringify({parent:process.pid,child:child.pid}));
console.log(JSON.stringify({type:'result',result:'retained report'}));
console.log(JSON.stringify({type:'tool_call',subtype:'started',call_id:'read-A',tool_call:{readToolCall:{args:{path:'candidate.txt'}}}}));
setInterval(()=>console.log(JSON.stringify({type:'error',message:'fixture only'})),30);`);
  const env = { ...c.env, XAGENTS_FAKE_WORKER: fake };
  for (let i=0;i<2;i++) { const r=await exec(process.execPath,['--input-type=module','-e',`import {dispatch} from ${JSON.stringify(new URL('../src/core/dispatch.ts',import.meta.url).href)};await dispatch(${JSON.stringify(c.task)},{who:['cursor-sonnet:high'],summary:'loop',kind:'实现'});`],c.repo,env); assert.equal(r.code,0,r.stderr); }
  const [a,b]=await until(c.jobs,j=>j.length===2&&j.every(x=>x.state==='running'&&!!x.workerPid));
  const owned=JSON.parse(await until(()=>readFile(join(a.worktree,'own-child.json'),'utf8').catch(()=>''),Boolean));
  assert.equal(owned.parent,a.workerPid);
  const result=await exec(process.execPath,['--input-type=module','-e',`
import {watchOfflineExecution} from './src/core/execution-guard-loop.ts';
import {mkdir,writeFile} from 'node:fs/promises';
import {PRESETS,parseRun,runFile,autopilotDir,readAutopilot} from './src/core/autopilot.ts';
import {updateJob} from './src/core/job.ts';
const id='1030-0001-auto',job=${JSON.stringify(a.id)},at=new Date().toISOString(),token='loop-token';
const run={id,version:1,project:'demo',repo:${JSON.stringify(c.repo)},base:'a'.repeat(40),taskId:'TASK-001',spec:'docs/tasks/TASK-001.md',who:['cursor-sonnet:high'],network:false,ro:false,policy:PRESETS.standard,state:'executing',created:at,updated:at,elapsedSeconds:0,sleeps:0,attemptCount:1,nodeCount:1,nodes:[{id:'TASK-001',depth:0,state:'running',attempts:1,continues:0,retries:0}],attempts:[{node:'TASK-001',attempt:1,token,at,jobs:[job]}],action:{node:'TASK-001',attempt:1,token,at,jobs:[job]}};
parseRun(run,id);await mkdir(autopilotDir(id),{recursive:true});await writeFile(runFile(id),JSON.stringify(run));
await updateJob(job,j=>j.autopilot={run:id,token});
const outcome=await watchOfflineExecution(job,1,{mode:'offline_fixture',fakeExecutable:${JSON.stringify(fake)},policy:{firstEventMs:500,unfinishedReadMs:100,graceMs:100,calibration:'offline-loop'},intervalMs:50,maxDurationMs:12000});
console.log(JSON.stringify({outcome,run:await readAutopilot(id)}));`],root,env);
  assert.equal(result.code,0,result.stderr); const output=JSON.parse(result.stdout),outcome=output.outcome;
  assert.equal(outcome.kind,'handed-off'); assert.equal(outcome.handoff.kind,'needs_owner');
  assert.equal(output.run.state,'needs_owner'); assert.equal(output.run.attemptCount,1);
  const rows=await c.jobs(),stopped=rows.find(j=>j.id===a.id)!;
  assert.equal(stopped.state,'stopped'); assert.equal(rows.find(j=>j.id===b.id)?.state,'running'); assert.equal(rows.length,2);
  const dir=join(c.home,'jobs',a.id), evidence=JSON.parse(await readFile(join(dir,'execution-guard-1.json'),'utf8'));
  assert.equal(evidence.state.plan.reason,'unfinished-read'); assert.ok(evidence.evidence.errors>0);
  assert.match(await readFile(join(dir,'report.md'),'utf8'),/retained report/);
  assert.match(await readFile(join(dir,'diff.patch'),'utf8'),/candidate.txt/);
  const ps=spawnSync('ps',['-p',[owned.parent,owned.child].join(','),'-o','pid=,ppid=,pgid=,stat='],{encoding:'utf8',timeout:2000,maxBuffer:8192});
  assert.equal(ps.error,undefined); assert.ok(ps.status===0||ps.status===1,ps.stderr); assert.equal(ps.stdout.trim(),'');
});
