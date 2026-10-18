import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertDeepseekAvailable, deepseekEndpoint, deepseekOffPeak, defaultDeepseekEndpoint, effectiveDeepseekEndpoint } from '../src/core/deepseek-settings.ts';
import { readSettings, writeSettings } from '../src/core/settings.ts';
import { command, loginDeepseek } from '../src/core/workers.ts';
import { selection } from '../src/core/workers.ts';
import type { Job } from '../src/core/job.ts';
import { context } from './helpers.ts';
import { parseDeepseekModels, queryDeepseekModels } from '../src/core/deepseek-models.ts';

test('DeepSeek 中转设置：缺省官方，规范化地址并拒绝危险或残缺值', () => {
  assert.deepEqual(effectiveDeepseekEndpoint(undefined), defaultDeepseekEndpoint);
  assert.deepEqual(deepseekEndpoint({ baseUrl: 'https://relay.example/v1', wireApi: 'chat', proModel: 'deepseek-chat', flashModel: 'vendor/flash' }),
    { baseUrl: 'https://relay.example/v1/', wireApi: 'chat', proModel: 'deepseek-chat', flashModel: 'vendor/flash', offPeakOnly: false });
  for (const value of [
    { baseUrl: 'http://relay.example/v1', wireApi: 'responses', proModel: 'a', flashModel: 'b' },
    { baseUrl: 'file:///tmp/x', wireApi: 'responses', proModel: 'a', flashModel: 'b' },
    { baseUrl: 'https://u:p@relay.example/', wireApi: 'responses', proModel: 'a', flashModel: 'b' },
    { baseUrl: 'https://relay.example/?key=secret', wireApi: 'responses', proModel: 'a', flashModel: 'b' },
    { baseUrl: 'https://relay.example/', wireApi: 'other', proModel: 'a', flashModel: 'b' },
  ]) assert.throws(() => deepseekEndpoint(value));
  assert.equal(deepseekEndpoint({ baseUrl: 'http://127.0.0.1:8080/v1', wireApi: 'chat', proModel: 'a', flashModel: 'b' }).baseUrl, 'http://127.0.0.1:8080/v1/');
});

test('DeepSeek 中转设置会写盘，启动时使用中转地址、协议和模型映射', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const old = process.env.XAGENTS_CODEX; process.env.XAGENTS_CODEX = resolve('/test/codex');
  t.after(() => old === undefined ? delete process.env.XAGENTS_CODEX : process.env.XAGENTS_CODEX = old);
  const relay = { baseUrl: 'https://relay.example/openai/v1/', wireApi: 'chat' as const, proModel: 'relay-pro', flashModel: 'relay-fast', offPeakOnly: true };
  await writeSettings({ deepseek: relay });
  assert.deepEqual((await readSettings()).deepseek, relay);
  const make = (who: 'deepseek' | 'deepseek-flash'): Job => {
    const chosen = selection(`${who}:high`);
    return { id: 'ds-relay', batch: 'batch', who, model: chosen.model, effort: chosen.effort, repo: '/test/repo', worktree: '/test/repo/worktree', branch: 'xa/test', base: '123', project: '测试', title: '测试', kind: '实现', mode: 'read-only', state: 'queued', created: new Date().toISOString() };
  };
  for (const [who, model] of [['deepseek', 'relay-pro'], ['deepseek-flash', 'relay-fast']] as const) {
    const cmd = await command(make(who), '题目', { denyReadExtra: [] });
    assert.equal(cmd.args[cmd.args.indexOf('-m') + 1], model);
    assert.ok(cmd.args.some(v => v.includes('base_url="https://relay.example/openai/v1/"') && v.includes('wire_api="chat"')));
  }
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ deepseek: { ...relay, wireApi: 'bad' } }));
  assert.deepEqual((await readSettings()).deepseek, defaultDeepseekEndpoint);
});

test('DeepSeek 闲时按北京时间判断，工作日高峰拦截、周末全天放行', () => {
  assert.equal(deepseekOffPeak(new Date('2026-10-16T01:30:00Z')), false); // 周五 09:30
  assert.equal(deepseekOffPeak(new Date('2026-10-16T04:30:00Z')), true);  // 周五 12:30
  assert.equal(deepseekOffPeak(new Date('2026-10-16T06:30:00Z')), false); // 周五 14:30
  assert.equal(deepseekOffPeak(new Date('2026-10-17T02:00:00Z')), true);  // 周六 10:00
  assert.equal(deepseekOffPeak(new Date('2026-10-01T02:00:00Z')), true);  // 国庆节 10:00
  assert.throws(() => assertDeepseekAvailable({ ...defaultDeepseekEndpoint, offPeakOnly: true }, true, new Date('2026-10-16T01:30:00Z')), /仅闲时派活/);
  assert.doesNotThrow(() => assertDeepseekAvailable(defaultDeepseekEndpoint, true, new Date('2026-10-16T01:30:00Z')));
});

test('中转站密钥不必以 sk- 开头，但不接受空白或过短值', async () => {
  for (const key of ['short', 'contains space', 'line\nbreak']) await assert.rejects(loginDeepseek(key));
});

test('从中转站 /models 获取模型：带 Bearer 密钥、去重过滤，兼容 data 和 models 格式', async () => {
  assert.deepEqual(parseDeepseekModels({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-chat' }, { id: '../bad' }, { id: 'vendor/model' }] }), ['deepseek-chat', 'vendor/model']);
  assert.deepEqual(parseDeepseekModels({ models: ['z-model', 'a-model'] }), ['a-model', 'z-model']);
  let seenUrl = '', seenAuth = '';
  const models = await queryDeepseekModels({ baseUrl: 'https://relay.example/openai/v1/', wireApi: 'chat', proModel: 'pro', flashModel: 'flash', offPeakOnly: false }, 'relay-secret-123', async (input, init) => {
    seenUrl = String(input); seenAuth = new Headers(init?.headers).get('Authorization') ?? '';
    return new Response(JSON.stringify({ data: [{ id: 'relay-pro' }, { id: 'relay-fast' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(seenUrl, 'https://relay.example/openai/v1/models');
  assert.equal(seenAuth, 'Bearer relay-secret-123');
  assert.deepEqual(models, ['relay-fast', 'relay-pro']);
});
