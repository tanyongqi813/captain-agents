import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertDeepseekAvailable, deepseekEndpoint, deepseekOffPeak, defaultDeepseekEndpoint, effectiveDeepseekEndpoint } from '../src/core/deepseek-settings.ts';
import { readSettings, writeSettings } from '../src/core/settings.ts';
import { command, loginDeepseek } from '../src/core/workers.ts';
import { selection } from '../src/core/workers.ts';
import type { Job } from '../src/core/job.ts';
import { context } from './helpers.ts';
import { parseDeepseekModels, queryDeepseekModels, readDeepseekCatalog, refreshDeepseekCatalog } from '../src/core/deepseek-models.ts';
import { deepseekHome } from '../src/core/sandbox.ts';
import { spawn } from 'node:child_process';
import { deepseekMoney, defaultDeepseekMoney } from '../src/core/deepseek-settings.ts';
import { reserveMoney, observeMoney, readMoneyStatus } from '../src/core/money-budget.ts';

test('金额账本只初始化缺失文件，已有损坏账本拒绝且原文不变', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const config = { ...defaultDeepseekMoney, enabled: true, soft: 2, hard: 3, reserve: 1,
    pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
  const file = join(c.home, 'money-budget', 'deepseek.json');
  const now = Date.parse('2026-10-27T08:00:00Z');
  assert.equal((await readMoneyStatus(now)).spent, 0);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  await reserveMoney('first', config, config.pro, now);
  await observeMoney('first', config, { read: 3_000_000, cached: 0, out: 0 }, true, now);
  const original = await readFile(file, 'utf8');
  assert.equal((await readMoneyStatus(now)).spent, 3);
  assert.equal((await readMoneyStatus(now)).stopped, true);
  await assert.rejects(reserveMoney('blocked', config, config.pro, now), /预算|上限/);
  assert.equal(await readFile(file, 'utf8'), original);

  const corrupt = ['', ' \n\t', '{', 'null', '[]', '{}', '"bad"',
    '{"version":1,"days":[],"entries":{},"stopped":[]}',
    '{"version":1,"days":{},"entries":[],"stopped":[]}',
    '{"version":1,"days":{},"entries":{},"stopped":{}}'];
  for (const [index, raw] of corrupt.entries()) await t.test(`损坏样例 ${index + 1}`, async () => {
    await writeFile(file, raw);
    await assert.rejects(readMoneyStatus(now));
    assert.equal(await readFile(file, 'utf8'), raw);
    await assert.rejects(reserveMoney('new', config, config.pro, now));
    assert.equal(await readFile(file, 'utf8'), raw);
    await assert.rejects(observeMoney('first', config, undefined, true, now));
    assert.equal(await readFile(file, 'utf8'), raw);
  });
});

test('每日金额账本：缓存不重复收费，软预算停新活，上限独立停，同任务结算幂等', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const config = deepseekMoney({ ...defaultDeepseekMoney, enabled: true, soft: 2, hard: 3, reserve: 2, pro: { input: 1, cached: 0.1, output: 2 }, flash: { input: 1, cached: 0.1, output: 2 } });
  const now = Date.parse('2026-10-26T08:00:00Z');
  await reserveMoney('a', config, config.pro, now);
  await assert.rejects(reserveMoney('b', config, config.pro, now), /软预算|不足/);
  await observeMoney('a', config, { read: 1_000_000, cached: 500_000, out: 0 }, false, now + 1000);
  assert.equal((await readMoneyStatus(now)).spent, 0.55);
  await observeMoney('a', config, { read: 1_000_000, cached: 500_000, out: 0 }, false, now + 2000);
  assert.equal((await readMoneyStatus(now)).spent, 0.55);
  assert.match((await observeMoney('a', config, { read: 1_000_000, cached: 0, out: 1_000_000 }, false, now + 3000))!, /上限/);
  await assert.rejects(reserveMoney('b', config, config.pro, now + 4000), /软预算|上限/);
  await observeMoney('a', config, { read: 1_000_000, cached: 0, out: 1_000_000 }, true, now + 5000);
  assert.equal((await readMoneyStatus(now)).reserved, 0);
  assert.equal((await readMoneyStatus(now)).spent, 3);
});

