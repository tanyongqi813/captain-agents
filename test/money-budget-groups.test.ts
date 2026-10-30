import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec } from './helpers.ts';
import { defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { reserveMoney, observeMoney, readMoneyStatus } from '../src/core/money-budget.ts';
const config = { ...defaultDeepseekMoney, enabled: true, soft: 2, hard: 2, reserve: 1,
  pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
const now = Date.parse('2026-10-27T19:00:00Z');
const later = now + 86_400_000;
const identity = (group: string) => ({ budgetGroup: group, model: 'relay/flash' });
const usage = (read: number) => ({ read, cached: 0, out: 0 });
const file = (home: string) => join(home, 'money-budget', 'deepseek.json');
const moduleUrl = new URL('../src/core/money-budget.ts', import.meta.url).href;

test('首次显式组升级v2，旧消费/预留/停派及未知模型完整留在default，冷读不清账', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('old', config, config.pro, now);
  await observeMoney('old', config, usage(200_000), false, now);
  const old = JSON.parse(await readFile(file(c.home), 'utf8'));
  old.stopped.push((await readMoneyStatus(now)).day);
  await writeFile(file(c.home), JSON.stringify(old));
  await reserveMoney('new', config, config.pro, now, identity('accountB'), 'accountB');
  const upgraded = JSON.parse(await readFile(file(c.home), 'utf8'));
  assert.equal(upgraded.version, 2);
  assert.deepEqual(upgraded.days, old.days); assert.deepEqual(upgraded.stopped, old.stopped);
  assert.deepEqual(upgraded.entries.old, old.entries.old);
  assert.equal(upgraded.entries.old.identity, undefined);
  const defaults = await readMoneyStatus(now); assert.equal(defaults.spent, 0.2); assert.equal(defaults.reserved, 0.8); assert.equal(defaults.stopped, true);
  const group = await readMoneyStatus(now, config, 'accountB'); assert.equal(group.spent, 0); assert.equal(group.reserved, 1); assert.equal(group.stopped, false);
  const cold = await exec(process.execPath, ['--input-type=module', '-e', `import {readMoneyStatus} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await readMoneyStatus(${now})));`], c.repo, c.env);
  assert.equal(cold.code, 0, cold.stderr); assert.deepEqual(JSON.parse(cold.stdout), defaults);
  // 旧实现已有严格版本闸门，不能将v2当v1读取。
  assert.notEqual(upgraded.version, 1);
});

test('各组消费/停派独立，迟到及跨日结算固定在原组，默认账不受影响', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  for (const group of ['accountB', 'accountC']) await reserveMoney(group, config, config.pro, now, identity(group), group);
  assert.match((await observeMoney('accountB', config, usage(2_000_000), true, now))!, /上限/);
  assert.equal((await readMoneyStatus(now, config, 'accountB')).stopped, true);
  assert.equal((await readMoneyStatus(now, config, 'accountC')).stopped, false);
  await assert.rejects(reserveMoney('blocked', config, config.pro, now, identity('accountB'), 'accountB'), /预算/);
  await observeMoney('accountB', config, usage(2_500_000), true, later);
  assert.equal((await readMoneyStatus(later, config, 'accountB')).spent, 0.5);
  assert.equal((await readMoneyStatus(later, config, 'accountB')).unknown, 1);
  assert.equal((await readMoneyStatus(later, config, 'accountC')).spent, 0);
  assert.equal((await readMoneyStatus(later)).spent, 0);
  const snapshot = await readFile(file(c.home), 'utf8');
  await observeMoney('accountB', config, usage(2_500_000), true, later);
  assert.equal(await readFile(file(c.home), 'utf8'), snapshot);
});

test('跨组终态回收按冻结组兜底，安全余量只释放不消费', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const money = { ...config, safetyMargin: 0.5 };
  await reserveMoney('ended', money, money.pro, now, identity('accountB'), 'accountB');
  await mkdir(join(c.home, 'jobs', 'ended'), { recursive: true });
  await writeFile(join(c.home, 'jobs', 'ended', 'job.json'), JSON.stringify({ state: 'done' }));
  await reserveMoney('default-new', config, config.pro, now);
  assert.equal((await readMoneyStatus(now, config, 'accountB')).spent, 1);
  assert.equal((await readMoneyStatus(now, config, 'accountB')).reserved, 0);
  assert.equal((await readMoneyStatus(now)).spent, 0);
  assert.equal((await readMoneyStatus(now)).reserved, 1);
});

test('多进程同组原子预留，无交叉透支；其他组独立', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const tight = { ...config, soft: 1, hard: 1 };
  const results = await Promise.all(['one', 'two'].map(id => exec(process.execPath, ['--input-type=module', '-e',
    `import {reserveMoney} from ${JSON.stringify(moduleUrl)}; await reserveMoney(${JSON.stringify(id)},${JSON.stringify(tight)},${JSON.stringify(tight.pro)},${now},${JSON.stringify(identity('accountB'))},'accountB');`], c.repo, c.env)));
  assert.equal(results.filter(r => r.code === 0).length, 1);
  await reserveMoney('c', tight, tight.pro, now, identity('accountC'), 'accountC');
  assert.equal((await readMoneyStatus(now, tight, 'accountB')).reserved, 1);
  assert.equal((await readMoneyStatus(now, tight, 'accountC')).reserved, 1);
});

test('坏版本/组缺失/篡改归属拒绝，身份标签不隐式开启隔离', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('one', config, config.pro, now, identity('accountB'), 'accountB');
  const original = await readFile(file(c.home), 'utf8');
  await assert.rejects(reserveMoney('one', config, config.pro, now, identity('accountC'), 'accountC'), /身份与原记录/);
  await assert.rejects(reserveMoney('bad', config, config.pro, now, identity('accountB'), 'accountC'), /预算组/);
  await assert.rejects(readMoneyStatus(now, config, 'constructor'), /预算组/);
  assert.equal(await readFile(file(c.home), 'utf8'), original);
  for (const change of [(b: Record<string, unknown>) => { b.version = 1; }, (b: Record<string, unknown>) => { b.version = 99; },
    (b: Record<string, unknown>) => { b.groups = {}; }]) {
    const bad = JSON.parse(original); change(bad); await writeFile(file(c.home), JSON.stringify(bad));
    await assert.rejects(readMoneyStatus(now), /账本/);
  }
});
