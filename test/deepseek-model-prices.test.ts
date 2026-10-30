import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec, until } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney, deepseekMoney, deepseekModelPrice } from '../src/core/deepseek-settings.ts';
import { writeSettings, readDeepseekRuntimeSettings } from '../src/core/settings.ts';
const dispatchUrl = new URL('../src/core/dispatch.ts', import.meta.url).href;
const price = { input: 2, cached: 0.5, output: 3, cacheWrite: 0 };
const money = { ...defaultDeepseekMoney, enabled: true, pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };

test('显式价表按ID精确读取、复制及保留0，不回退旧槽位', () => {
  const raw = { ...money, modelPrices: { 'relay/flash': { ...price } } };
  const parsed = deepseekMoney(raw); raw.modelPrices['relay/flash'].input = 99;
  const found = deepseekModelPrice(parsed, 'relay/flash', 'pro');
  assert.deepEqual(found, price); found.input = 88;
  assert.equal(parsed.modelPrices?.['relay/flash'].input, 2);
  assert.throws(() => deepseekModelPrice(parsed, 'other', 'flash'), /尚未配置单价/);
  assert.throws(() => deepseekModelPrice({ ...money, modelPrices: {} }, 'other', 'flash'), /尚未配置单价/);
  assert.deepEqual(deepseekModelPrice(money, 'legacy-id', 'flash'), money.flash);
  assert.doesNotThrow(() => deepseekMoney({ ...defaultDeepseekMoney, enabled: true, modelPrices: { 'relay/flash': price } }));
});

test('非法模型/单价/额外字段/超量价表拒绝', () => {
  for (const id of ['', 'constructor', '__proto__', 'https://secret/model']) {
    assert.throws(() => deepseekMoney({ ...money, modelPrices: Object.fromEntries([[id, price]]) }), /模型/);
  }
  for (const bad of [{ ...price, input: -1 }, { ...price, cached: NaN }, { ...price, output: Infinity }, { ...price, cacheWrite: -1 },
    { ...price, input: 0, output: 0 }, { ...price, token: 'forbidden' }]) {
    assert.throws(() => deepseekMoney({ ...money, modelPrices: { model: bad } }), /模型单价/);
  }
  assert.throws(() => deepseekMoney({ ...money, modelPrices: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`m${i}`, price])) }), /最多128/);
});

test('未知实际ID零注册拒绝，即使旧槽位有合法价', async t => {
  const c = await context(t); process.env.XAGENTS_HOME = c.home; assert.equal((await c.add()).code, 0);
  await writeSettings({ deepseek: { ...defaultDeepseekEndpoint, money: { ...money, modelPrices: {} } } });
  const result = await c.cli(['run', c.task, '--summary', '拒绝未知单价', '--who', 'deepseek:high']);
  assert.notEqual(result.code, 0); assert.match(result.stderr, /尚未配置单价/); assert.equal((await c.jobs()).length, 0);
});

test('实际ID价表按组派发冻结，改价不追溯已运行记录', { timeout: 30_000 }, async t => {
  const c = await context(t); process.env.XAGENTS_HOME = c.home; assert.equal((await c.add()).code, 0);
  const model = 'relay/flash';
  const endpoint = { ...defaultDeepseekEndpoint, proReasoning: 'default' as const, flashReasoning: 'default' as const, flashModel: model,
    money: { ...money, modelPrices: { [model]: { input: 9, cached: 0, output: 9 } } },
    moneyGroups: { accountB: { ...money, modelPrices: { [model]: { input: 2, cached: 0, output: 3 } } } } };
  await writeSettings({ keepAwake: false, deepseek: endpoint });
  assert.equal((await readDeepseekRuntimeSettings()).moneyGroups?.accountB.modelPrices?.[model].input, 2);
  const fake = join(c.temp, 'price-worker.mjs'), release = join(c.temp, 'release');
  await writeFile(fake, `import {existsSync,writeFileSync} from 'node:fs';
    process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:100000,cached_input_tokens:0,output_tokens:0}})+String.fromCharCode(10));
    setInterval(()=>{ if(existsSync(${JSON.stringify(release)})) {
      const at=process.argv.indexOf('-o'); writeFileSync(process.argv[at+1],'价格冻结完成'); process.exit(0);
    } },100);`);
  const launched = await exec(process.execPath, ['--input-type=module', '-e', `import {dispatch} from ${JSON.stringify(dispatchUrl)};
    await dispatch(${JSON.stringify(c.task)},{who:['deepseek-flash:high'],summary:'按实际模型价派活',moneyGroup:'accountB'});`], c.repo, { ...c.env, XAGENTS_FAKE_WORKER: fake });
  assert.equal(launched.code, 0, launched.stderr);
  const path = join(c.home, 'money-budget', 'deepseek.json');
  const book = () => readFile(path, 'utf8').then(text => JSON.parse(text));
  const observed = await until(book, b => Object.values<{ charged: number }>(b.entries).some(e => e.charged === 200_000), 15_000);
  const job = (await c.jobs())[0];
  assert.equal(observed.entries[job.id].price.input, 2);
  await writeSettings({ deepseek: { ...endpoint, moneyGroups: { accountB: { ...money, modelPrices: { [model]: { input: 8, cached: 0, output: 8 } } } } } });
  await writeFile(release, 'done');
  const ended = await until(async () => (await c.jobs()).find(j => j.id === job.id)!, j => !!j && ['done', 'failed', 'stopped'].includes(j.state), 15_000);
  assert.equal(ended.state, 'done', ended.error);
  const final = await book(); assert.equal(final.entries[job.id].charged, 200_000); assert.equal(final.entries[job.id].price.input, 2);
  assert.deepEqual(final.days, {});
});