test('费用无观测到时停止，保守结算预留；跨天不会自动重开任务', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const config = { ...defaultDeepseekMoney, enabled: true, pro: { input: 1, cached: 0, output: 1 }, flash: { input: 1, cached: 0, output: 1 } };
  const now = Date.parse('2026-10-26T15:58:00Z');
  await reserveMoney('unknown', config, config.pro, now);
  assert.match((await observeMoney('unknown', config, undefined, false, now + 181_000))!, /无观测|未返回/);
  await observeMoney('unknown', config, undefined, true, now + 181_000);
  const status = await readMoneyStatus(now + 181_000);
  assert.equal(status.spent, 1); assert.equal(status.unknown, 1); assert.equal(status.reserved, 0);
  assert.throws(() => deepseekMoney({ ...config, soft: 20, hard: 10 }));
  assert.throws(() => deepseekMoney({ ...config, pro: { input: -1, cached: 0, output: 1 } }));
});

test('目录冷启动失败保留请求屏障，临时请求不屏蔽已保存凭据结果', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await saveRelayKey();
  let release!: (response: Response) => void;
  let entered!: () => void;
  let started = new Promise<void>(resolve => { entered = resolve; });
  const early = refreshDeepseekCatalog(relayEndpoint, '', () => { entered(); return new Promise(resolve => { release = resolve; }); });
  await started;
  await assert.rejects(refreshDeepseekCatalog(relayEndpoint, '', async () => new Response('', { status: 503 })));
  release(jsonResponse(['old-model'])); await early;
  assert.equal(await readDeepseekCatalog(relayEndpoint), null, '首次失败后旧成功不能发布');
  const other = { ...relayEndpoint, baseUrl: 'https://second.example/v1/' };
  started = new Promise<void>(resolve => { entered = resolve; });
  const saved = refreshDeepseekCatalog(other, '', () => { entered(); return new Promise(resolve => { release = resolve; }); });
  await started;
  await refreshDeepseekCatalog(other, 'fake-temporary-key', async () => jsonResponse(['temporary-model']));
  release(jsonResponse(['saved-model'])); await saved;
  assert.deepEqual((await readDeepseekCatalog(other))?.models, ['saved-model']);
  assert.equal((await readDeepseekCatalog(other))?.accountVerified, true);
});

test('两个独立进程共享目录请求屏障：旧成功不能清除新失败', { timeout: 20_000 }, async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await saveRelayKey();
  await refreshDeepseekCatalog(relayEndpoint, '', async () => jsonResponse(['baseline']));
  const baseline = await readDeepseekCatalog(relayEndpoint);
  const moduleUrl = new URL('../src/core/deepseek-models.ts', import.meta.url).href;
  const start = async (fail: boolean) => {
    const code = `import {refreshDeepseekCatalog} from ${JSON.stringify(moduleUrl)};
      await refreshDeepseekCatalog(${JSON.stringify(relayEndpoint)}, '', async () => {
        process.stdout.write('ready\\n');
        await new Promise(resolve => process.stdin.once('data', resolve));
        return new Response(JSON.stringify({data:[{id:'old-child'}]}),{status:${fail ? 503 : 200}});
      }).catch(error => { if (!${fail}) throw error; });
      process.stdin.destroy();`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, XAGENTS_HOME: c.home }, stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let errors = ''; child.stderr.on('data', data => { errors += data; });
    const ended = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(errors))); });
    ended.catch(() => {});
    await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); child.once('exit', code => reject(new Error(`子进程过早退出 ${code}: ${errors}`))); });
    return { child, ended };
  };
  const old = await start(false);
  const newer = await start(true);
  newer.child.stdin.end('release'); await newer.ended;
  const failed = await readDeepseekCatalog(relayEndpoint);
  assert.equal(failed?.stale, true);
  old.child.stdin.end('release'); await old.ended;
  const result = await readDeepseekCatalog(relayEndpoint);
  assert.deepEqual(result?.models, ['baseline']);
  assert.equal(result?.fetchedAt, baseline?.fetchedAt);
  assert.equal(result?.sequence, failed?.sequence);
  assert.equal(result?.stale, true);
});

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

