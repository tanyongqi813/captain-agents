import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { reserveMoney, observeMoney, readMoneyStatus } from '../src/core/money-budget.ts';
const config = { ...defaultDeepseekMoney, enabled: true, reserve: 1,
  pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
const now = Date.parse('2026-10-27T19:00:00Z');
const file = (home: string) => join(home, 'money-budget', 'deepseek.json');

test('实际模型与组身份复制冻结，同ID改归属或删除身份拒绝且原账不变', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const identity = { budgetGroup: 'default', model: 'relay/flash-v1' };
  await reserveMoney('one', config, config.pro, now, identity);
  identity.model = 'mutated';
  const frozen = { budgetGroup: 'default', model: 'relay/flash-v1' };
  await reserveMoney('one', config, { input: 99, cached: 99, output: 99 }, now, frozen);
  const original = await readFile(file(c.home), 'utf8');
  const entry = JSON.parse(original).entries.one;
  assert.deepEqual(entry.identity, frozen); assert.deepEqual(entry.price, config.pro);
  for (const changed of [undefined, { ...frozen, budgetGroup: 'another' }, { ...frozen, model: 'pro' }]) {
    await assert.rejects(reserveMoney('one', config, config.pro, now, changed), /身份与原记录不一致/);
    assert.equal(await readFile(file(c.home), 'utf8'), original);
  }
  await observeMoney('one', config, { read: 200_000, cached: 0, out: 0 }, true, now);
  assert.deepEqual(JSON.parse(await readFile(file(c.home), 'utf8')).entries.one.identity, frozen);
});

test('旧账模型保持未知，不回填历史身份，不清空旧消费或预留', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('legacy', config, config.pro, now);
  await observeMoney('legacy', config, { read: 200_000, cached: 0, out: 0 }, false, now);
  const original = await readFile(file(c.home), 'utf8');
  await assert.rejects(reserveMoney('legacy', config, config.pro, now, { budgetGroup: 'default', model: 'new' }), /补写历史模型/);
  assert.equal(await readFile(file(c.home), 'utf8'), original);
  assert.equal(JSON.parse(original).entries.legacy.identity, undefined);
  const state = await readMoneyStatus(now); assert.equal(state.spent, 0.2); assert.equal(state.reserved, 0.8);
});

test('非法身份/坏账拒绝；组标签不创建独立额度或重置消费', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('old', config, config.pro, now);
  const original = await readFile(file(c.home), 'utf8');
  for (const identity of [{ budgetGroup: '../escape', model: 'x' }, { budgetGroup: 'a', model: 'https://secret/model' },
    { budgetGroup: '', model: 'x' }, { budgetGroup: 'a', model: '' }, { budgetGroup: 'a', model: 'x', key: 'forbidden' }]) {
    await assert.rejects(reserveMoney('bad', config, config.pro, now, identity), /身份不合法/);
    assert.equal(await readFile(file(c.home), 'utf8'), original);
  }
  const limited = { ...config, soft: 1, hard: 1 };
  await assert.rejects(reserveMoney('other', limited, config.pro, now, { budgetGroup: 'another', model: 'x' }), /预算/);
  const book = JSON.parse(await readFile(file(c.home), 'utf8'));
  book.entries.old.identity = { budgetGroup: 'bad/path', model: 'x' };
  await writeFile(file(c.home), JSON.stringify(book));
  await assert.rejects(readMoneyStatus(now), /账本内容不合法/);
});
