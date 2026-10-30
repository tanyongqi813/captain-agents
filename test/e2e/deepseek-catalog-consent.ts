import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright-core';
import type { Page } from 'playwright-core';
import { context } from '../helpers.ts';
import { defaultDeepseekEndpoint } from '../../src/core/deepseek-settings.ts';

test('真实窗口：授权取消不写、保存重启保持、换连接撤销且切回不复活', { timeout: 60_000 }, async t => {
  const c = await context(t, false), file = join(c.home, 'config.json');
  await writeFile(file, JSON.stringify({ deepseek: defaultDeepseekEndpoint }));
  await mkdir(join(c.home, 'deepseek'), { recursive: true });
  await writeFile(join(c.home, 'deepseek/auth.json'), '{"OPENAI_API_KEY":"fake-only-no-network"}');
  const env = Object.fromEntries(Object.entries(c.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  // E2E模式不创建生产catalogLoop，授权的真实IPC/设置锁仍可验证；不点击获取模型。
  const launch = () => _electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, XAGENTS_E2E: '1', XAGENTS_USER_DATA: join(c.temp, 'electron') } });
  const edit = async (page: Page) => {
    if (!await page.getByRole('tab', { name: '选手与模型', exact: true }).isVisible()) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
    }
    await page.getByRole('tab', { name: '选手与模型', exact: true }).click();
    await page.getByRole('region', { name: 'DeepSeek', exact: true }).getByRole('button', { name: '编辑', exact: true }).click();
    return page.getByRole('dialog', { name: '编辑 DeepSeek', exact: true });
  };
  const stored = async () => JSON.parse(await readFile(file, 'utf8'));
  let app = await launch();
  try {
    let page = await app.firstWindow(), dialog = await edit(page);
    let toggle = dialog.getByRole('switch', { name: '自动获取模型目录', exact: true });
    await toggle.click(); // 自动等待异步身份读取后可操作。
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await stored()).deepseekCatalogRefresh, undefined);
    dialog = await edit(page); toggle = dialog.getByRole('switch', { name: '自动获取模型目录', exact: true });
    await toggle.click();
    await mkdir(resolve('output/playwright'), { recursive: true });
    for (const variant of [{ name: 'light', width: 1280, scheme: 'light' }, { name: 'dark', width: 1280, scheme: 'dark' }, { name: 'narrow', width: 900, scheme: 'light' }] as const) {
      await page.setViewportSize({ width: variant.width, height: 900 });
      await page.emulateMedia({ colorScheme: variant.scheme });
      const row = dialog.locator('label.provider-toggle').filter({ hasText: '自动获取模型目录' });
      await row.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const bounds = await row.boundingBox(), control = await toggle.boundingBox();
      const head = await dialog.locator('.modal-bar').boundingBox(), foot = await dialog.locator('.modal-foot').boundingBox();
      assert.ok(bounds && control && head && foot);
      assert.ok(bounds.y >= head.y + head.height && bounds.y + bounds.height <= foot.y, '完整授权行在固定头尾之间');
      assert.ok(control.y >= bounds.y && control.y + control.height <= bounds.y + bounds.height);
      await page.screenshot({ animations: 'disabled', path: resolve(`output/playwright/task-031-attempt-17-${variant.name}.png`) });
    }
    await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    const consent = await page.evaluate(() => window.xa.deepseekCatalogConsent());
    assert.equal(consent.enabled, true); assert.ok(consent.grant);
    assert.equal((await stored()).deepseekCatalogRefresh.grant, consent.grant);
    await app.close(); app = await launch(); page = await app.firstWindow(); dialog = await edit(page);
    toggle = dialog.getByRole('switch', { name: '自动获取模型目录', exact: true });
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="自动获取模型目录"]')?.getAttribute('aria-checked') === 'true');
    assert.equal((await page.evaluate(() => window.xa.deepseekCatalogConsent())).grant, consent.grant);
    await dialog.getByLabel('API 地址', { exact: true }).fill('https://other.invalid/v1/');
    assert.equal(await toggle.isDisabled(), true);
    await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => window.xa.deepseekCatalogConsent())).enabled, false);
    assert.equal((await stored()).deepseekCatalogRefresh, undefined);
    dialog = await edit(page); await dialog.getByLabel('API 地址', { exact: true }).fill(defaultDeepseekEndpoint.baseUrl);
    await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => window.xa.deepseekCatalogConsent())).enabled, false);
    assert.equal((await stored()).deepseekCatalogRefresh, undefined);
  } finally { await app.close(); }
});
