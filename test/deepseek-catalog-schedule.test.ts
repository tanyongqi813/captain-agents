import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogRefreshSchedule } from '../src/core/deepseek-catalog-schedule.ts';

test('默认无授权，无自动操作；单飞且成功后限频，同身份重设不绕过', () => {
  const s = new CatalogRefreshSchedule(); assert.equal(s.take(0), null);
  s.configure('connection-A:credential-version-1');
  const first = s.take(0)!; assert.ok(first); assert.equal(Object.isFrozen(first), true);
  s.configure('connection-A:credential-version-1'); assert.equal(s.take(1), null);
  assert.equal(s.complete(first, true, 10), true);
  assert.equal(s.take(59_999), null); assert.ok(s.take(60_000));
});

test('失败退避翻倍封顶，成功恢复最小间隔，不产生模型或价格修改', () => {
  const s = new CatalogRefreshSchedule(); s.configure('A:1');
  let now = 0;
  for (const wait of [60_000, 120_000, 240_000, 480_000, 900_000, 900_000]) {
    const ticket = s.take(now)!; assert.ok(ticket);
    assert.equal(s.complete(ticket, false, now), true);
    assert.equal(s.take(now + wait - 1), null); now += wait;
  }
  const success = s.take(now)!; assert.equal(s.complete(success, true, now), true);
  now += 60_000; const next = s.take(now)!; assert.ok(next);
  assert.equal(s.complete(next, false, now), true);
  assert.ok(s.take(now + 60_000));
});

test('超时不接受迟到成功，释放占位但退避后才可重试', () => {
  const s = new CatalogRefreshSchedule(); s.configure('A:1');
  const first = s.take(0)!;
  assert.equal(s.complete(first, true, 15_000), false);
  assert.equal(s.take(74_999), null); const next = s.take(75_000)!; assert.ok(next);
  assert.equal(s.complete(first, true, 75_001), false);
  assert.equal(s.take(90_000), null); // take也回收超时，不立即重试。
  assert.equal(s.take(209_999), null); assert.ok(s.take(210_000));
});

test('撤销及换连接/凭据版本拒绝在途旧结果，保留冷却防绕过', () => {
  const s = new CatalogRefreshSchedule(); s.configure('A:1'); const a = s.take(0)!;
  s.configure(null); assert.equal(s.complete(a, true, 1), false);
  s.configure('B:1'); assert.equal(s.take(2), null);
  const b = s.take(60_000)!; assert.ok(b);
  assert.equal(s.complete({ ...b }, true, 60_001), false);
  s.configure('B:2'); assert.equal(s.complete(b, true, 60_002), false);
  assert.equal(s.take(119_999), null); const next = s.take(120_000)!;
  assert.ok(next.generation > b.generation); assert.equal(s.complete(next, true, 120_001), true);
});

test('非法时间/回退和坏绑定拒绝，不能损坏当前在途凭证', () => {
  const s = new CatalogRefreshSchedule(); s.configure('A:1'); const ticket = s.take(100)!;
  for (const now of [99, NaN, Infinity, -1, 100.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => s.take(now), /时间/);
  for (const binding of ['', '\n', 'x'.repeat(501)]) assert.throws(() => s.configure(binding), /绑定/);
  assert.equal(s.complete(ticket, true, 101), true);
});
