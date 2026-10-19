import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, fixture, root } from './helpers.ts';
import { classifyKimiProvider, KimiCustomProvider, kimiUsageComplete, parseKimiUsage, queryKimiQuota } from '../src/core/kimi-quota.ts';
import { checkQuota, ensureQuota, queryQuota, quotaBar, readQuotaCache } from '../src/core/quota.ts';
import { quotaUsed, stats } from '../src/core/stats.ts';
import type { Job } from '../src/core/job.ts';
import { ensureHome } from '../src/core/paths.ts';

const fixtures = join(root, 'test/fixtures/quota');
const sample = (name: string) => readFile(join(fixtures, name), 'utf8');
const at = '2026-09-29T04:00:00.000Z';
// 和 quota.test.ts 同款：登记处和替身环境放进临时目录，不碰真实的 ~/.xagents 和选手登录。
async function local(t: Parameters<typeof context>[0]) {
  const c = await context(t, false);
  const old = process.env.XAGENTS_HOME; process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (old === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = old; });
  for (const [key, value] of Object.entries({ XAGENTS_FAKE_WORKER: fixture, CODEX_HOME: join(c.temp, 'codex-config') })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  await ensureHome(); return c;
}

test('解析真实形状的面板：5 小时 + 月度两个窗口，倒计时换算成绝对重置，会话和上下文不进窗口条', async () => {
  const entry = parseKimiUsage(await sample('kimi-usage.txt'), at);
  assert.equal(entry.name, 'Kimi Code'); assert.equal(entry.icon, 'kimi'); assert.equal(entry.plan, null);
  assert.equal(entry.at, at);
  assert.deepEqual(entry.bars, [
    { label: '5 小时额度', used: 49, reset: '2026-09-29T08:12:00.000Z', windowMinutes: 300 },
    { label: '月度额度', used: 2, reset: '2026-10-30T03:12:00.000Z' },
  ]);
  // 分类小字 “kimi 1% · code 4%” 不是窗口行。
  assert.equal(entry.bars.length, 2);
  assert.equal(entry.extraUsage, undefined); // 没有 Extra Usage 段落就不编元数据
});

test('只有 5 小时窗口、只有月度窗口都不补造；周窗口按实际出现才解析', () => {
  const panel = (rows: string) => `╭ Usage ───╮\n│ Plan usage\n${rows}\n╰───╯`;
  const only5h = parseKimiUsage(panel('│   5h limit  ██████  80% used  resets in 1h 5m'), at);
  assert.deepEqual(only5h.bars.map(b => [b.label, b.used]), [['5 小时额度', 80]]);
  const onlyMonthly = parseKimiUsage(panel('│   Monthly limit  ██████  60% used'), at);
  assert.deepEqual(onlyMonthly.bars.map(b => [b.label, b.used, b.reset]), [['月度额度', 60, null]]);
  const withWeek = parseKimiUsage(panel('│   Weekly limit  ██████  33% used  resets in 3d 2h'), at);
  assert.deepEqual(withWeek.bars.map(b => [b.label, b.used, b.windowMinutes]), [['周额度', 33, 10080]]);
  const unknown = parseKimiUsage(panel('│   Yearly limit  ██████  7% used'), at);
  assert.deepEqual(unknown.bars.map(b => [b.label, b.windowMinutes]), [['yearly 额度', undefined]]);
});

test('半屏和不认识的界面都拒绝：完整面板要标题和收尾边框同时在', async () => {
  const full = await sample('kimi-usage.txt');
  assert.equal(kimiUsageComplete(full), true);
  const half = full.slice(0, full.indexOf('╰'));
  assert.equal(kimiUsageComplete(half), false);
  assert.throws(() => parseKimiUsage(half, at), /界面可能改了/);
  assert.throws(() => parseKimiUsage('别的输出', at), /界面可能改了/);
});

