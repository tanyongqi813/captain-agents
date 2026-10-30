import { test } from 'node:test';
import assert from 'node:assert/strict';
import { context } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney, deepseekMoney, deepseekModelPrice } from '../src/core/deepseek-settings.ts';
import { writeSettings, readDeepseekRuntimeSettings } from '../src/core/settings.ts';
const money = { ...defaultDeepseekMoney, enabled: true, pro: { input: 2, cached: 0, output: 3 }, flash: { input: 4, cached: 0, output: 5 },
 legacyModels: { pro: 'old/pro', flash: 'old/flash' } };
test('旧槽位绑定严格复制/持久化，旧无绑定兼容，有表优先实际ID', async t => {
 const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
 const parsed = deepseekMoney(money); parsed.legacyModels!.pro = 'mutated'; assert.equal(money.legacyModels.pro, 'old/pro');
 assert.equal(deepseekModelPrice(money, 'old/pro', 'pro').input, 2);
 assert.throws(() => deepseekModelPrice(money, 'new/pro', 'pro'), /不能沿用/);
 assert.equal(deepseekModelPrice({ ...money, legacyModels: undefined }, 'legacy-any', 'pro').input, 2);
 assert.equal(deepseekModelPrice({ ...money, modelPrices: { 'new/pro': { input: 7, cached: 0, output: 1 } } }, 'new/pro', 'pro').input, 7);
 await writeSettings({ deepseek: { ...defaultDeepseekEndpoint, money } });
 assert.deepEqual((await readDeepseekRuntimeSettings()).money?.legacyModels, money.legacyModels);
 for (const legacyModels of [null, {}, { pro: 'x' }, { pro: 'x', flash: 'y', extra: 'z' }, { pro: 'https://secret/model', flash: 'x' }, { pro: 1, flash: 'x' }]) assert.throws(() => deepseekMoney({ ...money, legacyModels }), /绑定不合法/);
});
test('未选中legacy组切为活动后，实际ID不匹配在注册前拒绝，不借旧价', async t => {
 const c = await context(t); process.env.XAGENTS_HOME = c.home; assert.equal((await c.add()).code, 0);
 await writeSettings({ deepseek: { ...defaultDeepseekEndpoint, proModel: 'new/pro', proReasoning: 'default', budgetGroup: 'accountB', moneyGroups: { accountB: money } } });
 const result = await c.cli(['run', c.task, '--summary', '拒绝跨模型借旧价', '--who', 'deepseek:high']);
 assert.notEqual(result.code, 0); assert.match(result.stderr, /不能沿用旧模型价格/);
 assert.equal((await c.jobs()).length, 0);
});

