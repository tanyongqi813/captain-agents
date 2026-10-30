import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec } from './helpers.ts';
import { defaultDeepseekEndpoint } from '../src/core/deepseek-settings.ts';
import { readDeepseekCatalogConsent, setDeepseekCatalogConsent, writeSettings } from '../src/core/settings.ts';

test('默认关闭，专用入口绑定保存身份，冷读保持、普通补丁不能授权、撤销换代', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  assert.deepEqual(await readDeepseekCatalogConsent(), { enabled: false, binding: null, grant: null });
  await writeSettings({ deepseek: defaultDeepseekEndpoint });
  await mkdir(join(c.home, 'deepseek'));
  await writeFile(join(c.home, 'deepseek/auth.json'), JSON.stringify({ OPENAI_API_KEY: 'fake-secret-never-in-config' }));
  const state = await readDeepseekCatalogConsent(); assert.equal(state.enabled, false); assert.ok(state.binding);
  await assert.rejects(setDeepseekCatalogConsent(true, 'old-binding'), /已改变/);
  await assert.rejects(writeSettings(JSON.parse('{"deepseekCatalogRefresh":true}')), /设置不合法/);
  await setDeepseekCatalogConsent(true, state.binding);
  const enabled = await readDeepseekCatalogConsent(); assert.equal(enabled.enabled, true); assert.ok(enabled.grant);
  const moduleUrl = new URL('../src/core/settings.ts', import.meta.url).href;
  const cold = await exec(process.execPath, ['--input-type=module', '-e', `import {readDeepseekCatalogConsent} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await readDeepseekCatalogConsent()));`], c.repo, c.env);
  assert.equal(cold.code, 0, cold.stderr); assert.deepEqual(JSON.parse(cold.stdout), enabled);
  await setDeepseekCatalogConsent(false); assert.equal((await readDeepseekCatalogConsent()).enabled, false);
  await setDeepseekCatalogConsent(true, state.binding);
  assert.notEqual((await readDeepseekCatalogConsent()).grant, enabled.grant);
  assert.ok(!(await readFile(join(c.home, 'config.json'), 'utf8')).includes('fake-secret'));
});

test('模型价格不影响授权，地址/协议改变同次撤销，切回不能恢复', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await writeSettings({ deepseek: defaultDeepseekEndpoint }); await mkdir(join(c.home, 'deepseek'));
  await writeFile(join(c.home, 'deepseek/auth.json'), '{}');
  const first = await readDeepseekCatalogConsent(); await setDeepseekCatalogConsent(true, first.binding!);
  const changed = { ...defaultDeepseekEndpoint, proModel: 'relay/other' };
  await writeSettings({ deepseek: changed }); assert.equal((await readDeepseekCatalogConsent()).enabled, true);
  await writeSettings({ deepseek: { ...changed, baseUrl: 'https://new.example/v1/' } });
  assert.equal((await readDeepseekCatalogConsent()).enabled, false);
  assert.equal(JSON.parse(await readFile(join(c.home, 'config.json'), 'utf8')).deepseekCatalogRefresh, undefined);
  await writeSettings({ deepseek: defaultDeepseekEndpoint }); assert.equal((await readDeepseekCatalogConsent()).enabled, false);
});

test('凭据版本变更/损坏授权关闭，坏配置不开启也不覆盖', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await writeSettings({ deepseek: defaultDeepseekEndpoint }); await mkdir(join(c.home, 'deepseek'));
  const auth = join(c.home, 'deepseek/auth.json'), file = join(c.home, 'config.json');
  await writeFile(auth, '{}'); const old = await readDeepseekCatalogConsent();
  await setDeepseekCatalogConsent(true, old.binding!);
  await writeFile(auth, '{"OPENAI_API_KEY":"fake-longer-version"}');
  assert.equal((await readDeepseekCatalogConsent()).enabled, false);
  await assert.rejects(setDeepseekCatalogConsent(true, old.binding!), /已改变/);
  const raw = JSON.parse(await readFile(file, 'utf8')); raw.deepseekCatalogRefresh = { binding: (await readDeepseekCatalogConsent()).binding, grant: 'bad' };
  await writeFile(file, JSON.stringify(raw)); assert.equal((await readDeepseekCatalogConsent()).enabled, false);
  await writeFile(file, '{broken'); await assert.rejects(setDeepseekCatalogConsent(false), /损坏/);
  assert.equal(await readFile(file, 'utf8'), '{broken');
});
