import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, until } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney, deepseekEndpoint } from '../src/core/deepseek-settings.ts';
import { readDeepseekRuntimeSettings, writeSettings } from '../src/core/settings.ts';
import { reserveMoney, observeMoney } from '../src/core/money-budget.ts';
import { buildView } from '../src/core/view.ts';
const money = { ...defaultDeepseekMoney, enabled: true, soft: 4, hard: 5, reserve: 1,
  pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
const endpoint = { ...defaultDeepseekEndpoint, proReasoning: 'default' as const, flashReasoning: 'default' as const,
  money, moneyGroups: { accountB: { ...money, pro: { input: 2, cached: 0, output: 1 } } }, budgetGroup: 'accountB' };

test('保存DeepSeek活动组不影响Codex派发，显式错误组选项仍拒绝', async t => {
  const c = await context(t); process.env.XAGENTS_HOME = c.home;
  assert.equal((await c.add()).code, 0);
  await writeSettings({ keepAwake: false, deepseek: endpoint });
  const fake = join(c.temp, 'other-worker.mjs');
  await writeFile(fake, "import {writeFileSync} from 'node:fs'; const at=process.argv.indexOf('-o'); writeFileSync(process.argv[at+1],'其他通道完成');");
  const result = await c.cli(['run', c.task, '--summary', '验证其他通道不继承预算组', '--who', 'codex:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(result.code, 0, result.stderr);
  const job = await until(async () => (await c.jobs())[0], j => !!j && ['done','failed','stopped'].includes(j.state), 15000);
  assert.equal(job.state, 'done', job.error); assert.equal(job.deepseekBudgetGroup, undefined);
  await assert.rejects(readFile(join(c.home, 'money-budget', 'deepseek.json')), { code: 'ENOENT' });
  const { dispatch } = await import('../src/core/dispatch.ts');
  await assert.rejects(dispatch(c.task, { who: ['codex:high'], summary: '错误组选项拒绝', moneyGroup: 'accountB' }), /只用于DeepSeek/);
});

test('活动组选项严格保存，缺失/非法拒绝且不覆盖文件，换地址不清默认账', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await writeSettings({ deepseek: endpoint });
  assert.equal((await readDeepseekRuntimeSettings()).budgetGroup, 'accountB');
  const file = join(c.home, 'config.json'), before = await readFile(file, 'utf8');
  for (const budgetGroup of ['missing', '../bad', '', 'constructor']) {
    assert.throws(() => deepseekEndpoint({ ...endpoint, budgetGroup }));
    await assert.rejects(writeSettings({ deepseek: { ...endpoint, budgetGroup } }));
    assert.equal(await readFile(file, 'utf8'), before);
  }
  await reserveMoney('old', money, money.pro);
  await observeMoney('old', money, { read: 100000, cached: 0, out: 0 }, true);
  const book = join(c.home, 'money-budget', 'deepseek.json'), original = await readFile(book, 'utf8');
  await writeSettings({ deepseek: { ...endpoint, baseUrl: 'https://changed.invalid/v1/' } });
  assert.equal(await readFile(book, 'utf8'), original);
});

test('真实CLI默认采用保存组，冻结同组价格及视图，不借默认额度；切回不改历史', async t => {
  const c = await context(t); process.env.XAGENTS_HOME = c.home;
  assert.equal((await c.add()).code, 0);
  await writeSettings({ keepAwake: false, deepseek: endpoint });
  const fake = join(c.temp, 'active-group.mjs');
  await writeFile(fake, "import {writeFileSync} from 'node:fs'; const at=process.argv.indexOf('-o'); writeFileSync(process.argv[at+1],'组选择完成'); console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100000,cached_input_tokens:0,output_tokens:0}}));");
  const result = await c.cli(['run', c.task, '--summary', '验证保存预算组', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.equal(result.code, 0, result.stderr);
  const job = await until(async () => (await c.jobs())[0], j => !!j && ['done','failed','stopped'].includes(j.state), 15000);
  assert.equal(job.state, 'done', job.error); assert.equal(job.deepseekBudgetGroup, 'accountB');
  assert.equal(job.deepseekConnection?.money?.pro.input, 2);
  const file = join(c.home, 'money-budget', 'deepseek.json'), raw = await readFile(file, 'utf8'), book = JSON.parse(raw);
  assert.equal(book.entries[job.id].charged, 200000);
  assert.equal((await buildView({ found: async () => true, windows: false })).moneyBudget?.spent, 0.2);
  await writeSettings({ deepseek: { ...endpoint, budgetGroup: 'default' } });
  assert.equal((await buildView({ found: async () => true, windows: false })).moneyBudget?.spent, 0);
  assert.equal(await readFile(file, 'utf8'), raw);
  await writeSettings({ deepseek: { ...endpoint, moneyGroups: { accountB: { ...money, enabled: false } } } });
  const denied = await c.cli(['run', c.task, '--summary', '关闭组不应派活', '--who', 'deepseek:high'], { XAGENTS_FAKE_WORKER: fake });
  assert.notEqual(denied.code, 0); assert.match(denied.stderr, /须先启用/);
  assert.equal((await c.jobs()).length, 1);
});