test('Extra Usage 段落：启用/未启用、零余额和未知分开，缺字段不猜', () => {
  const panel = (rows: string) => `╭ Usage ───╮\n│ Plan usage\n│   5h limit  ██  10% used\n${rows}\n╰───╯`;
  const on = parseKimiUsage(panel('│ Extra Usage\n│   Enabled    Balance ¥12.50    Monthly limit ¥100    Spent ¥3.25'), at);
  assert.deepEqual(on.extraUsage, { enabled: true, spent: 3.25, monthlyLimit: 100, balance: 12.5, currency: '¥' });
  const off = parseKimiUsage(panel('│ Extra Usage\n│   Status: disabled'), at);
  assert.deepEqual(off.extraUsage, { enabled: false, spent: null, monthlyLimit: null, balance: null, currency: null });
  const zero = parseKimiUsage(panel('│ Extra Usage\n│   Enabled    Balance $0.00'), at);
  assert.equal(zero.extraUsage!.balance, 0); // 零是零，不是未知
  assert.equal(zero.extraUsage!.currency, '$');
  const vague = parseKimiUsage(panel('│ Extra Usage\n│   暂无数据'), at);
  assert.deepEqual(vague.extraUsage, { enabled: null, spent: null, monthlyLimit: null, balance: null, currency: null });
});

test('provider list 分辨官方登录与自定义接口：managed + 官方主机才算官方，带 key 或中转站拒绝', () => {
  const official = JSON.stringify({
    providers: { 'managed:kimi-code': { baseUrl: 'https://api.kimi.com/coding', oauth: { accountId: 'x' } } },
    models: { 'kimi-code/kimi-for-coding': { provider: 'managed:kimi-code' } },
  });
  assert.doesNotThrow(() => classifyKimiProvider(official, 'kimi-code/kimi-for-coding'));
  const byHost = JSON.stringify({
    providers: { 'kimi-code': { baseUrl: 'https://api.moonshot.cn/coding', oauth: { accountId: 'x' } } },
    models: { 'kimi-code/kimi-for-coding': { provider: 'kimi-code' } },
  });
  assert.doesNotThrow(() => classifyKimiProvider(byHost, 'kimi-code/kimi-for-coding'));
  const oddHost = JSON.stringify({
    providers: { 'managed:kimi-code': { baseUrl: 'https://proxy.example.invalid', oauth: { accountId: 'x' } } },
    models: { 'kimi-code/kimi-for-coding': { provider: 'managed:kimi-code' } },
  });
  assert.throws(() => classifyKimiProvider(oddHost, 'kimi-code/kimi-for-coding'), KimiCustomProvider); // 登录方式像官方但主机不是官方域名
  const relay = JSON.stringify({
    providers: { test: { baseUrl: 'https://relay.example.invalid/v1' } },
    models: { 'kimi-code/kimi-for-coding': { provider: 'test' } },
  });
  assert.throws(() => classifyKimiProvider(relay, 'kimi-code/kimi-for-coding'), KimiCustomProvider);
  const keyed = JSON.stringify({
    providers: { 'managed:kimi-code': { baseUrl: 'https://api.kimi.com/coding', oauth: { accountId: 'x' }, apiKey: 'sk-anything' } },
    models: { 'kimi-code/kimi-for-coding': { provider: 'managed:kimi-code' } },
  });
  assert.throws(() => classifyKimiProvider(keyed, 'kimi-code/kimi-for-coding'), KimiCustomProvider);
  assert.throws(() => classifyKimiProvider('不是 JSON', 'kimi-code/kimi-for-coding'), /认不出 provider 名单/);
  assert.throws(() => classifyKimiProvider(official, '别的模型'), /认不出 provider 名单/);
});

