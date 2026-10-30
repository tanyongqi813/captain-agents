import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec } from './helpers.ts';
import { defaultDeepseekEndpoint } from '../src/core/deepseek-settings.ts';
import { readDeepseekCatalogConsent, setDeepseekCatalogConsent, writeSettings } from '../src/core/settings.ts';
import { deepseekCredentialVersion } from '../src/core/deepseek-credentials.ts';
import { isDeepseekModelError, recordDeepseekModelError, modelErrorRecoveryController } from '../src/core/deepseek-model-recovery.ts';
import { readDeepseekCatalog, refreshDeepseekCatalog } from '../src/core/deepseek-models.ts';
import { createJob, readJob } from '../src/core/job.ts';
import type { Job } from '../src/core/job.ts';
const errorLine = JSON.stringify({ type: 'turn.failed', error: { code: 'unsupported_parameter', param: 'reasoning_effort', message: 'raw-secret-never-copy' } });
const response = () => new Response('{"data":[{"id":"relay/pro"}]}');
async function setup(t: TestContext) {
  const c = await context(t); process.env.XAGENTS_HOME = c.home;
  const endpoint = { ...defaultDeepseekEndpoint, baseUrl: 'https://relay.invalid/v1/', proModel: 'relay/pro', proReasoning: 'default' as const };
  await writeSettings({ keepAwake: false, deepseek: endpoint }); await mkdir(join(c.home, 'deepseek'));
  await writeFile(join(c.home, 'deepseek/auth.json'), '{"OPENAI_API_KEY":"fake-recovery-key"}');
  const consent = await readDeepseekCatalogConsent(); await setDeepseekCatalogConsent(true, consent.binding!);
  const job: Job = { id: 'model-error', batch: 'test', who: 'deepseek', effort: 'high', model: endpoint.proModel, deepseekConnection: endpoint,
    deepseekCredentialVersion: await deepseekCredentialVersion(), repo: c.repo, worktree: c.repo, base: c.base, branch: 'main', project: '测试', title: '错误回交', kind: '实现', mode: 'read-only', state: 'queued', created: new Date().toISOString() };
  await mkdir(join(c.home, 'jobs', job.id), { recursive: true });
  await writeFile(join(c.home, 'jobs', job.id, 'run.log'), errorLine + '\n');
  const pending = () => readdir(join(c.home, 'model-error-recovery/pending')).catch(() => []);
  return { ...c, endpoint, job, pending };
}

test('仅确定性终态JSON错误被识别，未知/散文/工具错误不猜', () => {
  assert.equal(isDeepseekModelError(errorLine), true);
  assert.equal(isDeepseekModelError('{"type":"error","code":"model_not_found"}'), true);
  for (const line of ['model_not_found', '{bad', '{"type":"item.completed","error":{"code":"model_not_found"}}',
    '{"type":"turn.failed","error":{"code":"unsupported_parameter","param":"temperature"}}',
    '{"type":"turn.failed","error":{"code":"unknown","message":"unsupported reasoning_effort"}}']) assert.equal(isDeepseekModelError(line), false);
});

test('同尝试重复登记/双消费者/冷启动只核对一次，不复制原始错误', async t => {
  const c = await setup(t); let calls = 0, publishes = 0;
  assert.match((await recordDeepseekModelError(c.job))!, /不会自动重试/); await recordDeepseekModelError(c.job);
  assert.equal((await c.pending()).length, 1);
  const request: typeof fetch = async url => { calls++; assert.equal(String(url), 'https://relay.invalid/v1/models'); return response(); };
  const a = modelErrorRecoveryController(request, async () => { publishes++; }, assert.fail);
  const b = modelErrorRecoveryController(request, async () => { publishes++; }, assert.fail);
  t.after(() => { a.stop(); b.stop(); });
  await Promise.all([a.poll(), b.poll()]); await recordDeepseekModelError(c.job); await a.poll();
  const cold = modelErrorRecoveryController(request, async () => {}, assert.fail); await cold.poll(); cold.stop();
  assert.equal(calls, 1); assert.equal(publishes, 1); assert.equal((await c.pending()).length, 0);
  const history = join(c.home, 'model-error-recovery/history'), files = await readdir(history); assert.equal(files.length, 1);
  assert.ok(!(await readFile(join(history, files[0]), 'utf8')).includes('raw-secret'));
});

