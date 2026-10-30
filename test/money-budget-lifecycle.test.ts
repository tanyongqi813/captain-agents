import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec, until } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { reserveMoney, observeMoney } from '../src/core/money-budget.ts';

const config = { ...defaultDeepseekMoney, enabled: true, soft: 4, hard: 5, reserve: 1, unknownSeconds: 30,
  pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
const moduleUrl = new URL('../src/core/money-budget.ts', import.meta.url).href;

test('冷启动重放累计量不续无观测时限，时间间隔后停止且终态不能续接', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const now = Date.parse('2026-10-28T01:00:00Z');
  const usage = { read: 200_000, cached: 0, out: 0 };
  await reserveMoney('cold', config, config.pro, now);
  assert.equal(await observeMoney('cold', config, usage, false, now + 1000), null);
  const file = join(c.home, 'money-budget', 'deepseek.json');
  const original = JSON.parse(await readFile(file, 'utf8')).entries.cold;
  const cold = await exec(process.execPath, ['--input-type=module', '-e',
    `import {observeMoney,readMoneyStatus} from ${JSON.stringify(moduleUrl)};
     const reason=await observeMoney('cold',${JSON.stringify(config)},${JSON.stringify(usage)},false,${now + 90_000});
     console.log(JSON.stringify({reason,status:await readMoneyStatus(${now + 90_000})}));`], c.repo, c.env);
  assert.equal(cold.code, 0, cold.stderr);
  const result = JSON.parse(cold.stdout);
  assert.match(result.reason, /无观测时限/);
  assert.equal(result.status.spent, 0.2); assert.equal(result.status.reserved, 0.8);
  const entry = JSON.parse(await readFile(file, 'utf8')).entries.cold;
  assert.equal(entry.observed, original.observed); assert.equal(entry.lastUsageAt, original.lastUsageAt);
  assert.equal(entry.active, true); // 停止原因本身不伪造终态或释放资金。
  await observeMoney('cold', config, undefined, true, now + 91_000);
  const final = await readFile(file, 'utf8');
  assert.match((await observeMoney('cold', config, usage, false, now + 92_000))!, /不会自动续接/);
  assert.equal(await readFile(file, 'utf8'), final);
});

test('真实看管在持续活动但无token时限后停止并保存报告补丁', { timeout: 55_000 }, async t => {
  const c = await context(t);
  assert.equal((await c.add()).code, 0);
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ keepAwake: false,
    deepseek: { ...defaultDeepseekEndpoint, proReasoning: 'default', flashReasoning: 'default', money: config } }));
  const fake = join(c.temp, 'no-usage-worker.mjs');
  await writeFile(fake, `import {writeFileSync} from 'node:fs';
    const at=process.argv.indexOf('-o'); if(at<0) throw new Error('缺报告路径');
    writeFileSync(process.argv[at+1],'无用量前已完成的报告');
    writeFileSync('proof.txt','无用量前的成果');
    setInterval(()=>{writeFileSync('tick.txt',String(Date.now())); process.stdout.write(JSON.stringify({type:'turn.started'})+String.fromCharCode(10));},100);`);
  const start = Date.now();
  const run = await c.cli(['run', c.task, '--summary', '无用量时限验收', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(run.code, 0, run.stderr);
  const job = await until(async () => (await c.jobs())[0], j => !!j && ['done', 'failed', 'stopped'].includes(j.state), 45_000);
  assert.equal(job.state, 'stopped', job.error); assert.match(job.error ?? '', /无观测时限/);
  assert.ok(Date.now() - start >= 30_000);
  assert.match(await readFile(join(c.home, 'jobs', job.id, 'report.md'), 'utf8'), /已完成的报告/);
  assert.match(await readFile(join(c.home, 'jobs', job.id, 'diff.patch'), 'utf8'), /proof.txt/);
  const book = JSON.parse(await readFile(join(c.home, 'money-budget', 'deepseek.json'), 'utf8'));
  const entry = book.entries[job.id];
  assert.equal(entry.active, false); assert.equal(entry.unknown, true);
  assert.equal(entry.source, 'reservation_fallback'); assert.equal(entry.charged, 1_000_000);
  assert.equal(Object.values<number>(book.days).reduce((a, b) => a + b, 0), 1_000_000);
});
