import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec } from './helpers.ts';
import { reserveMoney, observeMoney, readMoneyStatus } from '../src/core/money-budget.ts';
import { deepseekMoney, defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { readSettings, writeSettings } from '../src/core/settings.ts';

const config = { ...defaultDeepseekMoney, enabled: true, soft: 8, hard: 10, reserve: 3,
  pro: { input: 1, cached: 0.1, output: 2 }, flash: { input: 1, cached: 0.1, output: 2 } };
const before = Date.parse('2026-10-27T15:59:00Z');
const after = Date.parse('2026-10-27T16:01:00Z');
const tokens = (read: number) => ({ read, cached: 0, out: 0 });
const bookAt = (home: string) => join(home, 'money-budget', 'deepseek.json');
const moduleUrl = new URL('../src/core/money-budget.ts', import.meta.url).href;

test('跨日新增量按观测日记预算，未知区间在重复最终事件及重启后仍保留', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('cross', config, config.pro, before);
  await observeMoney('cross', config, tokens(1_000_000), false, before + 1000);
  await observeMoney('cross', config, tokens(2_000_000), true, after);
  assert.equal((await readMoneyStatus(before)).spent, 1);
  assert.equal((await readMoneyStatus(after)).spent, 1);
  assert.equal((await readMoneyStatus(before)).unknown, 1);
  assert.equal((await readMoneyStatus(after)).unknown, 1);
  const original = await readFile(bookAt(c.home), 'utf8');
  const entry = JSON.parse(original).entries.cross;
  assert.equal(entry.source, 'cumulative_tokens');
  assert.equal(entry.unknownReason, 'cross_day_usage');
  assert.equal(entry.uncertainSince, before + 1000);
  assert.equal(entry.uncertainUntil, after);
  const replay = await exec(process.execPath, ['--input-type=module', '-e',
    `import {observeMoney} from ${JSON.stringify(moduleUrl)}; await observeMoney('cross',${JSON.stringify(config)},${JSON.stringify(tokens(2_000_000))},true,${after + 1000});`], c.repo, c.env);
  assert.equal(replay.code, 0, replay.stderr);
  assert.equal(await readFile(bookAt(c.home), 'utf8'), original);
});

test('跨日才首次收到用量不冒充精确日期；同日已知费用不标未知', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('late', config, config.pro, before);
  await observeMoney('late', config, tokens(1_000_000), true, after);
  assert.equal((await readMoneyStatus(before)).spent, 0);
  assert.equal((await readMoneyStatus(after)).unknown, 1);
  await reserveMoney('same', config, config.pro, after);
  await observeMoney('same', config, tokens(1_000_000), true, after + 1000);
  const book = JSON.parse(await readFile(bookAt(c.home), 'utf8'));
  assert.equal(book.entries.same.unknown, false);
  assert.equal(book.entries.same.unknownReason, undefined);
  assert.equal(book.entries.late.unknown, true);
});

test('预留冻结价格，保守结算后迟到累计量只补差额且重放幂等', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const changed = { ...config, pro: { input: 100, cached: 100, output: 100 } };
  await reserveMoney('old', config, config.pro, before);
  await observeMoney('old', changed, undefined, true, before + 1000);
  assert.equal((await readMoneyStatus(before)).spent, 3);
  await observeMoney('old', changed, tokens(2_000_000), true, after);
  assert.equal((await readMoneyStatus(before)).spent, 3);
  assert.equal((await readMoneyStatus(after)).spent, 0);
  assert.equal((await readMoneyStatus(after)).unknown, 1);
  await observeMoney('old', changed, tokens(4_000_000), true, after);
  await observeMoney('old', changed, tokens(4_000_000), true, after);
  assert.equal((await readMoneyStatus(after)).spent, 1);
  const entry = JSON.parse(await readFile(bookAt(c.home), 'utf8')).entries.old;
  assert.deepEqual(entry.price, config.pro);
  assert.equal(entry.unknownReason, 'cross_day_usage');
});

