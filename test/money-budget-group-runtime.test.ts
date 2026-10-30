import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec, until } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { writeSettings } from '../src/core/settings.ts';
const dispatchUrl = new URL('../src/core/dispatch.ts', import.meta.url).href;
const money = { ...defaultDeepseekMoney, enabled: true, soft: 4, hard: 5, reserve: 1,
  pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };

for (const kind of ['lower', 'missing'] as const) test(`显式B组任务冻结归属：${kind}，不误用默认低阈值`, { timeout: 30_000 }, async t => {
  const c = await context(t); process.env.XAGENTS_HOME = c.home;
  assert.equal((await c.add()).code, 0);
  const endpoint = { ...defaultDeepseekEndpoint, proReasoning: 'default' as const, flashReasoning: 'default' as const, money: { ...money, soft: 0.1, hard: 0.1, reserve: 0.1 }, moneyGroups: { accountB: money } };
  await writeSettings({ keepAwake: false, deepseek: endpoint });
  const tick = join(c.temp, 'worker-tick'), fake = join(c.temp, 'group-worker.mjs');
  await writeFile(fake, `import {writeFileSync} from 'node:fs';
    writeFileSync('proof.txt','保留分组成果');
    const at=process.argv.indexOf('-o'); if(at<0) throw new Error('缺报告路径');
    writeFileSync(process.argv[at+1],'分组替身报告');
    process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:200000,cached_input_tokens:0,output_tokens:0}})+String.fromCharCode(10));
    setInterval(()=>writeFileSync(${JSON.stringify(tick)},String(Date.now())),100);`);
  const launched = await exec(process.execPath, ['--input-type=module', '-e', `import {dispatch} from ${JSON.stringify(dispatchUrl)};
    await dispatch(${JSON.stringify(c.task)},{who:['deepseek:high'],summary:'分组运行验证',moneyGroup:'accountB'});`], c.repo, { ...c.env, XAGENTS_FAKE_WORKER: fake });
  assert.equal(launched.code, 0, launched.stderr);
  const job = await until(async () => (await c.jobs())[0], j => !!j && j.state === 'running', 15_000);
  assert.equal(job.deepseekBudgetGroup, 'accountB');
  assert.equal(job.deepseekConnection?.money?.hard, 5);
  const bookPath = join(c.home, 'money-budget', 'deepseek.json');
  const book = () => readFile(bookPath, 'utf8').then(text => JSON.parse(text));
  await until(book, b => b.entries[job.id]?.charged === 200_000, 10_000);
  const firstTick = Number(await readFile(tick, 'utf8'));
  await until(async () => Number(await readFile(tick, 'utf8')), value => value - firstTick > 2200, 8000);
  assert.equal((await c.jobs()).find(j => j.id === job.id)?.state, 'running', '默认0.1上限不能误停B组0.2消费');
  const nextGroups = kind === 'missing' ? {} : { accountB: { ...money, soft: 0.1, hard: 0.2, reserve: 0.1 } };
  await writeSettings({ deepseek: { ...endpoint, baseUrl: 'https://changed.example/v1/', moneyGroups: nextGroups } });
  const ended = await until(async () => (await c.jobs()).find(j => j.id === job.id)!, j => !!j && ['stopped', 'failed', 'done'].includes(j.state), 15_000);
  assert.ok(['stopped', 'failed'].includes(ended.state), ended.error);
  assert.match(ended.error ?? '', kind === 'lower' ? /费用上限/ : /费用/);
  assert.match(await readFile(join(c.home, 'jobs', job.id, 'report.md'), 'utf8'), /分组替身报告/);
  assert.match(await readFile(join(c.home, 'jobs', job.id, 'diff.patch'), 'utf8'), /proof.txt/);
  const final = await book();
  assert.equal(final.entries[job.id].budgetGroup, 'accountB');
  assert.equal(Object.values<number>(final.days).reduce((sum, n) => sum + n, 0), 0);
  assert.deepEqual(final.stopped, []);
  if (kind === 'lower') {
    assert.equal(final.entries[job.id].active, false);
    assert.equal(Object.values<number>(final.groups.accountB.days).reduce((sum, n) => sum + n, 0), 1_000_000);
    assert.ok(final.groups.accountB.stopped.length > 0);
  } else {
    assert.equal(final.entries[job.id].active, true, '无法取得该组阈值时保留预占待回收，不伪装免费结清');
  }
});

test('显式缺失或关闭组在注册前拒绝，不回退默认预算', async t => {
  const c = await context(t); process.env.XAGENTS_HOME = c.home;
  assert.equal((await c.add()).code, 0);
  await writeSettings({ deepseek: { ...defaultDeepseekEndpoint, money, moneyGroups: { closed: { ...money, enabled: false } } } });
  for (const group of ['missing', 'closed']) {
    const result = await exec(process.execPath, ['--input-type=module', '-e', `import {dispatch} from ${JSON.stringify(dispatchUrl)};
      await dispatch(${JSON.stringify(c.task)},{who:['deepseek:high'],summary:'拒绝无效组',moneyGroup:${JSON.stringify(group)}});`], c.repo, c.env);
    assert.notEqual(result.code, 0); assert.match(result.stderr, /预算组/);
    assert.equal((await c.jobs()).length, 0);
  }
});
