import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney, deepseekEndpoint, deepseekBudgetForGroup } from '../src/core/deepseek-settings.ts';
import { readSettings, writeSettings, readDeepseekRuntimeSettings } from '../src/core/settings.ts';

const money = { ...defaultDeepseekMoney, enabled: true, pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };

test('旧money仍为default，组表深复制且不会激活组选择', () => {
  assert.deepEqual(deepseekEndpoint(defaultDeepseekEndpoint), defaultDeepseekEndpoint);
  const raw = { ...defaultDeepseekEndpoint, money, moneyGroups: { accountB: { ...money, hard: 12 } } };
  const parsed = deepseekEndpoint(raw);
  raw.moneyGroups.accountB.pro.input = 99;
  assert.equal(parsed.moneyGroups?.accountB.pro.input, 1);
  assert.equal(deepseekBudgetForGroup(parsed)?.hard, 10);
  assert.equal(deepseekBudgetForGroup(parsed, 'accountB')?.hard, 12);
  assert.equal(deepseekEndpoint({ ...parsed, budgetGroup: 'accountB' }).budgetGroup, 'accountB');
  assert.throws(() => deepseekEndpoint({ ...parsed, budgetGroup: 'missing' }), /预算组/);
  assert.equal(deepseekBudgetForGroup(defaultDeepseekEndpoint), undefined);
});

test('缺失组拒绝不回退default，关闭组保留关闭并返回独立副本', () => {
  const endpoint = deepseekEndpoint({ ...defaultDeepseekEndpoint, money: { ...money }, moneyGroups: { accountB: { ...money, enabled: false } } });
  assert.throws(() => deepseekBudgetForGroup(endpoint, 'missing'), /配置缺失/);
  assert.throws(() => deepseekBudgetForGroup(defaultDeepseekEndpoint, 'accountB'), /预算组/);
  const found = deepseekBudgetForGroup(endpoint, 'accountB')!;
  assert.equal(found.enabled, false); found.pro.input = 88;
  assert.notEqual(endpoint.moneyGroups?.accountB.pro.input, 88);
});

test('非法组名、重复default、坏预算及超限组数拒绝', () => {
  for (const name of ['default', 'constructor', 'prototype', '__proto__', '../x', '']) {
    const groups = Object.fromEntries([[name, money]]);
    assert.throws(() => deepseekEndpoint({ ...defaultDeepseekEndpoint, moneyGroups: groups }), /预算组/);
  }
  for (const groups of [null, [], Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`g${i}`, money]))]) {
    assert.throws(() => deepseekEndpoint({ ...defaultDeepseekEndpoint, moneyGroups: groups }), /预算组/);
  }
  assert.throws(() => deepseekEndpoint({ ...defaultDeepseekEndpoint, moneyGroups: { bad: { ...money, hard: -1 } } }), /预算/);
});

test('真实设置保存重读保留各组，换地址模型不删除组；非法保存原文件不变', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const endpoint = { ...defaultDeepseekEndpoint, money: { ...money }, moneyGroups: { accountB: { ...money, hard: 12 } } };
  await writeSettings({ deepseek: endpoint });
  const saved = await readDeepseekRuntimeSettings();
  assert.deepEqual((await readSettings()).deepseek, saved);
  await writeSettings({ deepseek: { ...saved, baseUrl: 'https://other.example/v1/', proModel: 'relay/pro' } });
  assert.deepEqual((await readDeepseekRuntimeSettings()).moneyGroups, saved.moneyGroups);
  const original = await readFile(join(c.home, 'config.json'), 'utf8');
  await assert.rejects(writeSettings({ deepseek: { ...saved, moneyGroups: { accountB: { ...money, hard: -1 } } } }), /设置不合法/);
  assert.equal(await readFile(join(c.home, 'config.json'), 'utf8'), original);
});

test('收费严格读取拒绝损坏组配置，不静默关闭预算', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ deepseek: { ...defaultDeepseekEndpoint, moneyGroups: { accountB: { ...money, reserve: -1 } } } }));
  await assert.rejects(readDeepseekRuntimeSettings(), /预算配置不合法/);
});
