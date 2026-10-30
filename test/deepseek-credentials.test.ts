import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { defaultDeepseekEndpoint, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { readDeepseekRuntimeSettings } from '../src/core/settings.ts';
import { deepseekCredentialVersion, prepareDeepseekCredentials } from '../src/core/deepseek-credentials.ts';

test('收费配置严格校验：损坏预算和损坏 JSON 不回退成预算关闭', async t => {
  const c = await context(t, false), old = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (old === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = old; });
  assert.deepEqual(await readDeepseekRuntimeSettings(), defaultDeepseekEndpoint);
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ deepseek: { ...defaultDeepseekEndpoint, money: { ...defaultDeepseekMoney, hard: 'broken' } } }));
  await assert.rejects(readDeepseekRuntimeSettings(), /暂停调用/);
  await writeFile(join(c.home, 'config.json'), '{broken');
  await assert.rejects(readDeepseekRuntimeSettings(), /损坏/);
  await writeFile(join(c.home, 'config.json'), '   ');
  await assert.rejects(readDeepseekRuntimeSettings(), /损坏/);
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ deepseek: defaultDeepseekEndpoint }));
  assert.deepEqual(await readDeepseekRuntimeSettings(), defaultDeepseekEndpoint);
});

test('私有认证快照绑定版本和地址，后续换钥匙不改变已准备的认证文件', async t => {
  const c = await context(t, false), old = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (old === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = old; });
  const connection = { ...defaultDeepseekEndpoint, baseUrl: 'https://old.example/v1/' };
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ deepseek: connection }));
  await mkdir(join(c.home, 'deepseek'));
  const auth = join(c.home, 'deepseek/auth.json');
  const original = JSON.stringify({ OPENAI_API_KEY: 'fake-old-credential' });
  await writeFile(auth, original);
  const version = await deepseekCredentialVersion();
  const snapshot = await prepareDeepseekCredentials('job-a', connection, version);
  assert.equal(await readFile(join(snapshot.home, 'auth.json'), 'utf8'), original);
  if (process.platform !== 'win32') assert.equal((await stat(join(snapshot.home, 'auth.json'))).mode & 0o777, 0o600);
  await writeFile(auth, JSON.stringify({ OPENAI_API_KEY: 'fake-new-longer-credential' }));
  assert.equal(await readFile(join(snapshot.home, 'auth.json'), 'utf8'), original);
  await assert.rejects(prepareDeepseekCredentials('job-b', connection, version), /凭据已改变/);
  const newVersion = await deepseekCredentialVersion();
  await writeFile(join(c.home, 'config.json'), JSON.stringify({ deepseek: { ...connection, baseUrl: 'https://new.example/v1/' } }));
  await assert.rejects(prepareDeepseekCredentials('job-c', connection, newVersion), /连接已改变/);
  await snapshot.release();
  await assert.rejects(readFile(join(snapshot.home, 'auth.json')), /ENOENT/);
  assert.ok(!version.includes('fake-old-credential'));
});
