import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright-core';
import type { Page } from 'playwright-core';
import { context } from '../helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../../src/core/deepseek-settings.ts';

test('活动预算组窗口：选择取消/同组编辑/真实保存重启/其他组保留', { timeout: 60000 }, async t => {
  const c = await context(t, false);
  const prices = { 'relay/pro': { input: 2, cached: 0, output: 3 }, 'relay/flash': { input: 4, cached: 0, output: 5 } };
  const money = { ...defaultDeepseekMoney, enabled: true, pro: { input: 99, cached: 9, output: 99 }, flash: { input: 88, cached: 8, output: 88 } };
  const initial = { ...defaultDeepseekEndpoint, proModel: 'relay/pro', flashModel: 'relay/flash', money,
    moneyGroups: { accountB: { ...money, hard: 12, modelPrices: prices }, accountC: { ...money, hard: 15 } } };
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ deepseek: initial }));
  const env = Object.fromEntries(Object.entries(c.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  const launch = () => _electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, XAGENTS_E2E: '1', XAGENTS_USER_DATA: join(c.temp, 'electron') } });
  const edit = async (page: Page, outer = true) => {
    if (outer) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('tab', { name: '选手与模型', exact: true }).click();
    }
    await page.getByRole('region', { name: 'DeepSeek', exact: true }).getByRole('button', { name: '编辑', exact: true }).click();
    return page.getByRole('dialog', { name: '编辑 DeepSeek', exact: true });
  };
  let app = await launch();
  try {
    let page = await app.firstWindow(), dialog = await edit(page);
    await dialog.getByLabel('费用预算组', { exact: true }).selectOption('accountB');
    await dialog.getByLabel('每日上限预算（元）', { exact: true }).fill('14');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual((await page.evaluate(() => window.xa.getSettings())).deepseek, initial);
    dialog = await edit(page, false);
    await dialog.getByLabel('费用预算组', { exact: true }).selectOption('accountB');
    assert.equal(await dialog.getByLabel('每日上限预算（元）', { exact: true }).inputValue(), '12');
    await dialog.getByLabel('每日上限预算（元）', { exact: true }).fill('14');
    const input = 'Pro 未缓存输入单价（元/百万 token）';
    assert.equal(await dialog.getByLabel(input, { exact: true }).inputValue(), '2');
    await dialog.getByLabel(input, { exact: true }).fill('7');
    await dialog.getByLabel('Pro 缓存写入单价（元/百万 token，可选）', { exact: true }).fill('0');
    await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => window.xa.getSettings());
    assert.ok(saved.deepseek);
    assert.equal(saved.deepseek.budgetGroup, 'accountB');
    assert.equal(saved.deepseek.moneyGroups?.accountB.hard, 14);
    assert.equal(saved.deepseek.moneyGroups?.accountB.modelPrices?.['relay/pro'].input, 7);
    assert.equal(saved.deepseek.moneyGroups?.accountB.modelPrices?.['relay/pro'].cacheWrite, 0);
    assert.deepEqual(saved.deepseek.money, initial.money);
    assert.deepEqual(saved.deepseek.moneyGroups?.accountC, initial.moneyGroups.accountC);
    assert.deepEqual(saved.deepseek.moneyGroups?.accountB.modelPrices?.['relay/flash'], prices['relay/flash']);
    await app.close(); app = await launch(); page = await app.firstWindow(); dialog = await edit(page);
    assert.equal(await dialog.getByLabel('费用预算组', { exact: true }).inputValue(), 'accountB');
    assert.equal(await dialog.getByLabel('每日上限预算（元）', { exact: true }).inputValue(), '14');
    assert.equal(await dialog.getByLabel(input, { exact: true }).inputValue(), '7');
    await dialog.getByLabel('新预算组名称', { exact: true }).fill('newAccount');
    await dialog.getByRole('button', { name: '创建预算组', exact: true }).click();
    assert.equal(await dialog.getByLabel('费用预算组', { exact: true }).inputValue(), 'newAccount');
    assert.equal(await dialog.getByRole('switch', { name: '每日预估费用预算', exact: true }).getAttribute('aria-checked'), 'false');
    assert.equal(await dialog.getByLabel(input, { exact: true }).inputValue(), '0');
    await dialog.getByLabel('每日上限预算（元）', { exact: true }).fill('20');
    await dialog.getByLabel(input, { exact: true }).fill('5');
    await dialog.getByLabel('Flash 未缓存输入单价（元/百万 token）', { exact: true }).fill('6');
    await dialog.getByRole('switch', { name: '每日预估费用预算', exact: true }).click();
    await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    const created = await page.evaluate(() => window.xa.getSettings());
    assert.ok(created.deepseek);
    assert.equal(created.deepseek.budgetGroup, 'newAccount');
    assert.equal(created.deepseek.moneyGroups?.newAccount.enabled, true);
    assert.deepEqual(created.deepseek.moneyGroups?.accountB, saved.deepseek.moneyGroups?.accountB);
    assert.deepEqual(created.deepseek.money, initial.money);
    await app.close(); app = await launch(); page = await app.firstWindow(); dialog = await edit(page);
    assert.equal(await dialog.getByLabel('费用预算组', { exact: true }).inputValue(), 'newAccount');
    assert.equal(await dialog.getByLabel('每日上限预算（元）', { exact: true }).inputValue(), '20');
    assert.equal(await dialog.getByLabel(input, { exact: true }).inputValue(), '5');
    await mkdir(resolve('output/playwright'), { recursive: true });
    for (const variant of [{ name: 'light', width: 1280, scheme: 'light' }, { name: 'dark', width: 1280, scheme: 'dark' }, { name: 'narrow', width: 900, scheme: 'light' }] as const) {
      await page.setViewportSize({ width: variant.width, height: 900 });
      await page.emulateMedia({ colorScheme: variant.scheme });
      const selector = dialog.getByLabel('费用预算组', { exact: true });
      await selector.evaluate(element => element.scrollIntoView({ block: 'center' }));
      const bounds = await selector.boundingBox();
      const header = await dialog.locator('.modal-bar').boundingBox(), footer = await dialog.locator('.modal-foot').boundingBox();
      assert.ok(bounds && header && footer);
      assert.ok(bounds.y >= header.y + header.height && bounds.y + bounds.height < footer.y);
      await page.screenshot({ animations: 'disabled', path: resolve('output/playwright/task-033-attempt-16-' + variant.name + '.png') });
    }
  } finally { await app.close(); }
});

