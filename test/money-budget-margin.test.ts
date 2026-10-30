import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { deepseekMoney, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { reserveMoney, observeMoney, readMoneyStatus } from '../src/core/money-budget.ts';

const config = { ...defaultDeepseekMoney, enabled: true, soft: 3, hard: 3, reserve: 1, safetyMargin: 1,
  pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
const now = Date.parse('2026-10-27T18:00:00Z');
const usage = (read: number) => ({ read, cached: 0, out: 0 });
const file = (home: string) => join(home, 'money-budget', 'deepseek.json');

test('安全余量验证兼容缺省及零，拒绝非法数值', () => {
  const { safetyMargin: _, ...legacy } = config;
  assert.equal(deepseekMoney(legacy).safetyMargin, undefined);
  assert.equal(deepseekMoney({ ...config, safetyMargin: 0 }).safetyMargin, 0);
  for (const value of [-1, NaN, Infinity, '1', 4, null]) assert.throws(() => deepseekMoney({ ...config, safetyMargin: value }), /安全余量/);
});

test('余量原子占用硬上限、冻结且幂等，已知结算只记实际用量', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('one', config, config.pro, now);
  await reserveMoney('one', { ...config, safetyMargin: 0 }, config.pro, now);
  assert.equal((await readMoneyStatus(now, config)).reserved, 2);
  assert.equal((await readMoneyStatus(now, config)).remaining, 1);
  await assert.rejects(reserveMoney('two', config, config.pro, now), /预算不足/);
  assert.equal(JSON.parse(await readFile(file(c.home), 'utf8')).entries.two, undefined);
  await observeMoney('one', config, usage(200_000), true, now);
  await observeMoney('one', config, usage(200_000), true, now);
  const state = await readMoneyStatus(now);
  assert.equal(state.spent, 0.2); assert.equal(state.reserved, 0);
});

test('缺量收尾及旧终态回收只结算执行预留，不计安全余量', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('unknown', config, config.pro, now);
  await observeMoney('unknown', config, undefined, true, now);
  await observeMoney('unknown', config, undefined, true, now);
  assert.equal((await readMoneyStatus(now)).spent, 1);
  await reserveMoney('ended', config, config.pro, now);
  await mkdir(join(c.home, 'jobs', 'ended'), { recursive: true });
  await writeFile(join(c.home, 'jobs', 'ended', 'job.json'), JSON.stringify({ state: 'done' }));
  await reserveMoney('next', { ...config, safetyMargin: 0 }, config.pro, now);
  assert.equal((await readMoneyStatus(now)).spent, 2);
  assert.equal((await readMoneyStatus(now)).reserved, 1);
});

test('执行预留耗尽不借安全余量延长；旧账兼容，坏余量拒绝', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('limit', config, config.pro, now);
  assert.match((await observeMoney('limit', config, usage(1_000_000), false, now))!, /预留/);
  const book = JSON.parse(await readFile(file(c.home), 'utf8'));
  delete book.entries.limit.margin;
  await writeFile(file(c.home), JSON.stringify(book));
  assert.equal((await readMoneyStatus(now)).reserved, 0);
  book.entries.limit.margin = -1;
  await writeFile(file(c.home), JSON.stringify(book));
  await assert.rejects(readMoneyStatus(now), /账本内容不合法/);
});
