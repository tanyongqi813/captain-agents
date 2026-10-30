import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { catalogFailure, queryDeepseekModels, readDeepseekCatalog, refreshDeepseekCatalog } from '../src/core/deepseek-models.ts';
import { deepseekHome } from '../src/core/sandbox.ts';

const endpoint = { baseUrl: 'https://relay.example/v1/', wireApi: 'chat' as const,
  proModel: 'pro', flashModel: 'flash', offPeakOnly: false };
const LIMIT = 2_000_000;
const good = () => new Response(JSON.stringify({ data: [{ id: 'last-good' }] }));

for (const length of [undefined, '1']) test(`目录实际响应超限取消流（Content-Length=${length ?? '缺失'}）`, async () => {
  let cancelled = false;
  let pulls = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) { if (++pulls > 4) controller.close(); else controller.enqueue(new Uint8Array(600_000).fill(32)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }), { headers: length === undefined ? {} : { 'content-length': length } });
  await assert.rejects(queryDeepseekModels(endpoint, 'fake-test-key', async () => response), /过大/);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 5, `读取不应无界继续：${pulls}`);
});

test('精确字节上限内 JSON 接受，多字节字符按字节而非字符计，声明超限不读正文', async () => {
  const prefix = '{"data":[{"id":"allowed"}],"padding":"', suffix = '"}';
  const exact = prefix + ' '.repeat(LIMIT - Buffer.byteLength(prefix + suffix)) + suffix;
  assert.equal(Buffer.byteLength(exact), LIMIT);
  assert.deepEqual(await queryDeepseekModels(endpoint, 'fake-test-key', async () => new Response(exact)), ['allowed']);
  const large = prefix + '模'.repeat(700_000) + suffix;
  assert.ok(large.length < LIMIT);
  await assert.rejects(queryDeepseekModels(endpoint, 'fake-test-key', async () => new Response(large)), /过大/);
  let cancelled = false;
  const declared = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-length': String(LIMIT + 1) } });
  await assert.rejects(queryDeepseekModels(endpoint, 'fake-test-key', async () => declared), /过大/);
  assert.equal(cancelled, true);
});

test('超限、超时与坏 JSON 留存成功目录并使用稳定失败码，不落原始内容', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await mkdir(deepseekHome(), { recursive: true });
  await writeFile(join(deepseekHome(), 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'fake-authorized-key' }));
  await refreshDeepseekCatalog(endpoint, '', async () => good());
  const baseline = await readDeepseekCatalog(endpoint);
  const cases: [string, typeof fetch][] = [
    ['too_large', async () => new Response(' '.repeat(LIMIT + 1))],
    ['timeout', async () => { throw new DOMException('secret-bearer-value', 'AbortError'); }],
    ['invalid', async () => new Response('bad-json-secret-bearer-value')],
  ];
  for (const [code, request] of cases) {
    await assert.rejects(refreshDeepseekCatalog(endpoint, '', request));
    const current = await readDeepseekCatalog(endpoint);
    assert.equal(current?.stale, true);
    assert.equal(current?.failureCode, code);
    assert.deepEqual(current?.models, baseline?.models);
    assert.equal(current?.fetchedAt, baseline?.fetchedAt);
    const dir = join(deepseekHome(), 'model-catalog');
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.json'))) {
      assert.ok(!(await readFile(join(dir, file), 'utf8')).includes('secret-bearer-value'));
    }
  }
  assert.equal(catalogFailure(new Error('获取模型超时，请检查中转站地址。')).code, 'timeout');
});
