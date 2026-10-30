import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { defaultDeepseekEndpoint } from '../src/core/deepseek-settings.ts';
import { readDeepseekCatalogConsent, setDeepseekCatalogConsent, writeSettings } from '../src/core/settings.ts';
import { readDeepseekCatalog, refreshDeepseekCatalog, refreshConsentedDeepseekCatalog } from '../src/core/deepseek-models.ts';
const response = (id: string) => new Response(JSON.stringify({ data: [{ id }] }));

test('合法受控查询发布目录，失败保留旧成功并标陈旧，未授权不请求', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await writeSettings({ deepseek: defaultDeepseekEndpoint }); await mkdir(join(c.home, 'deepseek'));
  await writeFile(join(c.home, 'deepseek/auth.json'), '{"OPENAI_API_KEY":"fake-saved-key"}');
  const state = await readDeepseekCatalogConsent(); let calls = 0;
  await assert.rejects(refreshConsentedDeepseekCatalog(state, async () => { calls++; return response('bad'); }), /授权/);
  assert.equal(calls, 0);
  await setDeepseekCatalogConsent(true, state.binding!); const consent = await readDeepseekCatalogConsent();
  await refreshConsentedDeepseekCatalog(consent, async (url, init) => {
    assert.match(String(url), /\/models$/); assert.equal(init?.redirect, 'error'); calls++; return response('relay/valid');
  });
  const first = await readDeepseekCatalog(defaultDeepseekEndpoint); assert.deepEqual(first?.models, ['relay/valid']);
  await assert.rejects(refreshConsentedDeepseekCatalog(consent, async () => { throw new TypeError('network fake'); }));
  const stale = await readDeepseekCatalog(defaultDeepseekEndpoint);
  assert.equal(stale?.stale, true); assert.equal(stale?.fetchedAt, first?.fetchedAt); assert.deepEqual(stale?.models, first?.models);
  assert.equal(calls, 1);
});

for (const mode of ['revoke', 'renew', 'address', 'key', 'failure'] as const) test(`在途${mode}使成功/失败提交失效，撤销不等待网络`, async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await writeSettings({ deepseek: defaultDeepseekEndpoint }); await mkdir(join(c.home, 'deepseek'));
  const auth = join(c.home, 'deepseek/auth.json'); await writeFile(auth, '{"OPENAI_API_KEY":"fake-saved-key"}');
  await refreshDeepseekCatalog(defaultDeepseekEndpoint, '', async () => response('relay/original'));
  const original = await readDeepseekCatalog(defaultDeepseekEndpoint);
  await setDeepseekCatalogConsent(true, (await readDeepseekCatalogConsent()).binding!);
  const consent = await readDeepseekCatalogConsent();
  let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
  let resolve!: (r: Response) => void, reject!: (e: Error) => void;
  const pending = refreshConsentedDeepseekCatalog(consent, () => {
    entered(); return new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  });
  const outcome = pending.then(() => false, () => true);
  await started;
  if (mode === 'address') await writeSettings({ deepseek: { ...defaultDeepseekEndpoint, baseUrl: 'https://new.example/v1/' } });
  else if (mode === 'key') await writeFile(auth, '{"OPENAI_API_KEY":"fake-replacement-longer-key"}');
  else {
    await setDeepseekCatalogConsent(false); // 网络尚未返回，此处须能完成。
    if (mode === 'renew') await setDeepseekCatalogConsent(true, consent.binding!);
  }
  if (mode === 'failure') reject(new TypeError('network fake')); else resolve(response('relay/forbidden'));
  assert.equal(await outcome, true);
  assert.deepEqual(await readDeepseekCatalog(defaultDeepseekEndpoint), original);
});