test('queryKimiQuota：先结构化入口再交互 /usage，命令形状、按键序列、临时目录自包含且用完即删', async t => {
  const c = await local(t);
  const commands: { file: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv; writes?: { afterMs: number; text: string }[] }[] = [];
  const execute = async (cmd: { file: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv; writes?: { afterMs: number; text: string }[]; complete?: (o: string) => boolean }) => {
    commands.push(cmd);
    if (cmd.args[0] === 'provider') { assert.deepEqual(cmd.args.slice(1), ['list', '--json']); return sample('kimi-providers.json'); }
    assert.equal(cmd.file, 'python3');
    assert.ok(cmd.args[0].endsWith('pty-bridge.py'));
    assert.deepEqual(cmd.args.slice(1, 3), ['60', '140']);
    assert.equal(cmd.args.at(-2), '--model'); assert.equal(cmd.args.at(-1), 'kimi-code/kimi-for-coding');
    const state = cmd.env!.KIMI_CODE_HOME!;
    assert.equal(cmd.env!.KIMI_DISABLE_TELEMETRY, '1'); assert.equal(cmd.env!.CHOKIDAR_USEPOLLING, '1');
    assert.deepEqual(cmd.args[cmd.args.indexOf('--skills-dir') + 1], join(state, 'skills'));
    assert.equal(cmd.cwd, join(state, '..', 'work'));
    // 替身测试不复制真实登录文件，但 home 指向的空目录不会出错；state 目录自包含在缓存下的临时目录里。
    assert.ok(state.startsWith(join(c.home, 'cache', 'kimi-usage-')), `state 应建在缓存下的临时目录：${state}`);
    const texts = cmd.writes!.map(w => w.text);
    assert.deepEqual(texts.slice(-3), ['/usage\r', '/usage\r', '/usage\r']); // 前面是应答信任/迁移向导的盲按键
    assert.equal(cmd.writes!.length, 7);
    return sample('kimi-usage.txt');
  };
  const entry = await queryKimiQuota({ execute, at, home: join(c.temp, 'user-home') });
  assert.equal(entry.bars[0].used, 49);
  assert.equal(commands.length, 2);
  assert.deepEqual(await readdir(join(c.home, 'cache')), []); // 临时目录删干净，没留 state
});

test('queryKimiQuota：stateSource 的登录文件复制进临时目录，credentials 目录也复制', async t => {
  const c = await local(t);
  const source = join(c.temp, 'source-state'); await mkdir(join(source, 'credentials'), { recursive: true });
  await writeFile(join(source, 'config.toml'), 'fixture = true'); await writeFile(join(source, 'credentials', 'kimi-code.json'), '{}');
  let saw: string | undefined;
  const execute = async (cmd: { file: string; args: string[]; env?: NodeJS.ProcessEnv }) => {
    if (cmd.args[0] === 'provider') return sample('kimi-providers.json');
    saw = cmd.env!.KIMI_CODE_HOME!;
    assert.equal(await readFile(join(saw, 'config.toml'), 'utf8'), 'fixture = true');
    assert.equal(await readFile(join(saw, 'credentials', 'kimi-code.json'), 'utf8'), '{}');
    return sample('kimi-usage.txt');
  };
  const entry = await queryKimiQuota({ execute, at, stateSource: source });
  assert.equal(entry.bars.length, 2);
  assert.ok(saw);
});

test('多窗口派发检查：Kimi 任一到线都拒，错误写窗口名；force 放行；加油包余额不作额度', async () => {
  const kimi = parseKimiUsage(await sample('kimi-usage.txt'), at);
  const snapshot = { queriedAt: at, providers: [kimi] };
  assert.doesNotThrow(() => checkQuota(snapshot, [{ who: 'kimi' }], false, 50));
  assert.equal(quotaBar(snapshot, 'kimi')?.label, '5 小时额度');
  const monthlyHigh = structuredClone(snapshot); monthlyHigh.providers[0].bars[1].used = 60;
  assert.throws(() => checkQuota(monthlyHigh, [{ who: 'kimi' }], false, 50), /月度额度/);
  const fiveHigh = structuredClone(snapshot); fiveHigh.providers[0].bars[0].used = 80;
  assert.throws(() => checkQuota(fiveHigh, [{ who: 'kimi' }], false, 50), /5 小时额度/);
  assert.doesNotThrow(() => checkQuota(fiveHigh, [{ who: 'kimi' }], true, 50));
  // 有加油包余额也不放行套餐窗口；反过来窗口没线也不因为余额拦。
  const withExtra = structuredClone(fiveHigh);
  withExtra.providers[0].extraUsage = { enabled: true, spent: 0, monthlyLimit: 100, balance: 100, currency: '¥' };
  assert.throws(() => checkQuota(withExtra, [{ who: 'kimi' }], false, 50), /5 小时额度/);
  const unknown = structuredClone(snapshot); unknown.providers[0].bars[0].used = null;
  assert.doesNotThrow(() => checkQuota(unknown, [{ who: 'kimi' }], false, 50));
  // 5 小时缺失时退回第一个有数据的窗口做消耗统计。
  const onlyMonthly = structuredClone(snapshot); onlyMonthly.providers[0].bars = onlyMonthly.providers[0].bars.slice(1);
  assert.equal(quotaBar(onlyMonthly, 'kimi')?.label, '月度额度');
});

