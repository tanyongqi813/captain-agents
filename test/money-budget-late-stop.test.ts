import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { reserveMoney, observeMoney, readMoneyStatus } from '../src/core/money-budget.ts';
import { defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
test('终态迟到费用按冻结组/价格补差超额，持久停派与重放幂等，不转default', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const at = Date.parse('2026-10-29T01:00:00Z');
  const config = { ...defaultDeepseekMoney, enabled: true, soft: 0.8, hard: 1, reserve: 0.5,
    pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
  await reserveMoney('ended', config, config.pro, at, { budgetGroup: 'accountB', model: 'saved-model' }, 'accountB');
  await observeMoney('ended', config, undefined, true, at + 1000);
  assert.equal((await readMoneyStatus(at + 1000, config, 'accountB')).spent, 0.5);
  const changed = { ...config, pro: { input: 100, cached: 0, output: 100 } };
  const usage = { read: 1200000, cached: 0, out: 0 };
  assert.match((await observeMoney('ended', changed, usage, true, at + 2000))!, /费用上限/);
  const status = await readMoneyStatus(at + 2000, config, 'accountB');
  assert.equal(status.spent, 1.2); assert.equal(status.reserved, 0); assert.equal(status.stopped, true);
  assert.equal(Math.round((status.spent - config.hard) * 1000000), 200000);
  assert.equal((await readMoneyStatus(at + 2000, config)).spent, 0);
  const file = join(c.home, 'money-budget', 'deepseek.json'), before = await readFile(file, 'utf8');
  await observeMoney('ended', changed, usage, true, at + 3000);
  assert.equal(await readFile(file, 'utf8'), before);
  await assert.rejects(reserveMoney('new', config, config.pro, at + 4000,
    { budgetGroup: 'accountB', model: 'saved-model' }, 'accountB'), /预算或上限/);
  const book = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(book.entries.ended.active, false); assert.equal(book.entries.ended.charged, 1200000);
  assert.equal(book.entries.ended.price.input, 1); assert.equal(book.entries.ended.budgetGroup, 'accountB');
  assert.equal(book.entries.new, undefined);
});

