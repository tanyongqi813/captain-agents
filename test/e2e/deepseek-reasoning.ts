import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright-core';
import type { Page } from 'playwright-core';
import { context } from '../helpers.ts';
import { defaultDeepseekEndpoint } from '../../src/core/deepseek-settings.ts';

test('真实窗口：显式能力取消不写、保存进程重启保持，换模型不借旧声明', { timeout: 60_000 }, async t => {
  const c = await context(t, false), file = join(c.home, 'config.json');
  await writeFile(file, JSON.stringify({ deepseek: defaultDeepseekEndpoint }));
  const env = Object.fromEntries(Object.entries(c.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
  const launch = () => _electron.launch({ args: [resolve('out/main/index.js')], env: { ...env, XAGENTS_E2E: '1', XAGENTS_USER_DATA: join(c.temp, 'electron') } });
  const edit = async (page: Page) => {
    if (!await page.getByRole('tab', { name: '选手与模型', exact: true }).isVisible()) await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '选手与模型', exact: true }).click();
    await page.getByRole('region', { name: 'DeepSeek', exact: true }).getByRole('button', { name: '编辑', exact: true }).click();
    return page.getByRole('dialog', { name: '编辑 DeepSeek', exact: true });
  };
  const stored = async () => JSON.parse(await readFile(file, 'utf8'));
  let app = await launch();
  try {
    let page = await app.firstWindow(), dialog = await edit(page);
    await dialog.getByText(/Pro 旧高档尚未确认/).waitFor();
    await dialog.getByRole('switch', { name: '我已确认 Pro 当前模型支持高档', exact: true }).click();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal((await stored()).deepseek.reasoningCapabilities, undefined);
    dialog = await edit(page);
    await dialog.getByRole('switch', { name: '我已确认 Pro 当前模型支持高档', exact: true }).click();
    await dialog.getByLabel('Flash 推理强度', { exact: true }).selectOption('default');
    await mkdir(resolve('output/playwright'), { recursive: true });
    for (const variant of [{ name: 'light', width: 1280, scheme: 'light' }, { name: 'dark', width: 1280, scheme: 'dark' }, { name: 'narrow', width: 900, scheme: 'light' }] as const) {
      await page.setViewportSize({ width: variant.width, height: 900 }); await page.emulateMedia({ colorScheme: variant.scheme });
      const row = dialog.locator('label.provider-toggle').filter({ hasText: 'Pro 高档能力确认' });
      await row.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const bounds = await row.boundingBox(), head = await dialog.locator('.modal-bar').boundingBox(), foot = await dialog.locator('.modal-foot').boundingBox();
      assert.ok(bounds && head && foot); assert.ok(bounds.y >= head.y + head.height && bounds.y + bounds.height <= foot.y);
      await page.screenshot({ animations: 'disabled', path: resolve(`output/playwright/task-032-attempt-04-${variant.name}.png`) });
    }
    await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    const saved = (await stored()).deepseek, entry = saved.reasoningCapabilities.models[saved.proModel];
    assert.equal(entry.high, true); assert.equal(entry.source, 'user'); assert.equal(new Date(entry.updatedAt).toISOString(), entry.updatedAt);
    assert.equal(saved.flashReasoning, 'default'); assert.equal(saved.proReasoning, undefined, '旧隐式high未被静默改值');
    await app.close(); app = await launch(); page = await app.firstWindow(); dialog = await edit(page);
    assert.equal(await dialog.getByRole('switch', { name: '我已确认 Pro 当前模型支持高档', exact: true }).getAttribute('aria-checked'), 'true');
    await dialog.getByText(/Pro 来源：用户确认/).waitFor();
    assert.equal((await stored()).deepseek.reasoningCapabilities.models[saved.proModel].updatedAt, entry.updatedAt);
    await dialog.getByLabel('Pro 模型 ID', { exact: true }).fill('other-model');
    assert.equal(await dialog.getByRole('switch', { name: '我已确认 Pro 当前模型支持高档', exact: true }).getAttribute('aria-checked'), 'false');
    await dialog.getByText(/Pro 旧高档尚未确认/).waitFor();
    await dialog.getByRole('button', { name: '取消', exact: true }).click(); assert.equal((await stored()).deepseek.proModel, saved.proModel);
  } finally { await app.close(); }
});
