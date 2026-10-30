import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, until } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { writeSettings } from '../src/core/settings.ts';

for (const kind of ['hard', 'soft'] as const) test(`运行中保存${kind}预算，真实看管使用新阈值且释放安全余量`, { timeout: 30_000 }, async t => {
  const c = await context(t);
  process.env.XAGENTS_HOME = c.home;
  assert.equal((await c.add()).code, 0);
  const endpoint = { ...defaultDeepseekEndpoint, proReasoning: 'default' as const, flashReasoning: 'default' as const, money: { ...defaultDeepseekMoney, enabled: true,
    soft: 4, hard: 5, reserve: 1, safetyMargin: 0.5,
    pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } } };
  await writeSettings({ keepAwake: false, deepseek: endpoint });
  const release = join(c.temp, 'release'), heartbeat = join(c.temp, 'worker-tick');
  const fake = join(c.temp, 'runtime-money-worker.mjs');
  await writeFile(fake, `import {existsSync,writeFileSync} from 'node:fs';
    process.stdout.write(JSON.stringify({type:'turn.started'})+String.fromCharCode(10));
    process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:200000,cached_input_tokens:0,output_tokens:0}})+String.fromCharCode(10));
    setInterval(()=>{
      writeFileSync(${JSON.stringify(heartbeat)},String(Date.now()));
      if(existsSync(${JSON.stringify(release)})) {
        const at=process.argv.indexOf('-o'); if(at<0) throw new Error('缺报告路径');
        writeFileSync(process.argv[at+1],'预算变更替身完成'); process.exit(0);
      }
    },100);`);
  const run = await c.cli(['run', c.task, '--summary', '运行中保存预算', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(run.code, 0, run.stderr);
  const bookPath = join(c.home, 'money-budget', 'deepseek.json');
  const book = () => readFile(bookPath, 'utf8').then(text => JSON.parse(text));
  const initial = await until(book, b => Object.values<{ charged: number }>(b.entries).some(e => e.charged === 200_000), 15_000);
  const job = (await c.jobs())[0];
  assert.equal(job.state, 'running');
  assert.equal(initial.entries[job.id].margin, 500_000);
  const changed = kind === 'hard'
    ? { ...endpoint, money: { ...endpoint.money, soft: 0.1, hard: 0.2, reserve: 0.1, safetyMargin: 0 } }
    : { ...endpoint, money: { ...endpoint.money, soft: 0.1 } };
  await writeSettings({ deepseek: changed });
  if (kind === 'soft') {
    const tickBefore = Number(await readFile(heartbeat, 'utf8'));
    const next = await c.cli(['run', c.task, '--summary', '软阈值应拒绝', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
    assert.match(next.stderr, /预算/);
    const rejected = (await c.jobs()).filter(j => j.id !== job.id);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].state, 'failed');
    assert.equal(rejected[0].workerPid, undefined);
    const afterRejection = await book();
    assert.ok(!afterRejection.entries[rejected[0].id]?.active);
    assert.equal(afterRejection.entries[job.id].active, true);
    // 至少跨一个2秒看管周期，证明软阈值不会误停既有运行进程。
    await until(async () => Number(await readFile(heartbeat, 'utf8')), tick => tick - tickBefore > 2200, 8000);
    assert.equal((await c.jobs()).find(j => j.id === job.id)?.state, 'running');
    await writeFile(release, 'done');
  }
  const ended = await until(async () => (await c.jobs()).find(j => j.id === job.id)!, j => !!j && ['done', 'failed', 'stopped'].includes(j.state), 15_000);
  assert.equal(ended.state, kind === 'hard' ? 'stopped' : 'done', ended.error);
  if (kind === 'hard') assert.match(ended.error ?? '', /费用上限/);
  else assert.match(await readFile(join(c.home, 'jobs', job.id, 'report.md'), 'utf8'), /替身完成/);
  const final = await book();
  assert.equal(final.entries[job.id].active, false);
  assert.equal(final.entries[job.id].margin, 500_000); // 保存变化不追溯修改本轮冻结值。
  assert.equal(final.entries[job.id].charged, kind === 'hard' ? 1_000_000 : 200_000);
  assert.equal(Object.values<number>(final.days).reduce((sum, n) => sum + n, 0), kind === 'hard' ? 1_000_000 : 200_000);
  if (kind === 'hard') assert.ok(final.stopped.length > 0);
});
