import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { context, exec, until, root } from './helpers.ts';
import { finalTreeCleanup, isWindows } from '../src/core/platform.ts';

test('终态清理只缓存同一已退出成功组，首次错误/未退出/换身份仍清理', () => {
  let calls = 0, fail = true;
  const cleanup = finalTreeCleanup(() => { calls++; if (fail) { fail = false; throw Object.assign(new Error('fixture'), {code:'EPERM'}); } });
  assert.throws(() => cleanup(123, 1, 2), {code:'EPERM'});
  cleanup(123, 1, 2); cleanup(123, 1, 2); assert.equal(calls, isWindows ? 3 : 2);
  cleanup(123, 1, 3); cleanup(123, 1); cleanup(123, 1);
  assert.equal(calls, isWindows ? 6 : 5);
});

test('真实runner假进程持续输出仍按请求停A，子孙停止/报告补丁保留，B继续且无重派', { timeout: 40_000 }, async t => {
  const c = await context(t); assert.equal((await c.add()).code, 0);
  const fake = join(c.temp, 'guard-worker.mjs'), release = join(c.temp, 'release-B'), nonce = randomUUID();
  const runnerProbe = join(c.temp, 'runner-diagnostic.mjs');
  await writeFile(runnerProbe, `import {readFileSync,appendFileSync} from 'node:fs';import {join} from 'node:path';
import {jobDir} from ${JSON.stringify(new URL('../src/core/paths.ts', import.meta.url).href)};
import {runWorker} from ${JSON.stringify(new URL('../src/core/runner.ts', import.meta.url).href)};
const id=process.argv[2],original=process.kill.bind(process);process.kill=(pid,signal)=>{
let job;try{job=JSON.parse(readFileSync(join(jobDir(id),'job.json'),'utf8'));}catch{}
if(pid!==-job?.workerPid || !['SIGKILL','SIGTERM'].includes(signal))return original(pid,signal);
let outcome='OK';try{return original(pid,signal);}catch(e){outcome=e.code;throw e;}
finally{appendFileSync(join(jobDir(id),'kill-diagnostic.jsonl'),JSON.stringify({pid,signal,outcome,stack:new Error().stack.split('\\n').slice(2,5)})+'\\n');}};
await runWorker(id);`);
  await writeFile(fake, `import {writeFileSync,existsSync} from 'node:fs';import {spawn} from 'node:child_process';
writeFileSync('proof.txt','guard candidate');const o=process.argv.indexOf('-o');if(o<0)throw Error('missing report');
writeFileSync(process.argv[o+1],'guard preserved report');
const child=spawn(process.execPath,['-e',"const fs=require('node:fs');setInterval(()=>fs.writeFileSync('child-tick.txt',String(Date.now())),50)"],{stdio:'ignore'});
writeFileSync('child-identity.json',JSON.stringify({nonce:${JSON.stringify(nonce)},parent:process.pid,child:child.pid}));
setInterval(()=>{writeFileSync('tick.txt',String(Date.now()));console.log(JSON.stringify({type:'item.completed',item:{type:'error',message:'fixture error'}}));
if(existsSync(${JSON.stringify(release)}))process.exit(0);},50);`);
  const env = { ...c.env, XAGENTS_FAKE_WORKER: fake };
  const launch = () => exec(process.execPath, ['--input-type=module', '-e', `import {dispatch,launch} from ${JSON.stringify(new URL('../src/core/dispatch.ts', import.meta.url).href)};await dispatch(${JSON.stringify(c.task)},{who:['codex:high'],summary:'停滞组合',kind:'实现'},job=>launch(job,${JSON.stringify(runnerProbe)}));`], c.repo, env);
  for (let i = 0; i < 2; i++) { const r = await launch(); assert.equal(r.code, 0, r.stderr); }
  const jobs = await until(c.jobs, rows => rows.length === 2 && rows.every(j => j.state === 'running'), 12_000), [a, b] = jobs;
  await until(async () => readFile(join(a.worktree, 'child-tick.txt'), 'utf8').catch(() => ''), Boolean);
  const trigger = await exec(process.execPath, ['--input-type=module', '-e', `
import {OfflineGuardConsumer} from './src/core/execution-guard-consumer.ts';
import {initialProgress,advanceProgress} from './src/core/execution-progress.ts';
const consumer=new OfflineGuardConsumer(${JSON.stringify(a.id)},1,{mode:'offline_fixture',fakeExecutable:${JSON.stringify(fake)},
policy:{firstEventMs:100,unfinishedReadMs:200,graceMs:50,calibration:'offline-runner'}});
const obs=n=>({state:advanceProgress(initialProgress({at:0,asleepMs:0}),{at:n,asleepMs:0}),unavailable:false,backlog:false,ended:false});
await consumer.sample(obs(100));console.log(JSON.stringify(await consumer.sample(obs(150))));`], root, env);
  assert.equal(trigger.code, 0, trigger.stderr); assert.equal(JSON.parse(trigger.stdout).requested, true);
  const stopped = await until(async () => (await c.jobs()).find(j => j.id === a.id)!, j => j.state === 'stopped', 12_000);
  assert.equal(stopped.stopRequested, true);
  assert.match(await readFile(join(c.home, 'jobs', a.id, 'report.md'), 'utf8'), /guard preserved report/);
  assert.match(await readFile(join(c.home, 'jobs', a.id, 'diff.patch'), 'utf8'), /proof.txt/);
  const child = await readFile(join(a.worktree, 'child-tick.txt'), 'utf8');
  const beforeB = Number(await readFile(join(b.worktree, 'tick.txt'), 'utf8'));
  await sleep(1200);
  assert.equal(await readFile(join(a.worktree, 'child-tick.txt'), 'utf8'), child);
  assert.ok(Number(await readFile(join(b.worktree, 'tick.txt'), 'utf8')) > beforeB);
  assert.equal((await c.jobs()).find(j => j.id === b.id)?.state, 'running');
  assert.equal((await c.jobs()).length, 2);
  const evidence = JSON.parse(await readFile(join(c.home, 'jobs', a.id, 'execution-guard-1.json'), 'utf8'));
  assert.equal(evidence.handoff.target, 'lead'); assert.equal(evidence.state.plan.jobId, a.id);
  const owned = JSON.parse(await readFile(join(b.worktree, 'child-identity.json'), 'utf8'));
  const latestB = (await c.jobs()).find(j => j.id === b.id)!;
  assert.equal(owned.nonce, nonce); assert.equal(owned.parent, latestB.workerPid);
  const rows = () => {
    if (process.platform === 'win32') return { skipped: 'POSIX只读诊断不用于Windows' };
    const r = spawnSync('ps', ['-p', [latestB.pid, owned.parent, owned.child].join(','), '-o', 'pid=,ppid=,pgid=,stat='], { encoding:'utf8',timeout:2000,maxBuffer:8192 });
    if(r.error || (r.status!==0 && r.status!==1))throw Error(`自有PID只读诊断失败：${r.error?.message ?? r.stderr.trim()}`);
    return r.stdout.trim();
  };
  const before = rows();
  await writeFile(release, 'done');
  const done = await until(async () => (await c.jobs()).find(j => j.id === b.id)!, j => ['done','failed','stopped'].includes(j.state), 12_000);
  t.diagnostic(JSON.stringify({owned,runner:latestB.pid,before,after:rows(),state:done.state,error:done.error,exit:done.exit,termination:done.termination}));
  t.diagnostic(await readFile(join(c.home,'jobs',b.id,'kill-diagnostic.jsonl'),'utf8'));
  assert.equal(done.state, 'done', done.error);
});