test('DeepSeek 默认强度不发覆盖参数，已登记任务固定模型与连接不随设置改变', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const frozen = { ...relayEndpoint, proReasoning: 'default' as const, flashReasoning: 'default' as const };
  await writeSettings({ deepseek: { ...relayEndpoint, proModel: 'changed-model' } });
  const chosen = selection('deepseek:high');
  const job = { id: 'frozen-ds', batch: 'test', ...chosen, model: 'original-model', deepseekConnection: frozen,
    repo: c.repo, worktree: c.repo, branch: 'test', base: 'abc', project: '测试', title: '测试', kind: '实现',
    mode: 'read-only', state: 'queued', created: new Date().toISOString() } as Job;
  const cmd = await command(job, '只读测试', { denyReadExtra: [] });
  assert.equal(cmd.args[cmd.args.indexOf('-m') + 1], 'original-model');
  assert.ok(!cmd.args.some(arg => arg.includes('model_reasoning_effort')));
  assert.ok(cmd.args.some(arg => arg.includes(frozen.baseUrl)));
  const explicit = await command({ ...job, deepseekConnection: { ...frozen, proReasoning: 'high' } }, '只读测试', { denyReadExtra: [] });
  assert.ok(explicit.args.includes('model_reasoning_effort="high"'));
  assert.throws(() => deepseekEndpoint({ ...relayEndpoint, proReasoning: 'max' }));
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

const relayEndpoint = { baseUrl: 'https://relay.example/v1/', wireApi: 'chat' as const, proModel: 'pro', flashModel: 'flash', offPeakOnly: false };
const jsonResponse = (models: string[]) => new Response(JSON.stringify({ data: models.map(id => ({ id })) }), { status: 200, headers: { 'content-type': 'application/json' } });
async function saveRelayKey(key = 'relay-saved-key-1') {
  await mkdir(deepseekHome(), { recursive: true });
  await writeFile(join(deepseekHome(), 'auth.json'), JSON.stringify({ OPENAI_API_KEY: key }));
}
const readCatalogFile = async () => {
  const dir = join(deepseekHome(), 'model-catalog');
  const names = await readdir(dir);
  const raw = await readFile(join(dir, names.find(n => n.endsWith('.json'))!), 'utf8');
  return raw;
};

test('模型目录：成功持久化跨读取一致，失败保留成功目录并标陈旧', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await saveRelayKey();
  const models = await refreshDeepseekCatalog(relayEndpoint, '', async () => jsonResponse(['relay-a', 'relay-b']));
  assert.deepEqual(models, ['relay-a', 'relay-b']);
  const catalog = await readDeepseekCatalog(relayEndpoint);
  assert.ok(catalog);
  assert.deepEqual(catalog.models, ['relay-a', 'relay-b']);
  assert.equal(catalog.stale, false);
  assert.equal(catalog.failure, null);
  assert.equal(catalog.accountVerified, true, '用已保存密钥查的才是权威目录');
  assert.ok(Math.abs(Date.now() - Date.parse(catalog.fetchedAt)) < 60_000, 'fetchedAt 是这次成功的更新时间');
  // 再次读取：同一份列表和同一个更新时间。
  assert.deepEqual(await readDeepseekCatalog(relayEndpoint), catalog);
  // 刷新失败：保留上次成功的列表和时间，标陈旧并记下原因。
  await assert.rejects(refreshDeepseekCatalog(relayEndpoint, '', async () => new Response('bad', { status: 500 })), /HTTP 500/);
  const stale = await readDeepseekCatalog(relayEndpoint);
  assert.ok(stale);
  assert.deepEqual(stale.models, ['relay-a', 'relay-b'], '失败不清掉上次成功的列表');
  assert.equal(stale.fetchedAt, catalog.fetchedAt, '失败不改成功时间');
  assert.equal(stale.stale, true);
  assert.equal(stale.failureCode, 'http_500', '落盘只用稳定码');
  assert.equal(stale.failure, '中转站拒绝了这次查询，请检查地址、协议和密钥。', '落盘只是固定中文摘要');
  assert.ok(!(stale.failure ?? '').includes('bad'), '不落原始响应');
});