test('非法累计用量不改账本，缓存写入按已有输入价计不重复收费', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('invalid', config, config.pro, before);
  const original = await readFile(bookAt(c.home), 'utf8');
  for (const usage of [tokens(-1), tokens(NaN), tokens(Infinity), tokens(0.1),
    { read: 1, cached: 2, out: 0 }, { read: 1, cached: 0, out: 0, cacheWrite: 2 }]) {
    await assert.rejects(observeMoney('invalid', config, usage, false, before), /用量不合法/);
    assert.equal(await readFile(bookAt(c.home), 'utf8'), original);
  }
  await observeMoney('invalid', config, { read: 1_000_000, cached: 200_000, cacheWrite: 300_000, out: 0 }, true, before);
  assert.equal((await readMoneyStatus(before)).spent, 0.82);
});

test('多个独立进程并发预留共享预算，超额请求拒绝且冷读恢复一致', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const results = await Promise.all(Array.from({ length: 6 }, (_, n) => exec(process.execPath,
    ['--input-type=module', '-e', `import {reserveMoney} from ${JSON.stringify(moduleUrl)};
      try { await reserveMoney('parallel-${n}',${JSON.stringify(config)},${JSON.stringify(config.pro)},${before}); }
      catch(error) { if (!/预算/.test(error.message)) throw error; process.exitCode=2; }`], c.repo, c.env)));
  assert.equal(results.filter(r => r.code === 0).length, 3);
  assert.equal(results.filter(r => r.code === 2).length, 3, results.map(r => r.stderr).join('\n'));
  const status = await readMoneyStatus(before);
  assert.equal(status.spent, 0); assert.equal(status.reserved, 9);
  const cold = await exec(process.execPath, ['--input-type=module', '-e',
    `import {readMoneyStatus} from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(await readMoneyStatus(${before})));`], c.repo, c.env);
  assert.equal(cold.code, 0, cold.stderr);
  assert.deepEqual(JSON.parse(cold.stdout), status);
});

test('微元定点计算与预算边界无浮点误差，合并分量只向上取整一次', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const small = { ...config, soft: 0.3, hard: 0.3, reserve: 0.1 };
  for (let n = 0; n < 3; n++) await reserveMoney(`exact-${n}`, small, config.pro, before);
  assert.equal((await readMoneyStatus(before)).reserved, 0.3);
  await assert.rejects(reserveMoney('fourth', small, config.pro, before), /预算/);
  await observeMoney('exact-0', small, { read: 0, cached: 0, out: 0 }, true, before);
  await reserveMoney('decimal', config, { input: 0.07, cached: 0.07, output: 0.07 }, before);
  await observeMoney('decimal', config, { read: 100, cached: 20, out: 0 }, true, before);
  assert.equal((await readMoneyStatus(before)).spent, 0.000007);
  await reserveMoney('fraction', config, { input: 0.1, cached: 0.2, output: 1e-7 }, before);
  await observeMoney('fraction', config, { read: 3, cached: 1, out: 1 }, true, before);
  assert.equal((await readMoneyStatus(before)).spent, 0.000008);
});

test('跨日无最终用量的收尾与重启回收均保留未知区间且重复收尾幂等', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('missing', config, config.pro, before);
  await observeMoney('missing', config, undefined, true, after);
  assert.equal((await readMoneyStatus(before)).unknown, 1);
  const original = await readFile(bookAt(c.home), 'utf8');
  await observeMoney('missing', config, undefined, true, after + 86_400_000);
  assert.equal(await readFile(bookAt(c.home), 'utf8'), original);
  await reserveMoney('recover', config, config.pro, before);
  await mkdir(join(c.home, 'jobs', 'recover'), { recursive: true });
  await writeFile(join(c.home, 'jobs', 'recover', 'job.json'), JSON.stringify({ state: 'failed' }));
  await reserveMoney('next', config, config.pro, after);
  await observeMoney('next', config, tokens(0), true, after);
  const book = JSON.parse(await readFile(bookAt(c.home), 'utf8'));
  assert.equal(book.entries.recover.unknownReason, 'missing_final_usage');
  assert.equal(book.entries.recover.uncertainSince, before);
  assert.equal(book.entries.recover.uncertainUntil, after);
  assert.equal((await readMoneyStatus(before)).unknown, 2);
});

