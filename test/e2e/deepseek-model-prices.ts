import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright-core';
import type { Page } from 'playwright-core';
import { context } from '../helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../../src/core/deepseek-settings.ts';

test('真实窗口：实际ID价表生效、缺失价不借旧值，保存及进程重启回显', { timeout: 60_000 }, async t => {
  const c = await context(t, false);
  const initial = { ...defaultDeepseekEndpoint, proModel: 'relay/pro', flashModel: 'relay/flash',
    money: { ...defaultDeepseekMoney, enabled: true, pro: { input: 99, cached: 9, output: 99 }, flash: { input: 88, cached: 8, output: 88 },
      modelPrices: { 'relay/pro': { input: 2, cached: 0, output: 3 }, 'relay/flash': { input: 4, cached: 0, output: 5 }, other: { input: 6, cached: 0, output: 7 } } } };
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ deepseek: initial }));
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
    const page = await app.firstWindow(), dialog = await edit(page);
    const proInput = 'Pro 未缓存输入单价（元/百万 token）';
    assert.equal(await dialog.getByLabel(proInput, { exact: true }).inputValue(), '2');
    await dialog.getByLabel(proInput, { exact: true }).fill('7');
    await dialog.getByLabel('Pro 缓存写入单价（元/百万 token，可选）', { exact: true }).fill('0');
    await dialog.getByLabel('Flash 模型 ID', { exact: true }).fill('relay/new-flash');
    assert.equal(await dialog.getByLabel('Flash 未缓存输入单价（元/百万 token）', { exact: true }).inputValue(), '');
    await dialog.getByText('Flash 当前模型尚未配置单价。', { exact: true }).waitFor();
    for (const [kind, amount] of [['未缓存输入', '5'], ['缓存命中', '0'], ['输出', '6']]) {
      await dialog.getByLabel(`Flash ${kind}单价（元/百万 token）`, { exact: true }).fill(amount);
    }
    await mkdir(resolve('output/playwright'), { recursive: true });
    for (const variant of [{ name: 'light', width: 1280, scheme: 'light' }, { name: 'dark', width: 1280, scheme: 'dark' }, { name: 'narrow', width: 900, scheme: 'light' }] as const) {
      await page.setViewportSize({ width: variant.width, height: 900 });
      await page.emulateMedia({ colorScheme: variant.scheme });
      await dialog.getByLabel(proInput, { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ animations: 'disabled', path: resolve(`output/playwright/task-035-attempt-10-${variant.name}.png`) });
    }
    await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => window.xa.getSettings());
    assert.ok(saved.deepseek);
    assert.equal(saved.deepseek.money?.modelPrices?.['relay/pro'].input, 7);
    assert.equal(saved.deepseek.money?.modelPrices?.['relay/pro'].cacheWrite, 0);
    assert.equal(saved.deepseek.money?.modelPrices?.['relay/new-flash'].input, 5);
    assert.deepEqual(saved.deepseek.money?.modelPrices?.['relay/flash'], initial.money.modelPrices['relay/flash']);
    assert.deepEqual(saved.deepseek.money?.modelPrices?.other, initial.money.modelPrices.other);
    assert.equal(saved.deepseek.money?.pro.input, 99);
    await app.close(); app = await launch();
    const restored = await edit(await app.firstWindow());
    assert.equal(await restored.getByLabel(proInput, { exact: true }).inputValue(), '7');
    assert.equal(await restored.getByLabel('Pro 缓存写入单价（元/百万 token，可选）', { exact: true }).inputValue(), '0');
    assert.equal(await restored.getByLabel('Flash 未缓存输入单价（元/百万 token）', { exact: true }).inputValue(), '5');
  } finally { await app.close(); }
});