test('模型目录按连接隔离：地址或协议不同不复用', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await saveRelayKey();
  await refreshDeepseekCatalog(relayEndpoint, '', async () => jsonResponse(['relay-a']));
  assert.deepEqual((await readDeepseekCatalog(relayEndpoint))?.models, ['relay-a']);
  assert.equal(await readDeepseekCatalog({ ...relayEndpoint, baseUrl: 'https://other.example/v1/' }), null, '地址不同');
  assert.equal(await readDeepseekCatalog({ ...relayEndpoint, wireApi: 'responses' }), null, '协议不同');
  assert.equal(await readDeepseekCatalog({ ...relayEndpoint, proModel: 'other-pro' }) !== null, true, '同地址同协议共用一份');
});

test('模型目录：临时密钥的结果标注未核验，不覆盖已保存连接的权威目录', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  // 没有已保存密钥：临时密钥查出来的可以留存，但标注账户身份未核验。
  const models = await refreshDeepseekCatalog(relayEndpoint, 'relay-fresh-key-9', async () => jsonResponse(['fresh-model']));
  assert.deepEqual(models, ['fresh-model']);
  const tentative = await readDeepseekCatalog(relayEndpoint);
  assert.equal(tentative?.accountVerified, false);
  assert.deepEqual(tentative?.models, ['fresh-model']);
  // 已保存密钥查过之后是权威目录：临时密钥的新结果不得覆盖。
  await saveRelayKey();
  await refreshDeepseekCatalog(relayEndpoint, '', async () => jsonResponse(['saved-model']));
  await refreshDeepseekCatalog(relayEndpoint, 'relay-fresh-key-9', async () => jsonResponse(['fresh-again']));
  const catalog = await readDeepseekCatalog(relayEndpoint);
  assert.equal(catalog?.accountVerified, true);
  assert.deepEqual(catalog?.models, ['saved-model'], '临时密钥结果没有覆盖权威目录');
});

test('模型目录并发保护：早发的请求晚回来不覆盖新结果，旧请求失败不标陈旧，文件始终是完整 JSON', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await saveRelayKey();
  const gate = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
  // 早发慢成功、晚发快成功：目录保留晚发的结果。
  const slow = gate<Response>();
  const early = refreshDeepseekCatalog(relayEndpoint, '', () => slow.promise);
  const late = await refreshDeepseekCatalog(relayEndpoint, '', async () => jsonResponse(['late-model']));
  assert.deepEqual(late, ['late-model']);
  slow.resolve(jsonResponse(['early-model']));
  assert.deepEqual(await early, ['early-model'], '早发的查询照常返回自己的结果给调用方');
  assert.deepEqual((await readDeepseekCatalog(relayEndpoint))?.models, ['late-model'], '早发晚回不覆盖');
  // 早发慢失败、晚发快成功：旧请求的失败不把新成功标陈旧。
  let rejectOld!: (error: Error) => void;
  const old = refreshDeepseekCatalog(relayEndpoint, '', () => new Promise<Response>((_resolve, reject) => { rejectOld = reject; }));
  const attached = assert.rejects(old, /网络错误/);
  await refreshDeepseekCatalog(relayEndpoint, '', async () => jsonResponse(['newest-model']));
  rejectOld(new Error('网络错误'));
  await attached;
  const catalog = await readDeepseekCatalog(relayEndpoint);
  assert.deepEqual(catalog?.models, ['newest-model']);
  assert.equal(catalog?.stale, false, '旧请求的失败不标陈旧');
  // 落盘的是完整 JSON，且不含密钥或认证头。
  const raw = await readCatalogFile();
  assert.ok(JSON.parse(raw));
  assert.ok(!raw.includes('relay-saved-key-1') && !raw.includes('Bearer'), '目录不含密钥或认证头');
});