test('金额加总溢出拒绝且文件不变，兜底达到上限同轮保存停派锁', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await reserveMoney('overflow', config, config.pro, before);
  const file = bookAt(c.home);
  const book = JSON.parse(await readFile(file, 'utf8'));
  book.days['2026-10-27'] = Number.MAX_SAFE_INTEGER;
  await writeFile(file, JSON.stringify(book));
  const original = await readFile(file, 'utf8');
  await assert.rejects(observeMoney('overflow', config, tokens(1), true, before), /安全精度/);
  assert.equal(await readFile(file, 'utf8'), original);
  book.days = {};
  await writeFile(file, JSON.stringify(book));
  const limited = { ...config, soft: 3, hard: 3 };
  assert.match((await observeMoney('overflow', limited, undefined, true, before))!, /上限/);
  assert.equal((await readMoneyStatus(before)).stopped, true);
});

test('独立缓存写入价持久化、冻结并只计一次，明确零价不回退到输入价', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const priced = deepseekMoney({ ...config, pro: { ...config.pro, cacheWrite: 8 } });
  await writeSettings({ deepseek: { ...defaultDeepseekEndpoint, money: priced } });
  const stored = (await readSettings()).deepseek.money!;
  assert.equal(stored.pro.cacheWrite, 8);
  await reserveMoney('write', stored, stored.pro, before);
  const changed = { ...stored, pro: { ...stored.pro, cacheWrite: 0 } };
  await writeSettings({ deepseek: { ...defaultDeepseekEndpoint, money: changed } });
  assert.equal((await readSettings()).deepseek.money!.pro.cacheWrite, 0);
  const usage = { read: 1_000_000, cached: 200_000, cacheWrite: 300_000, out: 0 };
  await observeMoney('write', changed, usage, true, before);
  await observeMoney('write', changed, usage, true, before);
  assert.equal((await readMoneyStatus(before)).spent, 2.92);
  await reserveMoney('free-write', changed, changed.pro, before);
  await observeMoney('free-write', changed, usage, true, before);
  assert.equal((await readMoneyStatus(before)).spent, 3.44);
  const book = JSON.parse(await readFile(bookAt(c.home), 'utf8'));
  assert.equal(book.entries.write.price.cacheWrite, 8);
  assert.equal(book.entries['free-write'].price.cacheWrite, 0);
});

test('独立写入价格非法或所需写入用量未知均拒绝，不改账本、不将未知补零', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  for (const cacheWrite of [-1, NaN, Infinity, 1_000_001, null, '1']) {
    assert.throws(() => deepseekMoney({ ...config, pro: { ...config.pro, cacheWrite } }), /缓存写入单价/);
  }
  const priced = deepseekMoney({ ...config, pro: { ...config.pro, cacheWrite: 8 } });
  await reserveMoney('unknown-write', priced, priced.pro, before);
  const original = await readFile(bookAt(c.home), 'utf8');
  await assert.rejects(observeMoney('unknown-write', priced, tokens(1_000_000), true, before), /写入用量未知/);
  assert.equal(await readFile(bookAt(c.home), 'utf8'), original);
  const book = JSON.parse(original);
  book.entries['unknown-write'].price.cacheWrite = -1;
  await writeFile(bookAt(c.home), JSON.stringify(book));
  const broken = await readFile(bookAt(c.home), 'utf8');
  await assert.rejects(readMoneyStatus(before), /账本内容不合法/);
  assert.equal(await readFile(bookAt(c.home), 'utf8'), broken);
});