for (const mode of ['unauthorized', 'renewed', 'identity'] as const) test(`${mode}不向新授权或连接隐式请求`, async t => {
  const c = await setup(t);
  if (mode === 'unauthorized') await setDeepseekCatalogConsent(false);
  await recordDeepseekModelError(c.job);
  if (mode === 'renewed') {
    await setDeepseekCatalogConsent(false); await setDeepseekCatalogConsent(true, (await readDeepseekCatalogConsent()).binding!);
  }
  if (mode === 'identity') await writeSettings({ deepseek: { ...c.endpoint, baseUrl: 'https://other.invalid/' } });
  let calls = 0; const loop = modelErrorRecoveryController(async () => { calls++; return response(); }, async () => {}, assert.fail);
  await loop.poll(); await loop.poll(); loop.stop(); assert.equal(calls, 0);
});

test('查询失败保留旧目录并回交，消费后不自动重试', async t => {
  const c = await setup(t); await refreshDeepseekCatalog(c.endpoint, '', async () => response());
  const before = await readDeepseekCatalog(c.endpoint); await recordDeepseekModelError(c.job);
  let calls = 0, errors = 0;
  const loop = modelErrorRecoveryController(async () => { calls++; throw new Error('raw-secret'); }, async () => assert.fail('失败不发布成功'), text => { errors++; assert.ok(!text.includes('raw-secret')); });
  await loop.poll(); await loop.poll(); loop.stop(); assert.equal(calls, 1); assert.equal(errors, 1);
  const after = await readDeepseekCatalog(c.endpoint); assert.deepEqual(after?.models, before?.models); assert.equal(after?.fetchedAt, before?.fetchedAt); assert.equal(after?.stale, true);
});

test('退出主动取消在途，消费者不发布或复活', async t => {
  const c = await setup(t); await recordDeepseekModelError(c.job);
  let enter!: () => void; const entered = new Promise<void>(r => { enter = r; }); let calls = 0, signal: AbortSignal | null | undefined;
  const loop = modelErrorRecoveryController(async (_url, init) => {
    calls++; signal = init?.signal; enter();
    return new Promise<Response>((_yes, no) => signal!.addEventListener('abort', () => no(new DOMException('fake abort', 'AbortError')), { once: true }));
  }, async () => assert.fail('停止不发布'), assert.fail);
  const running = loop.poll(); await entered; loop.stop(); await running; await loop.poll(); assert.equal(calls, 1); assert.equal(signal?.aborted, true);
});

test('runner终态错误固定提示回交，原报告保留且不在runner请求目录', async t => {
  const c = await setup(t), fake = join(c.temp, 'error-worker.mjs'), dir = join(c.home, 'jobs', c.job.id);
  await writeFile(fake, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(dir, 'final.md'))},'原错误报告仍保留');console.log(${JSON.stringify(errorLine)});process.exitCode=1;`);
  c.job.command = { file: process.execPath, args: [fake, 'exec', '-m', c.job.model, '-'], env: {}, stdin: 'ignore', output: 'run.log' };
  await createJob(c.job);
  const result = await exec(process.execPath, ['--input-type=module', '-e', `import {runWorker} from ${JSON.stringify(new URL('../src/core/runner.ts', import.meta.url).href)};await runWorker(${JSON.stringify(c.job.id)});`], c.repo, { ...c.env, XAGENTS_FAKE_WORKER: fake });
  assert.equal(result.code, 0, result.stderr); const ended = await readJob(c.job.id); assert.equal(ended.state, 'failed'); assert.match(ended.error ?? '', /不会自动重试推理/);
  assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /原错误报告仍保留/); assert.equal((await c.pending()).length, 1); assert.equal(await readDeepseekCatalog(c.endpoint), null);
});
