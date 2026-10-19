import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJson } from '../src/core/fsx.ts';
import { OWNER_CODES } from '../src/core/autopilot-diagnosis.ts';
import {
  NOTICE_MAX_ATTEMPTS, NOTICE_TTL_MS, checkFeishuCredentials, consumeOwnerNotices, feishuPayload,
  handleOwnerNotice, ownerNoticeText, ownerNoticesDir, readOwnerNotices, retryPausedOwnerNotices, sendFeishu,
} from '../src/core/owner-notifications.ts';
import type { FeishuRequest, NoticeSource } from '../src/core/owner-notifications.ts';
import { feishuCredentialStore, feishuNotificationScheduler } from '../app/main/feishu-notifications.ts';
import type { SecretStorage } from '../app/main/feishu-notifications.ts';

const credentials = { webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/fixture-token-only', secret: 'fixture-secret-only' };
const at = Date.parse('2026-10-19T04:00:00Z');
const eventId = '12345678-1234-1234-1234-123456789012';
const source = (extra: Partial<NoticeSource> = {}): NoticeSource => ({ id: '1019-1200-auto', state: 'needs_owner', ownerEvent: eventId,
  ownerCode: 'owner_requested', taskId: 'TASK-001', project: 'demo', ended: new Date(at).toISOString(), ...extra });
async function isolated(t: TestContext) {
  const temp = await mkdtemp(join(tmpdir(), 'xagents-notice-test-'));
  const old = process.env.XAGENTS_HOME; process.env.XAGENTS_HOME = temp;
  t.after(async () => { if (old === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = old; await rm(temp, { recursive: true, force: true }); });
  return temp;
}
const success: FeishuRequest = async () => ({ status: 200, body: '{"code":0}' });

test('Webhook 严格白名单：拒绝控制符、重定向地址、编码路径、额外字段和超长密钥，不回显原值', () => {
  for (const value of [null, [], { ...credentials, extra: true }, { ...credentials, secret: 'x'.repeat(257) }, { ...credentials, secret: 'a\nb' },
    ...['http://open.feishu.cn/open-apis/bot/v2/hook/fixture-token-only', 'https://open.feishu.cn.evil.invalid/open-apis/bot/v2/hook/fixture-token-only',
      credentials.webhook + '?token=secret', credentials.webhook + '#secret', credentials.webhook.replace('/hook/', '/foo/../hook/'),
      credentials.webhook.replace('https:', 'https:\n'), credentials.webhook.replace('fixture-token-only', '%66ixture-token-only'),
      credentials.webhook.replace('open.feishu.cn', 'user:secret@open.feishu.cn'), credentials.webhook.replace('open.feishu.cn', 'open.feishu.cn:443')].map(webhook => ({ webhook }))]) {
    assert.throws(() => checkFeishuCredentials(value), e => e instanceof Error && !e.message.includes('fixture-token') && !e.message.includes('evil.invalid'));
  }
  assert.deepEqual(checkFeishuCredentials(credentials), credentials);
});

test('固定正文只使用白名单事实，不含模型输出、路径和凭据；签名遵守官方 HMAC 协议', async t => {
  await isolated(t);
  const events = await consumeOwnerNotices({ credentials: async () => null, source: async () => [source({ project: '/private/secret/sk-leaked' })], now: () => at });
  const text = ownerNoticeText(events[0]);
  assert.match(text, /TASK-001/); assert.match(text, /12345678/); assert.match(text, /已登记项目/);
  assert.doesNotMatch(text, /private|sk-leaked|fixture-token|fixture-secret/);
  const payload = JSON.parse(feishuPayload(text, credentials, at));
  assert.equal(payload.timestamp, String(at / 1000));
  assert.equal(payload.sign, createHmac('sha256', `${at / 1000}\n${credentials.secret}`).update('').digest('base64'));
  assert.equal(payload.content.text, text);
});

test('所有结构化求助原因和预算/派发拒绝均可离线建事件，重复收集不重复', async t => {
  await isolated(t);
  const rows = [...OWNER_CODES.map((code, i) => source({ id: `1019-1200-auto-${i + 1}`, ownerEvent: `12345678-1234-1234-1234-${String(i + 1).padStart(12, '0')}`, ownerCode: code })),
    source({ id: '1019-1201-auto', ownerEvent: '12345678-1234-1234-1234-999999999991', ownerCode: undefined, limit: 'attempts' }),
    source({ id: '1019-1202-auto', ownerEvent: '12345678-1234-1234-1234-999999999992', ownerCode: undefined })];
  const deps = { credentials: async () => null, source: async () => rows, now: () => at };
  const first = await consumeOwnerNotices(deps), second = await consumeOwnerNotices(deps);
  assert.equal(first.length, rows.length); assert.deepEqual(first, second);
  assert.ok(first.every(e => e.state === 'pending' && e.attempts === 0));
});

test('后来连接补发有效事件；主人已处理或已过期的不补发；成功后永久去重', async t => {
  await isolated(t); let rows = [source()]; let calls = 0;
  const deps = { source: async () => rows, now: () => at, credentials: async () => null };
  await consumeOwnerNotices(deps);
  const connected = { ...deps, credentials: async () => credentials, request: async () => { calls++; return success('', '', new AbortController().signal); } };
  await consumeOwnerNotices(connected); await consumeOwnerNotices(connected); assert.equal(calls, 1);
  assert.equal((await readOwnerNotices())[0].state, 'delivered');
  rows = [source({ id: '1019-1201-auto', ownerEvent: '12345678-1234-1234-1234-999999999991' })];
  await consumeOwnerNotices(deps); await handleOwnerNotice(rows[0].ownerEvent!); await consumeOwnerNotices(connected); assert.equal(calls, 1);
  rows = [source({ id: '1019-1202-auto', ownerEvent: '12345678-1234-1234-1234-999999999992' })];
  await consumeOwnerNotices(deps); await consumeOwnerNotices({ ...connected, now: () => at + NOTICE_TTL_MS }); assert.equal(calls, 1);
  assert.equal((await readOwnerNotices()).find(e => e.run === rows[0].id)?.state, 'expired');
});

test('实际发送前再次核对主人处理状态；收集失败不能把未知任务当已处理', async t => {
  await isolated(t); let count = 0;
  await consumeOwnerNotices({ source: async () => ++count === 1 ? [source()] : [], credentials: async () => credentials,
    now: () => at, request: async () => { assert.fail('已处理事件不应发送'); } });
  assert.equal((await readOwnerNotices())[0].state, 'handled');
  await assert.rejects(consumeOwnerNotices({ source: async () => { throw new Error('坏登记'); }, credentials: async () => null }), /坏登记/);
});

test('429/5xx/网络错误有界退避、重启恢复并达到总上限；原始错误与凭据不落盘', async t => {
  await isolated(t); let now = at, calls = 0;
  const deps = { source: async () => [source()], credentials: async () => credentials, now: () => now,
    request: async () => { calls++; if (calls % 3 === 1) return { status: 429, body: credentials.webhook }; if (calls % 3 === 2) return { status: 503, body: credentials.secret }; throw new Error(credentials.webhook + credentials.secret); } };
  for (let i = 0; i < NOTICE_MAX_ATTEMPTS; i++) {
    const events = await consumeOwnerNotices(deps); assert.equal(events[0].attempts, i + 1);
    await consumeOwnerNotices(deps); assert.equal(calls, i + 1, '退避前不再请求');
    now = Date.parse(events[0].nextAt);
  }
  assert.equal((await consumeOwnerNotices(deps))[0].state, 'exhausted'); assert.equal(calls, NOTICE_MAX_ATTEMPTS);
  const raw = await readFile(join(ownerNoticesDir(), `${eventId}.json`), 'utf8');
  assert.doesNotMatch(raw, /fixture-token|fixture-secret|open.feishu.cn/);
});

test('明确 4xx/机器人错误暂停自动重试，手动修正连接后才恢复', async t => {
  await isolated(t); let calls = 0;
  const deps = { source: async () => [source()], credentials: async () => credentials, now: () => at,
    request: async () => { calls++; return { status: 403, body: 'secret' }; } };
  assert.equal((await consumeOwnerNotices(deps))[0].state, 'paused');
  await consumeOwnerNotices({ ...deps, now: () => at + 60_000 }); assert.equal(calls, 1);
  await retryPausedOwnerNotices();
  const events = await consumeOwnerNotices({ ...deps, request: success, now: () => at + 60_000 }); assert.equal(events[0].state, 'delivered');
});

test('只认明确成功，拒绝 3xx、异常 JSON、超长响应和互相矛盾的响应码', async () => {
  for (const response of [{ status: 302, body: '{"code":0}' }, { status: 200, body: '<html>' }, { status: 200, body: 'null' },
    { status: 200, body: ' '.repeat(16_385) }, { status: 200, body: '{}' }, { status: 200, body: '{"code":1,"StatusCode":0}' }]) {
    assert.ok(await sendFeishu('派活工作台测试', credentials, async () => response, at));
  }
  assert.equal(await sendFeishu('测试', credentials, success, at), null);
  assert.equal(await sendFeishu('测试', credentials, async () => ({ status: 200, body: '{"StatusCode":0}' }), at), null);
});

test('网络挂起到总超时会取消请求，有界返回固定错误，不泄露原始异常', { timeout: 15_000 }, async () => {
  let cancelled = false;
  const result = await sendFeishu('测试', credentials, async (_url, _body, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { cancelled = true; reject(new Error(credentials.secret)); }, { once: true });
  }), at);
  assert.equal(result, 'network'); assert.equal(cancelled, true);
});