test('查询失败保留上次成功数据及原时间；自定义接口写明原因、不查官方套餐', async t => {
  const c = await local(t);
  const onlyKimi = { found: async (icon: string) => icon === 'kimi' };
  const good = async (cmd: { file: string; args: string[] }) => cmd.args[0] === 'provider' ? sample('kimi-providers.json') : sample('kimi-usage.txt');
  const first = await queryQuota({ windows: false, ...onlyKimi, now: new Date(at), execute: good });
  assert.equal(first.providers.length, 1); assert.equal(first.providers[0].error, undefined);
  assert.deepEqual(await readQuotaCache(), first);
  const relay = JSON.stringify({
    providers: { test: { baseUrl: 'https://relay.example.invalid/v1', apiKey: 'sk-x' } },
    models: { 'kimi-code/kimi-for-coding': { provider: 'test' } },
  });
  const later = new Date(Date.parse(at) + 3_600_000);
  const second = await queryQuota({ windows: false, ...onlyKimi, now: later, execute: async cmd => cmd.args[0] === 'provider' ? relay : sample('kimi-usage.txt') });
  const entry = second.providers[0];
  assert.equal(entry.error, '接的是自定义接口，不查官方套餐');
  assert.equal(entry.at, null); // 中转切换不能冒充旧官方账户。
  assert.ok(entry.bars.every(b => b.used === null));
  const broken = await queryQuota({ windows: false, ...onlyKimi, now: later, execute: async () => { throw new Error('网络不通'); } });
  assert.equal(broken.providers[0].error, '本次未能查询 Kimi 套餐，请稍后刷新。'); assert.equal(broken.providers[0].at, null);
  assert.ok(broken.providers[0].bars.every(b => b.used === null));
});

test('不设百分比停派线仍拒绝全部 Kimi 已耗尽窗口，不因加油包余额放行；force 保持既有语义', async () => {
  const entry = parseKimiUsage(await sample('kimi-usage.txt'), at);
  entry.extraUsage = { enabled: true, balance: 100, spent: 0, monthlyLimit: 200, currency: '$' };
  for (let i = 0; i < entry.bars.length; i++) {
    const copy = structuredClone(entry); copy.bars[i].used = 99;
    assert.doesNotThrow(() => checkQuota({ queriedAt: at, providers: [copy] }, [{ who: 'kimi' }], false, null));
    copy.bars[i].used = 100;
    assert.throws(() => checkQuota({ queriedAt: at, providers: [copy] }, [{ who: 'kimi' }], false, null), /已触顶/);
    assert.doesNotThrow(() => checkQuota({ queriedAt: at, providers: [copy] }, [{ who: 'kimi' }], true, null));
  }
  for (const used of [0, 100]) {
    const copy = { ...entry, error: '本次查询失败', bars: entry.bars.map(b => ({ ...b, used })) };
    assert.doesNotThrow(() => checkQuota({ queriedAt: at, providers: [copy] }, [{ who: 'kimi' }], false, 50));
    assert.equal(quotaBar({ queriedAt: at, providers: [copy] }, 'kimi'), undefined);
  }
});

