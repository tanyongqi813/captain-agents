import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec, until } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';

test('冷进程续接已结算收费任务被拒，旧成果费用保留且不启动第二个选手', { timeout: 35_000 }, async t => {
  const c = await context(t); assert.equal((await c.add()).code, 0);
  const money = { ...defaultDeepseekMoney, enabled: true, soft: 4, hard: 5, reserve: 1,
    pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ keepAwake: false, deepseek: { ...defaultDeepseekEndpoint, proReasoning: 'default', flashReasoning: 'default', money } }));
  const fake = join(c.temp, 'recovery-worker.mjs'), launches = join(c.temp, 'worker-launches');
  await writeFile(fake, `import {appendFileSync,writeFileSync} from 'node:fs';
    appendFileSync(${JSON.stringify(launches)},'launch'+String.fromCharCode(10));
    const at=process.argv.indexOf('-o'); if(at<0) throw new Error('缺报告路径');
    writeFileSync(process.argv[at+1],'第一轮已完成报告'); writeFileSync('proof.txt','第一轮成果');
    for(const row of [{type:'thread.started',thread_id:'12345678-1234-1234-1234-123456789abc'}, {type:'turn.completed',usage:{input_tokens:200000,cached_input_tokens:0,output_tokens:0}}]) process.stdout.write(JSON.stringify(row)+String.fromCharCode(10));`);
  const env = { ...c.env, XAGENTS_FAKE_WORKER: fake };
  const run = await c.cli(['run', c.task, '--summary', '收费恢复验收', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(run.code, 0, run.stderr);
  const first = await until(async () => (await c.jobs())[0], j => !!j && ['done', 'failed', 'stopped'].includes(j.state), 15_000);
  assert.equal(first.state, 'done', first.error);
  const book = join(c.home, 'money-budget', 'deepseek.json');
  const before = await readFile(book, 'utf8');
  assert.equal(JSON.parse(before).entries[first.id].charged, 200_000);
  const wakeUrl = new URL('../src/core/wake.ts', import.meta.url).href;
  const jobUrl = new URL('../src/core/job.ts', import.meta.url).href;
  const resumed = await exec(process.execPath, ['--input-type=module', '-e',
    `import {resumeMember,rememberSession} from ${JSON.stringify(wakeUrl)};
     import {readJob} from ${JSON.stringify(jobUrl)};
     const job=await rememberSession(await readJob(${JSON.stringify(first.id)}));
     if(!job.session) throw new Error('未保存会话');
     console.log(await resumeMember(job,2,'不得启动的第二轮'));`], c.repo, env);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(resumed.stdout.trim(), 'true'); // 接受请求不等于选手已启动。
  const ended = await until(async () => (await c.jobs()).find(j => j.id === first.id)!,
    j => j.resume?.round === 2 && ['failed', 'stopped', 'done'].includes(j.state), 15_000);
  assert.equal(ended.state, 'failed'); assert.match(ended.error ?? '', /不续接已结算的会话/);
  assert.equal(await readFile(launches, 'utf8'), 'launch\n');
  assert.equal(ended.workerPid, undefined);
  assert.equal(await readFile(book, 'utf8'), before);
  const dir = join(c.home, 'jobs', first.id);
  assert.match(await readFile(join(dir, 'report-r1.md'), 'utf8'), /第一轮已完成报告/);
  assert.match(await readFile(join(dir, 'diff-r1.patch'), 'utf8'), /proof.txt/);
});