test('请求成功但落盘前崩溃：重启可重复投递相同短事件号，不丢事件、不重置尝试数', async t => {
  await isolated(t); let saves = 0, calls = 0;
  const deps = { source: async () => [source()], credentials: async () => credentials, now: () => at,
    request: async (_url: string, body: string) => { calls++; assert.match(body, /12345678/); return { status: 200, body: '{"code":0}' }; } };
  await assert.rejects(consumeOwnerNotices({ ...deps, persist: async event => {
    if (++saves === 2) throw new Error('模拟成功回包后断电');
    await writeJson(join(ownerNoticesDir(), `${event.id}.json`), event);
  } }), /断电/);
  assert.equal((await readOwnerNotices())[0].attempts, 1); assert.equal((await readOwnerNotices())[0].state, 'pending');
  const events = await consumeOwnerNotices({ ...deps, now: () => at + 60_000 });
  assert.equal(calls, 2); assert.equal(events[0].attempts, 2); assert.equal(events[0].state, 'delivered');
});

test('并发消费者跨文件锁去重，一轮至多三条请求；无凭据不消耗次数', async t => {
  await isolated(t); let calls = 0;
  const rows = Array.from({ length: 5 }, (_, i) => source({ id: `1019-1200-auto-${i + 1}`, ownerEvent: `12345678-1234-1234-1234-${String(i).padStart(12, '0')}` }));
  const deps = { source: async () => rows, credentials: async () => credentials, now: () => at,
    request: async () => { calls++; return { status: 200, body: '{"code":0}' }; } };
  assert.equal((await consumeOwnerNotices({ ...deps, credentials: async () => null })).filter(e => e.attempts === 0).length, 5);
  await consumeOwnerNotices(deps); assert.equal(calls, 3);
  await Promise.all([consumeOwnerNotices(deps), consumeOwnerNotices(deps)]); assert.equal(calls, 5);
});

