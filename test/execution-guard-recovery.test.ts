import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, readFile, access } from 'node:fs/promises';
import { context, exec, root } from './helpers.ts';

for (const stopped of [false, true]) test(`看管进程SIGKILL后冷消费者拒绝${stopped ? '停止计划' : '预警'}，保留原检查点`, { skip: process.platform === 'win32' }, async t => {
  const c = await context(t, false), fake = join(c.temp, 'never-start.mjs');
  const marker = join(c.temp, 'worker-started'), ledger = join(c.temp, 'fake-ledger.json');
  await writeFile(fake, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'started');`);
  await writeFile(ledger, '{"fixtureBalance":123}');
  const prefix = `
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {jobDir} from './src/core/paths.ts';
import {OfflineGuardConsumer} from './src/core/execution-guard-consumer.ts';
import {initialProgress,advanceProgress} from './src/core/execution-progress.ts';
const options={mode:'offline_fixture',fakeExecutable:${JSON.stringify(fake)},policy:{firstEventMs:100,unfinishedReadMs:200,graceMs:50,calibration:'offline-test'}};
const obs=n=>({state:advanceProgress(initialProgress({at:0,asleepMs:0}),{at:n,asleepMs:0}),unavailable:false,backlog:false,ended:false});
const consumer=new OfflineGuardConsumer('A',1,options);
`;
  const run = (body: string) => exec(process.execPath, ['--input-type=module', '-e', prefix + body], root, { ...c.env, XAGENTS_FAKE_WORKER: fake });
  const first = await run(`await mkdir(jobDir('A'),{recursive:true});await writeFile(join(jobDir('A'),'job.json'),JSON.stringify({id:'A',state:'running',command:{args:[${JSON.stringify(fake)}]}}));await consumer.sample(obs(100));${stopped ? 'await consumer.sample(obs(150));' : ''}process.kill(process.pid,'SIGKILL');`);
  assert.equal(first.code, null, first.stderr);
  const dir = join(c.home, 'jobs', 'A');
  const files = [join(dir, 'execution-guard-1.json'), join(dir, 'job.json'), ledger];
  const before = await Promise.all(files.map(f => readFile(f, 'utf8')));
  assert.equal(Boolean(JSON.parse(before[0]).state.plan), stopped);
  assert.equal(Boolean(JSON.parse(before[1]).stopRequested), stopped);
  const cold = await run(`await assert.rejects(()=>consumer.sample(obs(200)));`);
  assert.equal(cold.code, 0, cold.stderr);
  assert.deepEqual(await Promise.all(files.map(f => readFile(f, 'utf8'))), before);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  assert.equal((await c.jobs()).length, 1);
});
