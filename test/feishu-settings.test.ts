import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { feishuActions } from '../app/main/feishu-bridge.ts';
import { feishuCredentialStore, feishuNotificationScheduler } from '../app/main/feishu-notifications.ts';
import type { SecretStorage } from '../app/main/feishu-notifications.ts';
import { writeJson } from '../src/core/fsx.ts';
import { settingsActions } from '../app/main/actions.ts';
import { readSettings, writeSettings, setNetworkAllowed } from '../src/core/settings.ts';

const creds = { webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/fixture-token-only', secret: 'fixture-secret-only' };
const fakeStorage = (): SecretStorage => ({ isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s).reverse(), decryptString: b => Buffer.from(b).reverse().toString() });
async function world(t: TestContext) {
  const temp = await mkdtemp(join(tmpdir(), 'xagents-feishu-settings-')), home = join(temp, 'registry');
  await mkdir(home); const old = process.env.XAGENTS_HOME; process.env.XAGENTS_HOME = home;
  t.after(async () => { if (old === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = old; await rm(temp, { recursive: true, force: true }); });
  const storage = fakeStorage(), store = feishuCredentialStore(temp, storage);
  return { temp, home, storage, store };
}

test('连接、固定正文测试、重启状态、替换和断开；后台从不回传凭据', async t => {
  const c = await world(t); let calls = 0;
  const bridge = feishuActions(c.store, async (url, body) => {
    calls++; assert.equal(url, creds.webhook); const payload = JSON.parse(body);
    assert.match(payload.content.text, /^派活工作台：测试通知/); assert.match(payload.content.text, /测试事件：[0-9a-f-]{36}/);
    assert.doesNotMatch(payload.content.text, /fixture-token|fixture-secret/); assert.ok(payload.sign);
    return { status: 200, body: '{"code":0}' };
  });
  const connected = await bridge.connect([creds]); assert.equal(connected.connected, true);
  assert.equal(calls, 0, '保存不暗中发送测试通知');
  const tested = await bridge.test([]); assert.equal(calls, 1); assert.equal(tested.lastTest?.ok, true); assert.ok(tested.lastSuccess);
  const restarted = feishuActions(feishuCredentialStore(c.temp, c.storage));
  assert.deepEqual(await restarted.status([]), tested);
  assert.doesNotMatch(JSON.stringify(tested), /fixture-token|fixture-secret|webhook|sign|protected-credentials/);
  const replaced = await bridge.connect([{ webhook: creds.webhook }]); assert.equal(replaced.lastTest, undefined);
  assert.equal((await bridge.disconnect([])).connected, false); assert.equal(await c.store.read(), null);
});

test('老版密文凭据兼容；测试状态与凭据共用一个原子加密文件', async t => {
  const c = await world(t), folder = join(c.temp, 'protected-credentials'); await mkdir(folder);
  await writeFile(join(folder, 'feishu.enc'), c.storage.encryptString(JSON.stringify(creds)));
  assert.deepEqual(await c.store.read(), creds);
  await c.store.test(async () => ({ status: 403, body: creds.secret }), 123_000);
  const status = await c.store.status(); assert.equal(status.lastTest?.ok, false); assert.match(status.lastTest?.error ?? '', /检查/);
  assert.equal(status.lastTest?.at, new Date(123_000).toISOString());
  const raw = await readFile(join(folder, 'feishu.enc'), 'utf8'); assert.doesNotMatch(raw, /fixture-token|fixture-secret/);
  assert.deepEqual(await c.store.read(), creds);
});

test('非法参数在保存/网络副作用前拒绝，异常不回显 URL/密钥；普通设置不能写飞书凭据', async t => {
  const c = await world(t); let calls = 0;
  const bridge = feishuActions(c.store, async () => { calls++; throw new Error(creds.secret); });
  for (const args of [[], [creds, true], [null], [{ ...creds, extra: true }], [{ ...creds, webhook: creds.webhook.replace('https:', 'http:') }],
    [{ ...creds, secret: 'bad\nsecret' }], [{ ...creds, secret: 'x'.repeat(257) }], [{ ...creds, webhook: 'https://localhost/private-secret' }]]) {
    await assert.rejects(async () => bridge.connect(args), e => e instanceof Error && !e.message.includes('fixture-secret') && !e.message.includes('private-secret'));
  }
  for (const operation of [bridge.status, bridge.test, bridge.disconnect]) await assert.rejects(async () => operation([creds]));
  assert.equal(calls, 0); assert.equal(await c.store.read(), null);
  const settings = settingsActions({ readSettings, writeSettings, setNetworkAllowed, getLogin: () => false, setLogin: () => {}, setAppearance: () => {} });
  await assert.rejects(settings.set([{ feishu: creds }])); assert.equal(await c.store.read(), null);
});

test('替换失败保留旧连接，安全存储不可用禁止降级；解密失败只给固定操作提示', async t => {
  const c = await world(t); await c.store.save(creds);
  const before = await readFile(join(c.temp, 'protected-credentials/feishu.enc'));
  c.storage.encryptString = () => { throw new Error(creds.secret); };
  await assert.rejects(c.store.save({ webhook: creds.webhook.replace('fixture-token', 'another-token') }), /原连接没有改变/);
  assert.deepEqual(await readFile(join(c.temp, 'protected-credentials/feishu.enc')), before);
  c.storage.getSelectedStorageBackend = () => 'basic_text';
  await assert.rejects(c.store.save(creds), /安全存储不可用/); assert.equal((await c.store.status()).protected, false);
  c.storage.getSelectedStorageBackend = () => 'keychain'; c.storage.decryptString = () => { throw new Error(creds.webhook); };
  assert.deepEqual(await c.store.status(), { connected: false, protected: true, lastSuccess: null, issue: '凭据不可用，请重新连接飞书机器人。' });
});

test('测试、替换、断开和后台消费严格串行；断开完成后无旧目标请求继续', async t => {
  const c = await world(t); await c.store.save(creds);
  let release: () => void = () => {}, entered: () => void = () => {}, calls = 0;
  const hold = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const bridge = feishuActions(c.store, async () => { calls++; entered(); await hold; return { status: 200, body: '{"code":0}' }; });
  const testing = bridge.test([]); await started;
  let saved = false, disconnected = false;
  const replacing = bridge.connect([{ webhook: creds.webhook }]).then(() => { saved = true; });
  const stopping = bridge.disconnect([]).then(() => { disconnected = true; });
  await setImmediate(); assert.equal(saved, false); assert.equal(disconnected, false);
  release(); await Promise.all([testing, replacing, stopping]); assert.equal(await c.store.read(), null);
  await bridge.consume(); assert.equal(calls, 1);
});

test('断开保留事件与历史，统计仅为事实；连接失败/测试失败不生成新的求助事件', async t => {
  const c = await world(t), directory = join(c.home, 'owner-notifications'); await mkdir(directory);
  const id = '12345678-1234-1234-1234-123456789012', at = new Date().toISOString();
  await writeJson(join(directory, id + '.json'), { version: 1, id, run: '1019-1200-auto', task: 'TASK-001', project: 'demo', at,
    code: 'owner_requested', state: 'pending', attempts: 1, nextAt: at, error: 'network' });
  const before = await readFile(join(directory, id + '.json'), 'utf8');
  const bridge = feishuActions(c.store, async () => { throw new Error(creds.secret); });
  await bridge.connect([creds]); const tested = await bridge.test([]); assert.equal(tested.lastTest?.ok, false); assert.equal(tested.pending, 1);
  const disconnected = await bridge.disconnect([]); assert.equal(disconnected.pending, 1); assert.match(disconnected.deliveryIssue ?? '', /网络/);
  assert.equal(await readFile(join(directory, id + '.json'), 'utf8'), before);
});

test('消费调度复用串行服务且停止后不再发送', async () => {
  let calls = 0;
  const scheduler = feishuNotificationScheduler({ credentials: async () => { assert.fail('不能走未串行的旧消费器'); } }, { run: async () => { calls++; } });
  await scheduler.wake(); scheduler.stop(); await scheduler.wake(); assert.equal(calls, 1);
});

test('最近一次测试失败不抹掉之前的成功时间，重启也保留两种事实', async t => {
  const c = await world(t); await c.store.save(creds);
  await c.store.test(async () => ({ status: 200, body: '{"code":0}' }), 123_000);
  await c.store.test(async () => ({ status: 403, body: 'forbidden' }), 456_000);
  const status = await feishuActions(feishuCredentialStore(c.temp, c.storage)).status([]);
  assert.equal(status.lastSuccess, new Date(123_000).toISOString());
  assert.equal(status.lastTest?.ok, false); assert.equal(status.lastTest?.at, new Date(456_000).toISOString());
});
