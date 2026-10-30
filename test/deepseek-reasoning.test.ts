import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { defaultDeepseekEndpoint, deepseekEndpoint, assertDeepseekReasoning } from '../src/core/deepseek-settings.ts';
import { writeSettings, readDeepseekRuntimeSettings } from '../src/core/settings.ts';
import { dispatch } from '../src/core/dispatch.ts';

const capability = () => ({ baseUrl: defaultDeepseekEndpoint.baseUrl, wireApi: 'responses' as const,
  models: { 'deepseek-v4-pro': { high: true, source: 'user' as const, updatedAt: '2026-10-29T00:00:00.000Z' } } });

test('能力声明严格解析、深复制、持久化；目录ID不是强度能力', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const raw = { ...defaultDeepseekEndpoint, reasoningCapabilities: capability() }, parsed = deepseekEndpoint(raw);
  raw.reasoningCapabilities.models['deepseek-v4-pro'].high = false;
  assert.equal(parsed.reasoningCapabilities?.models['deepseek-v4-pro'].high, true);
  await writeSettings({ deepseek: parsed }); assert.deepEqual(await readDeepseekRuntimeSettings(), parsed);
  assert.doesNotThrow(() => assertDeepseekReasoning(parsed, parsed.proModel));
  for (const patch of [{ source: 'metadata' }, { high: 'yes' }, { updatedAt: 'invalid' }, { updatedAt: '2026-10-29' }, { extra: true }]) {
    const declaration = capability(); Object.assign(declaration.models['deepseek-v4-pro'], patch);
    assert.throws(() => deepseekEndpoint({ ...parsed, reasoningCapabilities: declaration }), /推理能力/);
  }
  assert.throws(() => deepseekEndpoint({ ...parsed, reasoningCapabilities: { ...capability(), models: Object.fromEntries(Array.from({ length: 129 }, (_, n) => [`model${n}`, capability().models['deepseek-v4-pro']])) } }), /128/);
});

test('旧high可读但未知拒绝，默认不需声明，连接协议模型不匹配或不支持都拒绝', () => {
  const old = deepseekEndpoint(defaultDeepseekEndpoint);
  assert.equal(old.proReasoning, undefined); assert.throws(() => assertDeepseekReasoning(old, old.proModel), /默认强度/);
  assert.doesNotThrow(() => assertDeepseekReasoning(old, old.proModel, 'default'));
  const ready = deepseekEndpoint({ ...old, reasoningCapabilities: capability() });
  for (const endpoint of [{ ...ready, baseUrl: 'https://other.invalid/' }, { ...ready, wireApi: 'chat' as const }, { ...ready, reasoningCapabilities: { ...capability(), models: { 'deepseek-v4-pro': { ...capability().models['deepseek-v4-pro'], high: false } } } }]) {
    assert.throws(() => assertDeepseekReasoning(endpoint, old.proModel), /尚未确认或不支持/);
  }
  assert.throws(() => assertDeepseekReasoning(ready, 'another-model'), /尚未确认/);
});

test('派发实际ID按槽位校验，未知能力零注册零启动，不绕过fake；默认通过能力门槛', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home; let starts = 0;
  for (const who of ['deepseek:high', 'deepseek-flash:high']) {
    await writeSettings({ deepseek: defaultDeepseekEndpoint });
    await assert.rejects(dispatch(c.task, { who: [who], summary: '能力门槛' }, async () => { starts++; }), /高档推理能力/);
  }
  assert.equal(starts, 0); assert.deepEqual(await readdir(join(c.home, 'jobs')).catch(() => []), []);
  await writeSettings({ deepseek: { ...defaultDeepseekEndpoint, proReasoning: 'default' } });
  await assert.rejects(dispatch(c.task, { who: ['deepseek:high'], summary: '默认模式继续原检查' }), error => !String(error).includes('高档推理能力'));
  await writeSettings({ deepseek: { ...defaultDeepseekEndpoint, reasoningCapabilities: capability() } });
  await assert.rejects(dispatch(c.task, { who: ['deepseek:high'], summary: '确认模式继续原检查' }), error => !String(error).includes('高档推理能力'));
});
