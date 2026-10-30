import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright-core';
import { context } from '../helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../../src/core/deepseek-settings.ts';

test('真实窗口：连接默认强度和每日费用可编辑、持久化，浅深窄窗口可操作', { timeout: 60_000 }, async t => {
  const c = await context(t, false);
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ deepseek: { ...defaultDeepseekEndpoint, money: { ...defaultDeepseekMoney } } }));
  const env = Object.fromEntries(Object.entries(c.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  const launch = () => _electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, XAGENTS_E2E: '1', XAGENTS_USER_DATA: join(c.temp, 'electron') } });
  let app = await launch();
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '选手与模型', exact: true }).click();
    await page.getByRole('region', { name: 'DeepSeek', exact: true }).getByRole('button', { name: '编辑', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '编辑 DeepSeek', exact: true });
    await dialog.getByRole('combobox', { name: 'Flash 推理强度', exact: true }).selectOption('default');
    await dialog.getByRole('switch', { name: '每日预估费用预算', exact: true }).click();
    await dialog.getByLabel('每日软预算（元）', { exact: true }).fill('5');
    await dialog.getByLabel('每日上限预算（元）', { exact: true }).fill('8');
    await dialog.getByLabel('单任务安全余量（元，可选）', { exact: true }).fill('0.5');
    // 保存前仍使用原先关闭的配置，不用8元草稿伪造剩余。
    assert.match(await dialog.innerText(), /距上限预估剩余未知/);
    for (const slot of ['Pro', 'Flash']) {
      await dialog.getByLabel(`${slot} 未缓存输入单价（元/百万 token）`, { exact: true }).fill('1');
      await dialog.getByLabel(`${slot} 输出单价（元/百万 token）`, { exact: true }).fill('2');
    }
    await dialog.getByLabel('Pro 缓存写入单价（元/百万 token，可选）', { exact: true }).fill('0');
    await dialog.getByLabel('Flash 缓存写入单价（元/百万 token，可选）', { exact: true }).fill('8');
    await mkdir(resolve('output/playwright'), { recursive: true });
    for (const variant of [{ name: 'light', width: 1280, scheme: 'light' }, { name: 'dark', width: 1280, scheme: 'dark' }, { name: 'narrow', width: 900, scheme: 'light' }] as const) {
      await page.setViewportSize({ width: variant.width, height: 900 });
      await page.emulateMedia({ colorScheme: variant.scheme });
      await dialog.getByLabel('单任务安全余量（元，可选）', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ animations: 'disabled', path: resolve(`output/playwright/task-035-attempt-06-${variant.name}.png`) });
    }
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => window.xa.getSettings());
    assert.equal(saved.deepseek?.flashReasoning, 'default');
    assert.equal(saved.deepseek?.money?.hard, 8);
    assert.equal(saved.deepseek?.money?.enabled, true);
    assert.equal(saved.deepseek?.money?.pro.cacheWrite, 0);
    assert.equal(saved.deepseek?.money?.flash.cacheWrite, 8);
    assert.equal(saved.deepseek?.money?.safetyMargin, 0.5);
    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await reopened.getByRole('button', { name: '设置', exact: true }).click();
    await reopened.getByRole('tab', { name: '选手与模型', exact: true }).click();
    await reopened.getByRole('region', { name: 'DeepSeek', exact: true }).getByRole('button', { name: '编辑', exact: true }).click();
    const restored = reopened.getByRole('dialog', { name: '编辑 DeepSeek', exact: true });
    assert.equal(await restored.getByLabel('每日软预算（元）', { exact: true }).inputValue(), '5');
    assert.equal(await restored.getByLabel('单任务安全余量（元，可选）', { exact: true }).inputValue(), '0.5');
    assert.match(await restored.innerText(), /距上限预估剩余 ¥8.0000，距软预算预估剩余 ¥5.0000/);
    assert.equal(await restored.getByLabel('Pro 缓存写入单价（元/百万 token，可选）', { exact: true }).inputValue(), '0');
    assert.equal(await restored.getByLabel('Flash 缓存写入单价（元/百万 token，可选）', { exact: true }).inputValue(), '8');
  } finally { await app.close(); }
});