test('模型目录：临时密钥失败不动已保存连接的权威目录，错误里的认证内容一个字都不落盘', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await saveRelayKey();
  await refreshDeepseekCatalog(relayEndpoint, '', async () => jsonResponse(['relay-a']));
  const before = await readDeepseekCatalog(relayEndpoint);
  assert.ok(before);
  const secret = 'relay-fresh-key-9';
  const leak = new Error(`查询失败 Authorization: Bearer ${secret} https://user:${secret}@relay.example/v1/models`);
  await assert.rejects(refreshDeepseekCatalog(relayEndpoint, secret, async () => { throw leak; }), /查询失败/);
  assert.deepEqual(await readDeepseekCatalog(relayEndpoint), before, '临时密钥的失败不改权威目录的 stale/failure/序号');
  const raw = await readCatalogFile();
  assert.ok(!raw.includes(secret) && !raw.includes('Bearer') && !raw.includes('Authorization'), '缓存不含原始认证信息');
  assert.ok(!raw.includes('查询失败'), '缓存不含原始异常原文');
});

test('模型目录：失败也占请求号，早发的成功不会抹掉较新的失败；请求号落盘只增不减', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await saveRelayKey();
  await refreshDeepseekCatalog(relayEndpoint, '', async () => jsonResponse(['base-model']));
  const base = await readDeepseekCatalog(relayEndpoint);
  assert.ok(base);
  const gate = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
  // 早发慢成功、晚发快失败：晚发的失败写陈旧，早发的成功回来不许把它改回“新鲜”。
  const slow = gate<Response>();
  const early = refreshDeepseekCatalog(relayEndpoint, '', () => slow.promise);
  await assert.rejects(refreshDeepseekCatalog(relayEndpoint, '', async () => new Response('down', { status: 503 })), /HTTP 503/);
  const failed = await readDeepseekCatalog(relayEndpoint);
  assert.equal(failed?.stale, true);
  assert.equal(failed?.failureCode, 'http_503');
  assert.equal(failed?.failure, '中转站拒绝了这次查询，请检查地址、协议和密钥。');
  assert.ok((failed?.sequence ?? 0) > base.sequence, '失败也推进请求号');
  slow.resolve(jsonResponse(['early-model']));
  assert.deepEqual(await early, ['early-model'], '查询本身照常把结果返回调用方');
  const after = await readDeepseekCatalog(relayEndpoint);
  assert.deepEqual(after?.models, ['base-model'], '早发的成功没有覆盖较新的失败');
  assert.equal(after?.stale, true, '较新的失败仍然有效');
  assert.equal(after?.fetchedAt, base.fetchedAt, '保留最后成功的列表和时间');
  assert.equal(after?.sequence, failed?.sequence, '早发的成功不推进请求号');
  // 反向：晚发的成功照常刷新；早发的失败回来不许把新成功标陈旧。
  let rejectOld!: (error: Error) => void;
  const old = refreshDeepseekCatalog(relayEndpoint, '', () => new Promise<Response>((_resolve, reject) => { rejectOld = reject; }));
  const attached = assert.rejects(old, /network down/);
  await refreshDeepseekCatalog(relayEndpoint, '', async () => jsonResponse(['fresh-model']));
  rejectOld(new Error('network down'));
  await attached;
  const fresh = await readDeepseekCatalog(relayEndpoint);
  assert.deepEqual(fresh?.models, ['fresh-model']);
  assert.equal(fresh?.stale, false, '早发的失败不标陈旧');
  // 请求号落盘：下一次取号必须大于手工写下的号（跨进程也只增不减，不会撞号）。
  const seqFile = join(deepseekHome(), 'model-catalog', 'sequence');
  const last = Number((await readFile(seqFile, 'utf8')).trim());
  assert.ok(Number.isFinite(last) && last > 0, '请求号已经落盘');
  await writeFile(seqFile, `${last + 1000}\n`);
  await refreshDeepseekCatalog(relayEndpoint, '', async () => jsonResponse(['ahead-model']));
  const ahead = await readDeepseekCatalog(relayEndpoint);
  assert.ok((ahead?.sequence ?? 0) > last + 1000, '落盘的号是权威，跨进程不会撞号');
  assert.ok(JSON.parse(await readCatalogFile()), '文件仍是完整 JSON');
});