test('金额字段不跨字段借数：缺值、无限、乱序、零与混合币种均保持真实语义', () => {
  const panel = (body: string) => `╭ Usage\n│ Plan usage\n│ 5h limit 49% used resets in 1h\n│ Extra Usage\n│ ${body}\n╰─────`;
  const extra = (text: string) => parseKimiUsage(panel(text), at).extraUsage!;
  assert.deepEqual(extra('Enabled Balance unknown Monthly limit $100 Spent $3'), { enabled: true, balance: null, monthlyLimit: 100, spent: 3, currency: '$' });
  assert.deepEqual(extra('Enabled Monthly limit unlimited Spent $3 Balance $0'), { enabled: true, balance: 0, monthlyLimit: null, spent: 3, currency: '$' });
  assert.deepEqual(extra('Disabled Spent ¥3 Balance $5 Monthly limit $100'), { enabled: false, balance: null, monthlyLimit: null, spent: null, currency: null });
  assert.equal(extra('Enabled Balance Monthly limit unknown Spent unknown').balance, null);
  assert.equal(extra('Enabled Balance 100 Monthly limit unknown Spent unknown').balance, null, '没有币种不能猜金额单位');
  assert.equal(extra('Enabled Balance $-10 Monthly limit infinity').balance, null);
  assert.equal(extra('Enabled Balance USD 0 Monthly limit USD 0').monthlyLimit, 0);
});

test('同账户查询失败只保留展示数据与原时间；账号/中转切换不得沿用旧数字，缓存内也复核来源', async t => {
  await local(t);
  const listed = { windows: false, found: async (icon: string) => icon === 'kimi' };
  const providers = await sample('kimi-providers.json');
  const first = await queryQuota({ ...listed, now: new Date(at), execute: async cmd => cmd.args[0] === 'provider' ? providers : sample('kimi-usage.txt') });
  const later = new Date(Date.parse(at) + 1000);
  const failure = await queryQuota({ ...listed, now: later, execute: async cmd => { if (cmd.args[0] === 'provider') return providers; throw new Error('sk-sensitive-token /private/secret'); } });
  assert.equal(failure.providers[0].at, first.providers[0].at); assert.deepEqual(failure.providers[0].bars, first.providers[0].bars);
  assert.ok(failure.providers[0].error); assert.doesNotMatch(JSON.stringify(failure), /sensitive-token|private\/secret/);
  assert.doesNotThrow(() => checkQuota(failure, [{ who: 'kimi' }], false, 1));
  const changed = providers.replace('fixture-user', 'another-user');
  const moved = await ensureQuota({ ...listed, now: later, execute: async cmd => { if (cmd.args[0] === 'provider') return changed; throw new Error('CLI failed'); } });
  assert.notEqual(moved.providers[0].source, first.providers[0].source); assert.ok(moved.providers[0].bars.every(b => b.used === null));
  const relay = JSON.stringify({ providers: { test: { baseUrl: 'https://relay.example.invalid/v1', apiKey: 'fixture' } }, models: { 'kimi-code/kimi-for-coding': { provider: 'test' } } });
  const custom = await ensureQuota({ ...listed, now: later, execute: async () => relay });
  assert.ok(custom.providers[0].bars.every(b => b.used === null)); assert.match(custom.providers[0].error!, /自定义接口/);
});

test('queryQuota 的真实规范快照直接流入 stats；不同窗口、来源、重置及失败数据不算百分点消耗', async t => {
  await local(t);
  const execute = async (cmd: { args: string[] }) => cmd.args[0] === 'provider' ? sample('kimi-providers.json') : sample('kimi-usage.txt');
  const a = await queryQuota({ windows: false, found: async icon => icon === 'kimi', now: new Date(at), execute });
  const b = structuredClone(a); b.providers[0].bars[0].used = 51;
  assert.equal(quotaUsed(a, 'kimi'), 49);
  const job = { who: 'kimi', state: 'done', kind: '实现', created: at, quota_before: a, quota_after: b } as Job;
  assert.equal(stats([job])[0].averageQuotaDelta, 2);
  for (const mutate of [
    (s: typeof b) => { s.providers[0].bars = [s.providers[0].bars[1]]; },
    (s: typeof b) => { s.providers[0].source = 'different-source'; },
    (s: typeof b) => { s.providers[0].bars[0].reset = '2027-01-01T00:00:00Z'; },
    (s: typeof b) => { s.providers[0].error = '这次查询失败'; },
  ]) { const copy = structuredClone(b); mutate(copy); assert.equal(stats([{ ...job, quota_after: copy }])[0].quotaSamples, 0); }
});
