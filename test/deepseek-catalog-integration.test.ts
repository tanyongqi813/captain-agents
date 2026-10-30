import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { writeSettings, readDeepseekCatalogConsent, setDeepseekCatalogConsent } from '../src/core/settings.ts';
import { readDeepseekCatalog } from '../src/core/deepseek-models.ts';
import { catalogRefreshController } from '../src/core/deepseek-catalog-loop.ts';

async function setup(t: TestContext) {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const endpoint = { ...defaultDeepseekEndpoint, baseUrl: 'https://relay.invalid/v1/', proModel: 'relay/pro', flashModel: 'relay/flash', money: defaultDeepseekMoney };
  await writeSettings({ deepseek: endpoint });
  await mkdir(join(c.home, 'deepseek'));
  await writeFile(join(c.home, 'deepseek/auth.json'), '{"OPENAI_API_KEY":"fake-integration-only"}');
  const enable = async () => setDeepseekCatalogConsent(true, (await readDeepseekCatalogConsent()).binding!);
  return { ...c, endpoint, enable };
}

test('真实默认依赖组合：默认零请求、授权仅GET目录、持久限频且模型价格不变', async t => {
  const c = await setup(t); let calls = 0, publishes = 0;
  const loop = catalogRefreshController(async (url, init) => {
    calls++; assert.equal(String(url), 'https://relay.invalid/v1/models');
    assert.equal(init?.method ?? 'GET', 'GET'); assert.equal(init?.body, undefined); assert.equal(init?.redirect, 'error');
    return new Response('{"data":[{"id":"relay/pro"},{"id":"relay/flash"}]}');
  }, async () => { publishes++; }, assert.fail);
  t.after(() => loop.stop());
  await loop.poll(); await loop.settled(); assert.equal(calls, 0);
  await c.enable(); const saved = await readFile(join(c.home, 'config.json'), 'utf8');
  await loop.poll(); await loop.settled(); assert.equal(calls, 1); assert.equal(publishes, 1);
  const catalog = await readDeepseekCatalog(c.endpoint); assert.ok(catalog?.accountVerified);
  assert.deepEqual(catalog.models, ['relay/flash', 'relay/pro']); assert.equal(catalog.stale, false);
  await loop.poll(); await loop.settled(); assert.equal(calls, 1);
  assert.equal(await readFile(join(c.home, 'config.json'), 'utf8'), saved);
  loop.stop(); await loop.poll(); assert.equal(calls, 1);
});

for (const mode of ['revoke', 'stop'] as const) test(`真实默认依赖组合：${mode}中止在途，旧请求不发布目录`, async t => {
  const c = await setup(t); await c.enable();
  let enter!: () => void, signal: AbortSignal | null | undefined;
  const entered = new Promise<void>(r => { enter = r; });
  let calls = 0, publishes = 0;
  const loop = catalogRefreshController(async (_url, init) => {
    calls++; signal = init?.signal; enter();
    return new Promise<Response>((_resolve, reject) => {
      assert.ok(signal); signal.addEventListener('abort', () => reject(new DOMException('fake abort', 'AbortError')), { once: true });
    });
  }, async () => { publishes++; }, assert.fail);
  t.after(() => loop.stop());
  await loop.poll(); await entered;
  if (mode === 'stop') loop.stop();
  else { await setDeepseekCatalogConsent(false); await loop.poll(); }
  await loop.settled(); assert.equal(signal?.aborted, true); assert.equal(publishes, 0);
  assert.equal(await readDeepseekCatalog(c.endpoint), null);
  loop.stop(); await loop.poll(); assert.equal(calls, 1);
});
