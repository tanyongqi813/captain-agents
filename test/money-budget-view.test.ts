import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyStatusWithBudget } from '../src/core/money-budget.ts';
import { defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
const status = { day: '2026-10-28', spent: 2, reserved: 1, unknown: 1, stopped: true };
const config = { ...defaultDeepseekMoney, enabled: true, soft: 5, hard: 8,
  pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };

test('剩余预算扣除已花和运行预留，不改停派/未知状态或输入快照', () => {
  assert.deepEqual(moneyStatusWithBudget(status, config), { ...status, remaining: 5, softRemaining: 2 });
  assert.equal(status.spent, 2); assert.equal(config.hard, 8);
  assert.equal(moneyStatusWithBudget({ ...status, spent: 10 }, config).remaining, 0);
});
test('微元口径避免0.3减0.1减0.2残余，预算关闭或缺失保持未知', () => {
  const exact = moneyStatusWithBudget({ ...status, spent: 0.1, reserved: 0.2 }, { ...config, soft: 0.3, hard: 0.3, reserve: 0.1 });
  assert.equal(exact.remaining, 0); assert.equal(exact.softRemaining, 0);
  assert.equal(moneyStatusWithBudget(status).remaining, null);
  assert.equal(moneyStatusWithBudget(status, { ...config, enabled: false }).remaining, null);
});
test('非法快照或配置不伪造剩余预算', () => {
  assert.throws(() => moneyStatusWithBudget({ ...status, spent: NaN }, config));
  assert.throws(() => moneyStatusWithBudget({ ...status, reserved: -1 }, config));
  assert.throws(() => moneyStatusWithBudget(status, { ...config, hard: Infinity }));
});