const fakeStorage = (): SecretStorage => ({ isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).reverse(), decryptString: value => Buffer.from(value).reverse().toString() });
test('凭据仅原子保存密文，状态不返回敏感值；加密失败保留旧连接，basic_text 禁止降级', async t => {
  const temp = await isolated(t); const storage = fakeStorage();
  const store = feishuCredentialStore(temp, storage);
  await store.save(credentials); assert.deepEqual(await store.read(), credentials);
  assert.doesNotMatch(JSON.stringify(await store.status()), /fixture-token|fixture-secret|webhook/);
  const raw = await readFile(join(temp, 'protected-credentials', 'feishu.enc'), 'utf8'); assert.doesNotMatch(raw, /fixture-token|fixture-secret/);
  storage.encryptString = () => { throw new Error(credentials.secret); };
  await assert.rejects(store.save({ webhook: credentials.webhook }), /原连接没有改变/); assert.deepEqual(await store.read(), credentials);
  storage.getSelectedStorageBackend = () => 'basic_text';
  await assert.rejects(store.save(credentials), /安全存储不可用/); assert.equal(await store.read(), null);
  storage.getSelectedStorageBackend = () => 'keychain'; await store.disconnect(); assert.equal(await store.read(), null);
  assert.deepEqual(await readdir(join(temp, 'protected-credentials')), []);
});

test('桌面消费器不重入，停止后不再唤醒；异常只传固定信号', async t => {
  await isolated(t); let calls = 0, release: () => void = () => {};
  const pending = new Promise<void>(r => { release = r; });
  const scheduler = feishuNotificationScheduler({ credentials: async () => null, source: async () => { calls++; await pending; return []; } });
  const a = scheduler.wake(), b = scheduler.wake(); assert.equal(a, b);
  scheduler.stop(); release(); await scheduler.settled(); await scheduler.wake(); assert.equal(calls, 1);
});
