import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright-core';
import type { Page } from 'playwright-core';
import { context } from '../helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../../src/core/deepseek-settings.ts';

test('真实窗口：全局改模型后旧组未知，不借旧价，显式新价保存重启且旧账不变', { timeout: 60000 }, async t => {
 const c = await context(t, false);
 const money = { ...defaultDeepseekMoney, enabled: true, pro: { input: 2, cached: 0, output: 3 }, flash: { input: 4, cached: 0, output: 5 } };
 const initial = { ...defaultDeepseekEndpoint, proModel: 'relay/pro', flashModel: 'relay/flash',
  money: { ...money, modelPrices: { 'relay/pro': money.pro, 'relay/flash': money.flash } },
  moneyGroups: { legacy: { ...money, pro: { input: 11, cached: 1, output: 12 }, flash: { input: 13, cached: 1, output: 14 } } } };
 await writeFile(join(c.home, 'config.json'), JSON.stringify({ deepseek: initial }));
 const ledger = join(c.home, 'money-budget', 'deepseek.json');
 await mkdir(join(c.home, 'money-budget'), { recursive: true });
 const original = JSON.stringify({ version: 2, days: { '2026-10-29': 100000 }, stopped: [], entries: {},
  groups: { legacy: { days: { '2026-10-29': 200000 }, stopped: [] } } });
 await writeFile(ledger, original);
 const env = Object.fromEntries(Object.entries(c.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
 delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
 const launch = () => _electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, XAGENTS_E2E: '1', XAGENTS_USER_DATA: join(c.temp, 'electron') } });
 const edit = async (page: Page) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '选手与模型', exact: true }).click();
  await page.getByRole('region', { name: 'DeepSeek', exact: true }).getByRole('button', { name: '编辑', exact: true }).click();
  return page.getByRole('dialog', { name: '编辑 DeepSeek', exact: true });
 };
 let app = await launch();
 try {
  let page = await app.firstWindow(), dialog = await edit(page);
  await dialog.getByLabel('Pro 模型 ID', { exact: true }).fill('relay/new');
  await dialog.getByLabel('费用预算组', { exact: true }).selectOption('legacy');
  const input = 'Pro 未缓存输入单价（元/百万 token）';
  assert.equal(await dialog.getByLabel(input, { exact: true }).inputValue(), '');
  assert.equal(await dialog.getByLabel('Flash 未缓存输入单价（元/百万 token）', { exact: true }).inputValue(), '13');
  await dialog.getByText('Pro 当前模型尚未配置单价。', { exact: true }).waitFor();
  await mkdir(resolve('output/playwright'), { recursive: true });
  for (const variant of [{ name: 'light', width: 1280, scheme: 'light' }, { name: 'dark', width: 1280, scheme: 'dark' }, { name: 'narrow', width: 900, scheme: 'light' }] as const) {
   await page.setViewportSize({ width: variant.width, height: 900 }); await page.emulateMedia({ colorScheme: variant.scheme });
   const title = dialog.getByText('Pro：relay/new', { exact: true });
   await title.evaluate(element => element.scrollIntoView({ block: 'center' }));
   const bounds = await title.boundingBox(), header = await dialog.locator('.modal-bar').boundingBox(), footer = await dialog.locator('.modal-foot').boundingBox();
   assert.ok(bounds && header && footer); assert.ok(bounds.y >= header.y + header.height && bounds.y + bounds.height < footer.y);
   await page.screenshot({ animations: 'disabled', path: resolve('output/playwright/task-035-attempt-12-' + variant.name + '.png') });
  }
  for (const [kind, amount] of [['未缓存输入', '5'], ['缓存命中', '0'], ['输出', '6']]) await dialog.getByLabel('Pro ' + kind + '单价（元/百万 token）', { exact: true }).fill(amount);
  await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const saved = await page.evaluate(() => window.xa.getSettings()); assert.ok(saved.deepseek);
  assert.deepEqual(saved.deepseek.moneyGroups?.legacy.legacyModels, { pro: 'relay/new', flash: 'relay/flash' });
  assert.equal(saved.deepseek.moneyGroups?.legacy.pro.input, 5);
  assert.equal(saved.deepseek.moneyGroups?.legacy.flash.input, 13);
  assert.deepEqual(saved.deepseek.money?.modelPrices, initial.money.modelPrices);
  assert.equal(await readFile(ledger, 'utf8'), original);
  await app.close(); app = await launch(); page = await app.firstWindow(); dialog = await edit(page);
  assert.equal(await dialog.getByLabel(input, { exact: true }).inputValue(), '5');
  assert.equal(await dialog.getByLabel('费用预算组', { exact: true }).inputValue(), 'legacy');
  assert.equal(await readFile(ledger, 'utf8'), original);
 } finally { await app.close(); }
});

