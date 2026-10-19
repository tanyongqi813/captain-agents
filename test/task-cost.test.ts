import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildLedger, estimateUsage, readTaskLedger } from '../src/core/task-cost.ts';
import { checkCostSettings } from '../src/core/cost-settings.ts';
import type { Job, Usage } from '../src/core/job.ts';
import type { AutopilotRun } from '../src/core/autopilot.ts';
import { StreamParser } from '../src/core/activity.ts';
import { foldRounds } from '../src/core/wake.ts';
import { ensureHome } from '../src/core/paths.ts';
import { context } from './helpers.ts';

const at = '2026-10-19T00:00:00.000Z';
const rate = { read: 1_000_000, cached: 1_000_000, out: 1_000_000 };
const job = (extra: Record<string, unknown>): Job => ({
  id: 'job', batch: 'b', project: 'p', repo: '/repo', base: 'abc', worktree: '/repo/wt', branch: 'xa/job',
  who: 'codex', model: 'gpt-6-astra', effort: 'high', mode: 'workspace-write', kind: '实现', title: '题', summary: '说明',
  state: 'done', created: '2026-10-01T00:00:00.000Z', plan: { taskId: 'TASK-017', spec: 'docs/tasks/TASK-017.md' },
  ...extra,
}) as Job;
const round = (n: number, usage: Usage, ended: string) => ({ n, started: ended, ended, seconds: n, exit: 0, state: 'done', usage });

function priced(currency = 'USD') {
  const accounts = [
    ['acct-codex', 'codex', 'gpt-6-astra'],
    ['acct-grok', 'grok', 'grok-4.7'],
    ['acct-opus', 'cursor', 'claude-opus-5-5'],
    ['acct-cgrok', 'cursor', 'grok-4.7'],
  ] as const;
  return checkCostSettings({
    version: 1,
    accounts: accounts.map(([id, channel]) => ({ id, label: id, channel, kind: 'usage', source: 'manual' })),
    bindings: accounts.map(([account, channel, model]) => ({ account, channel, model, effectiveAt: '2026-01-01T00:00:00.000Z' })),
    prices: accounts.map(([account, , model], index) => ({
      id: `price-${index}`, account, model, currency, per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: '2026-01-01T00:00:00.000Z', ...rate,
    })),
    experiences: [{
      id: 'exp-ds', subject: '某类实现来回改几轮', basis: '另一类一次做完', factor: { numerator: 1, denominator: 3 },
      scope: '只作人工对照', recordedAt: '2026-10-01T00:00:00.000Z', validFrom: '2026-10-01T00:00:00.000Z', validUntil: '2026-11-01T00:00:00.000Z',
    }],
  });
}

const impl = job({
  id: 'impl', created: '2026-10-01T00:00:00.000Z', started: '2026-10-01T02:30:00.000Z', ended: '2026-10-01T03:00:00.000Z', seconds: 3, usage: { read: 20, cached: 0, out: 2 },
  rounds: [round(1, { read: 100, cached: 40, out: 10 }, '2026-10-01T01:00:00.000Z'), round(2, { read: 50, cached: 0, out: 5 }, '2026-10-01T02:00:00.000Z')],
});
const review = job({ id: 'review', who: 'cursor-opus', model: 'claude-opus-5-5', autopilotRole: 'reviewer', created: '2026-10-02T00:00:00.000Z', usage: { read: 30, cached: 10, cacheWrite: 0, out: 8 }, seconds: 4 });
const failed = job({ id: 'failed', who: 'grok', model: 'grok-4.7', state: 'failed', created: '2026-10-03T00:00:00.000Z', usage: { read: 10, cached: 0, out: 1 }, seconds: 5 });
const handed = job({ id: 'handed', who: 'cursor-grok', model: 'grok-4.7', created: '2026-10-04T00:00:00.000Z', usage: { read: 15, cached: 0, cacheWrite: 0, out: 3 }, seconds: 6 });
const run = {
  id: '1019-0000-auto', taskId: 'TASK-017',
  attempts: [{ token: 'same', node: 'n', attempt: 1, at, jobs: ['impl', 'failed'], usage: { read: 9_999, cached: 0, out: 9_999 } }],
  flow: { version: 1, reviewer: 'cursor-opus:high', accepted: at, reviews: [{ token: 'same', node: 'n', at, jobs: ['impl', 'review'], usage: { read: 9_999, cached: 0, out: 9_999 } }] },
  diagnoses: [{ token: 'same', node: 'n', attempt: 1, at, fingerprint: 'fp', jobs: ['impl'], usage: { read: 9_999, cached: 0, out: 9_999 } }],
} as AutopilotRun;

test('三轮实现、一次审查、失败后换人只各记一次；重读和跨角色引用不重复', () => {
  const settings = priced();
  const once = buildLedger({ taskId: 'TASK-017', jobs: [impl, review, failed, handed, impl], runs: [run], settings, now: at });
  const twice = buildLedger({ taskId: 'TASK-017', jobs: [handed, failed, review, impl], runs: [run, run], settings, now: at });
  assert.deepEqual(twice.lines.map(line => [line.id, line.phase, line.estimate?.amount]), once.lines.map(line => [line.id, line.phase, line.estimate?.amount]));
  assert.deepEqual(once.lines.map(line => line.phase), ['implement', 'implement', 'implement', 'review', 'implement', 'handoff']);
  assert.equal(once.lines.filter(line => line.jobId === 'impl').length, 3);
  assert.equal(once.lines.find(line => line.jobId === 'failed')?.state, 'failed');
  assert.equal(once.spent[0]?.knownSubtotal, 254);
  assert.equal(once.spent[0]?.complete, true);
  assert.equal(once.coverage, 'complete');
  assert.equal(once.lines.some(line => line.estimate?.amount === 9_999), false);
  assert.ok(once.seconds.known > 0);
  assert.equal(once.spent[0]?.knownSubtotal, 254);
});

test('同一个人失败后再做仍算实现', () => {
  const first = job({ id: 'first', state: 'failed', created: '2026-10-03T00:00:00.000Z', usage: { read: 1, cached: 0, out: 1 } });
  const retry = job({ id: 'retry', created: '2026-10-05T00:00:00.000Z', usage: { read: 1, cached: 0, out: 1 } });
  const ledger = buildLedger({ taskId: 'TASK-017', jobs: [first, retry], settings: priced(), now: at });
  assert.equal(ledger.lines.every(line => line.phase === 'implement'), true);
});

test('缓存语义不明、缺用量、过期价格、跨币种和跨套餐都留下未知项', () => {
  const partial = checkCostSettings({
    ...priced(),
    prices: [{ id: 'partial', account: 'acct-codex', model: 'gpt-6-astra', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: '2026-01-01T00:00:00.000Z', read: 1_000_000, out: 1_000_000 }],
  });
  const cached = buildLedger({ taskId: 'TASK-017', jobs: [job({ id: 'cache', usage: { read: 100, cached: 40, out: 10 } })], settings: partial, now: at });
  assert.equal(cached.lines[0]?.knownSubtotal?.amount, 70);
  assert.equal(cached.lines[0]?.estimate, null);
  assert.match(cached.lines[0]?.unknown.join('\n') ?? '', /缓存价格不明/);
  assert.equal(cached.spent[0]?.complete, false);

  const missing = buildLedger({ taskId: 'TASK-017', jobs: [job({ id: 'none', usage: undefined, state: 'stopped' })], settings: priced(), now: at });
  assert.equal(missing.lines[0]?.estimate, null);
  assert.equal(missing.lines[0]?.actual, null);
  assert.deepEqual(missing.lines[0]?.experienceIds, ['exp-ds']);
  assert.equal(missing.experiences[0]?.amount, null);
  assert.equal(missing.experiences[0]?.factor.denominator, 3);
  assert.match(missing.gaps.join('\n'), /缺用量/);

  const expired = checkCostSettings({
    ...priced(),
    prices: [
      { id: 'old', account: 'acct-codex', model: 'gpt-6-astra', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-02-01T00:00:00.000Z', recordedAt: '2026-01-01T00:00:00.000Z', ...rate },
      { id: 'later', account: 'acct-codex', model: 'gpt-6-astra', currency: 'USD', per: 'million', effectiveAt: '2026-10-20T00:00:00.000Z', recordedAt: '2026-10-20T00:00:00.000Z', read: 2_000_000, cached: 2_000_000, out: 2_000_000 },
    ],
  });
  const early = buildLedger({ taskId: 'TASK-017', jobs: [job({ id: 'early', created: '2026-03-01T00:00:00.000Z', ended: '2026-03-01T00:00:00.000Z', usage: { read: 4, cached: 0, out: 1 } })], settings: expired, now: at });
  assert.equal(early.lines[0]?.estimate, null);
  assert.match(early.lines[0]?.unknown.join('\n') ?? '', /价格不适用或已过期/);
  const after = buildLedger({ taskId: 'TASK-017', jobs: [job({ id: 'after', created: '2026-10-21T00:00:00.000Z', ended: '2026-10-21T00:00:00.000Z', usage: { read: 4, cached: 0, out: 1 } })], settings: expired, now: '2026-10-22T00:00:00.000Z' });
  assert.equal(after.lines[0]?.estimate?.amount, 10);
  assert.equal(after.lines[0]?.estimate?.priceId, 'later');

  const yuan = checkCostSettings({
    ...priced('CNY'),
    accounts: [priced().accounts[0]!, ...priced('CNY').accounts.slice(1)],
    prices: [priced().prices[0]!, ...priced('CNY').prices.slice(1)],
  });
  const mixed = buildLedger({ taskId: 'TASK-017', jobs: [impl, review], settings: yuan, now: at });
  assert.deepEqual(mixed.spent.map(item => item.currency).sort(), ['CNY', 'USD']);
  assert.equal(mixed.spent.every(item => item.complete === false), true);
  assert.match(mixed.gaps.join('\n'), /币种不同/);
  assert.equal('total' in mixed, false);

  const subscription = checkCostSettings({
    version: 1,
    accounts: [
      { id: 'acct-kimi', label: '官方套餐', channel: 'kimi', kind: 'subscription', source: 'official', windows: [{ label: '5 小时', recordedAt: at, usedPercent: 40 }] },
      { id: 'acct-relay', label: '中转', channel: 'deepseek', kind: 'usage', source: 'relay' },
    ],
    bindings: [
      { account: 'acct-kimi', channel: 'kimi', model: 'kimi-code/kimi-for-coding', effectiveAt: '2026-01-01T00:00:00.000Z' },
      { account: 'acct-relay', channel: 'deepseek', model: 'deepseek-v4-pro', effectiveAt: '2026-01-01T00:00:00.000Z' },
    ],
    prices: [{ id: 'relay', account: 'acct-relay', model: 'deepseek-v4-pro', currency: 'CNY', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: at, ...rate }],
    experiences: [],
  });
  const split = buildLedger({
    taskId: 'TASK-017', now: at, settings: subscription,
    jobs: [
      job({ id: 'official', who: 'kimi', model: 'kimi-code/kimi-for-coding', usage: { read: 8, cached: 0, out: 1 } }),
      job({ id: 'relay', who: 'deepseek', model: 'deepseek-v4-pro', command: { file: 'codex', args: ['exec', '-m', 'deepseek-v4-pro'], env: {}, stdin: 'prompt', output: 'run.log' }, usage: { read: 2, cached: 0, out: 2 } }),
    ],
  });
  assert.match(split.lines.find(line => line.jobId === 'official')?.unknown.join('\n') ?? '', /订阅或套餐/);
  assert.equal(split.lines.find(line => line.jobId === 'official')?.estimate, null);
  assert.equal(split.lines.find(line => line.jobId === 'relay')?.estimate?.amount, 4);
  assert.equal(split.lines.find(line => line.jobId === 'relay')?.estimate?.currency, 'CNY');
});

test('已有账单不按新价格重算；共享快照不计成任务费用', () => {
  const billed = job({ id: 'billed', usage: { read: 100, cached: 0, out: 100 }, billed: { amount: 1.25, currency: 'USD' } });
  const before = buildLedger({ taskId: 'TASK-017', jobs: [billed], settings: priced(), now: at });
  const raised = checkCostSettings({ ...priced(), prices: priced().prices.map(price => ({ ...price, read: 9_000_000, cached: 9_000_000, out: 9_000_000 })) });
  const after = buildLedger({ taskId: 'TASK-017', jobs: [billed], settings: raised, now: at });
  assert.deepEqual(before.lines[0]?.actual, { amount: 1.25, currency: 'USD' });
  assert.equal(before.lines[0]?.estimate, null);
  assert.deepEqual(after.lines[0]?.actual, before.lines[0]?.actual);
  const watched = buildLedger({
    taskId: 'TASK-017', jobs: [impl], settings: priced(), now: at,
    observations: [{ account: 'acct-codex', at, beforePercent: 10, afterPercent: 30 }],
  });
  assert.equal(watched.observations[0]?.allocated, false);
  assert.equal(watched.spent[0]?.knownSubtotal, 187);
  assert.equal(watched.spent[0]?.complete, false);
  assert.match(watched.gaps.join('\n'), /共享观察值/);
  const alone = buildLedger({ taskId: 'TASK-017', jobs: [impl], settings: priced(), now: at });
  assert.equal(alone.spent[0]?.knownSubtotal, watched.spent[0]?.knownSubtotal);
});

test('旧记录、取消和失败都能读；外部费用未知时不宣称完整', async t => {
  const c = await context(t, false), previous = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (previous === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = previous; });
  await ensureHome();
  await mkdir(join(c.home, 'projects'), { recursive: true });
  await writeFile(join(c.home, 'projects', 'alpha.json'), JSON.stringify({ repo: '/repos/alpha', worktreeRoot: '.worktrees' }));
  await writeFile(join(c.home, 'projects', 'beta.json'), JSON.stringify({ repo: '/repos/beta', worktreeRoot: '.worktrees' }));
  const stopped = job({ id: 'old-stopped', project: 'alpha', repo: '/repos/alpha', state: 'stopped', usage: undefined, seconds: undefined });
  const broken = job({ id: 'old-failed', project: 'alpha', repo: '/repos/alpha', state: 'failed', who: 'grok', model: 'grok-4.7', usage: { read: 3, cached: 1, out: 1 } });
  const other = job({ id: 'beta-job', project: 'beta', repo: '/repos/beta', usage: { read: 999, cached: 0, out: 1 } });
  for (const row of [stopped, broken, other]) {
    await mkdir(join(c.home, 'jobs', row.id), { recursive: true });
    await writeFile(join(c.home, 'jobs', row.id, 'job.json'), JSON.stringify(row));
  }
  const run = {
    id: '1019-1200-auto', version: 1, project: 'alpha', repo: '/repos/alpha', base: 'abc1234', taskId: 'TASK-017', spec: 'docs/tasks/TASK-017.md',
    state: 'stopped', who: ['codex:high'], network: false, ro: false, policy: { id: 'short', minutes: 60, attempts: 4, nodes: 3 },
    created: at, updated: at, ended: at, reason: '跨项目引用', elapsedSeconds: 0, sleeps: 0, attemptCount: 1, nodeCount: 1,
    nodes: [{ id: 'n', depth: 0, state: 'failed', attempts: 1, continues: 0, retries: 0 }],
    attempts: [{ node: 'n', attempt: 1, token: 'tok-beta', at, jobs: ['beta-job'], usage: { read: 40, cached: 0, out: 2 } }],
  };
  await mkdir(join(c.home, 'autopilots', run.id), { recursive: true });
  await writeFile(join(c.home, 'autopilots', run.id, 'run.json'), JSON.stringify(run));
  const ledger = await readTaskLedger('alpha', 'TASK-017', { now: at, untracked: ['lead'] });
  assert.equal(ledger.project?.name, 'alpha');
  assert.equal(ledger.project?.repo, '/repos/alpha');
  assert.equal(ledger.coverage, 'incomplete');
  assert.deepEqual(ledger.lines.map(line => line.jobId).filter(id => id.startsWith('old')).sort(), ['old-failed', 'old-stopped']);
  assert.equal(ledger.lines.some(line => line.jobId === 'beta-job'), false);
  assert.equal(ledger.lines.find(line => line.id === 'run/1019-1200-auto/tok-beta')?.usage?.fresh, 40);
  assert.equal(ledger.lines.find(line => line.id === 'run/1019-1200-auto/tok-beta')?.withheld, true);
  assert.equal(ledger.tokens?.known.fresh, 2);
  assert.match(ledger.gaps.join('\n'), /别的项目/);
  assert.match(ledger.gaps.join('\n'), /负责人调用没有纳入/);
  assert.match(ledger.gaps.join('\n'), /没有证明负责人在别处/);
  const beta = await readTaskLedger('beta', 'TASK-017', { now: at });
  assert.equal(beta.lines.length, 1);
  assert.equal(beta.lines[0]?.jobId, 'beta-job');
  assert.equal(beta.lines[0]?.usage?.fresh, 999);
  const empty = await readTaskLedger('alpha', 'TASK-018', { now: at, external: 'confirmed' });
  assert.equal(empty.coverage, 'incomplete');
  assert.match(empty.gaps.join('\n'), /不能当成零成本/);
  assert.equal(empty.spent.length, 0);
});

test('归档前后是同一轮，合计用量不会再算一遍', () => {
  const open = job({
    id: 'folded', state: 'done', started: '2026-10-01T00:00:00.000Z', ended: '2026-10-01T00:01:00.000Z', seconds: 60,
    usage: { read: 100, cached: 0, out: 10 }, billed: { amount: 1.25, currency: 'USD' },
  });
  const folded = structuredClone(open);
  foldRounds(folded);
  const before = buildLedger({ taskId: 'TASK-017', jobs: [open], settings: priced(), now: at });
  const after = buildLedger({ taskId: 'TASK-017', jobs: [folded], settings: priced(), now: at });
  assert.deepEqual(before.lines.map(line => line.id), ['job/folded/round/1']);
  assert.deepEqual(after.lines.map(line => line.id), before.lines.map(line => line.id));
  assert.equal(before.tokens?.known.fresh, 100);
  assert.equal(after.tokens?.known.fresh, 100);
  assert.equal(after.tokens?.known.out, 10);
  assert.equal(before.seconds.known, 60);
  assert.equal(after.seconds.known, 60);
  assert.deepEqual(after.lines[0]?.actual, { amount: 1.25, currency: 'USD' });
  const running = job({
    id: 'live', state: 'running', started: '2026-10-02T00:00:00.000Z', seconds: 60, usage: { read: 5, cached: 0, out: 1 },
    resume: { round: 2, prompt: 'prompt-r2.md' },
    rounds: [round(1, { read: 100, cached: 0, out: 10 }, '2026-10-01T01:00:00.000Z')],
  });
  const live = buildLedger({ taskId: 'TASK-017', jobs: [running], settings: priced(), now: at });
  assert.deepEqual(live.lines.map(line => line.id), ['job/live/round/1', 'job/live/round/2']);
  assert.equal(live.tokens?.known.fresh, 105);
  assert.equal(live.seconds.known, 1);
});

test('Cursor 解析出的缓存写入不和输入重复收费；对不上就保持未知', () => {
  const parser = new StreamParser('cursor-grok', '/repo');
  parser.feed(JSON.stringify({ type: 'result', usage: { inputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 30, outputTokens: 10 } }) + '\n');
  const usage = parser.result().usage!;
  assert.deepEqual(usage, { read: 100, cached: 20, cacheWrite: 30, out: 10 });
  const price = { id: 'cursor', account: 'acct', model: 'grok-4.7', currency: 'USD', per: 'million' as const, effectiveAt: at, recordedAt: at, read: 1_000_000, cached: 1_000_000, cacheWrite: 2_000_000, out: 1_000_000 };
  assert.equal(estimateUsage(usage, price).amount, 140);
  assert.deepEqual(estimateUsage(usage, price).unknown, []);
  assert.match(estimateUsage({ read: 100, cached: 80, cacheWrite: 30, out: 1 }, price).unknown.join('\n'), /对不上/);
});

test('按当时的启动模型和生效时间归账户，不套现在的名单或后来的绑定', () => {
  const settings = checkCostSettings({
    version: 1,
    accounts: [
      { id: 'acct-old', label: '旧账户', channel: 'deepseek', kind: 'usage', source: 'relay' },
      { id: 'acct-new', label: '新账户', channel: 'deepseek', kind: 'usage', source: 'relay' },
      { id: 'acct-luna', label: 'Luna', channel: 'codex', kind: 'usage', source: 'official' },
      { id: 'acct-astra', label: 'Astra', channel: 'codex', kind: 'usage', source: 'official' },
    ],
    bindings: [
      { account: 'acct-old', channel: 'deepseek', model: 'vendor-pro', effectiveAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z' },
      { account: 'acct-new', channel: 'deepseek', model: 'vendor-pro', effectiveAt: '2026-10-02T00:00:00.000Z' },
      { account: 'acct-luna', channel: 'codex', model: 'gpt-6-luna', effectiveAt: '2026-01-01T00:00:00.000Z' },
      { account: 'acct-astra', channel: 'codex', model: 'gpt-6-astra', effectiveAt: '2026-01-01T00:00:00.000Z' },
    ],
    prices: [
      { id: 'old-price', account: 'acct-old', model: 'vendor-pro', currency: 'CNY', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: at, ...rate },
      { id: 'zone-early', account: 'acct-new', model: 'vendor-pro', currency: 'CNY', per: 'million', effectiveAt: '2026-10-19T10:00:00+08:00', recordedAt: at, ...rate },
      { id: 'zone-later', account: 'acct-new', model: 'vendor-pro', currency: 'CNY', per: 'million', effectiveAt: '2026-10-19T03:00:00Z', recordedAt: at, read: 2_000_000, cached: 2_000_000, out: 2_000_000 },
      { id: 'luna', account: 'acct-luna', model: 'gpt-6-luna', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: at, ...rate },
    ],
    experiences: [],
  });
  const command = { file: 'codex', args: ['exec', '-m', 'vendor-pro'], env: {}, stdin: 'prompt' as const, output: 'run.log' as const };
  const first = job({ id: 'first-day', who: 'deepseek', model: 'deepseek-v4-pro', started: '2026-10-01T12:00:00.000Z', ended: '2026-10-01T12:00:00.000Z', command, usage: { read: 4, cached: 0, out: 1 } });
  const later = job({ id: 'later-day', who: 'deepseek', model: 'deepseek-v4-pro', started: '2026-10-19T04:00:00.000Z', ended: '2026-10-19T04:00:00.000Z', command, usage: { read: 4, cached: 0, out: 1 } });
  const blind = job({ id: 'blind', who: 'deepseek', model: 'deepseek-v4-pro', started: '2026-10-03T00:00:00.000Z', ended: '2026-10-03T00:00:00.000Z', usage: { read: 9, cached: 0, out: 1 } });
  const luna = job({ id: 'luna', who: 'codex-luna', model: 'gpt-6-luna', started: at, ended: at, usage: { read: 3, cached: 0, out: 1 } });
  const ledger = buildLedger({ taskId: 'TASK-017', jobs: [first, later, blind, luna], settings, now: '2026-10-20T00:00:00.000Z' });
  assert.equal(ledger.lines.find(line => line.jobId === 'first-day')?.account, 'acct-old');
  assert.equal(ledger.lines.find(line => line.jobId === 'first-day')?.estimate?.amount, 5);
  assert.equal(ledger.lines.find(line => line.jobId === 'later-day')?.account, 'acct-new');
  assert.equal(ledger.lines.find(line => line.jobId === 'later-day')?.estimate?.priceId, 'zone-later');
  assert.equal(ledger.lines.find(line => line.jobId === 'later-day')?.estimate?.amount, 10);
  assert.equal(ledger.lines.find(line => line.jobId === 'blind')?.estimate, null);
  assert.match(ledger.lines.find(line => line.jobId === 'blind')?.unknown.join('\n') ?? '', /启动模型/);
  assert.equal(ledger.lines.find(line => line.jobId === 'luna')?.account, 'acct-luna');
  assert.equal(ledger.lines.find(line => line.jobId === 'luna')?.estimate?.amount, 4);
});

test('引用缺了任务时留下用量；引用齐全时不重复计', () => {
  const present = job({ id: 'present', usage: { read: 5, cached: 0, out: 1 } });
  const partial = { id: '1019-1201-auto', attempts: [{ token: 'part', node: 'n', attempt: 1, at, jobs: ['present', 'gone'], usage: { read: 80, cached: 0, out: 1 } }], flow: undefined, diagnoses: [] } as unknown as AutopilotRun;
  const mixed = buildLedger({ taskId: 'TASK-017', jobs: [present], runs: [partial], settings: priced(), now: at });
  assert.equal(mixed.tokens?.known.fresh, 5);
  assert.equal(mixed.lines.find(line => line.id === 'run/1019-1201-auto/part')?.usage?.fresh, 80);
  assert.equal(mixed.lines.find(line => line.id === 'run/1019-1201-auto/part')?.withheld, true);
  assert.match(mixed.gaps.join('\n'), /找不到任务 gone/);
  const only = { id: '1019-1202-auto', attempts: [{ token: 'only', node: 'n', attempt: 1, at, jobs: ['gone'], usage: { read: 7, cached: 0, out: 1 } }] } as unknown as AutopilotRun;
  const lost = buildLedger({ taskId: 'TASK-017', jobs: [], runs: [only], settings: priced(), now: at });
  assert.equal(lost.coverage, 'incomplete');
  assert.equal(lost.lines[0]?.usage?.fresh, 7);
  assert.equal(lost.tokens?.known.fresh, 7);
  const bare = buildLedger({ taskId: 'TASK-017', jobs: [], settings: priced(), now: at });
  assert.equal(bare.coverage, 'incomplete');
  assert.match(bare.gaps.join('\n'), /不能当成零成本/);
});

test('跨过账户或价格切换时不按结束时刻整段估价', () => {
  const boundary = '2026-10-02T00:00:00.000Z';
  const settings = checkCostSettings({
    version: 1,
    accounts: [
      { id: 'old', label: '旧', channel: 'codex', kind: 'usage', source: 'official' },
      { id: 'new', label: '新', channel: 'codex', kind: 'usage', source: 'official' },
      { id: 'same', label: '同一账户', channel: 'grok', kind: 'usage', source: 'official' },
    ],
    bindings: [
      { account: 'old', channel: 'codex', model: 'gpt-6-astra', effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: boundary },
      { account: 'new', channel: 'codex', model: 'gpt-6-astra', effectiveAt: boundary },
      { account: 'same', channel: 'grok', model: 'grok-4.7', effectiveAt: '2026-01-01T00:00:00.000Z' },
    ],
    prices: [
      { id: 'old-rate', account: 'old', model: 'gpt-6-astra', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: boundary, recordedAt: at, ...rate },
      { id: 'new-rate', account: 'new', model: 'gpt-6-astra', currency: 'USD', per: 'million', effectiveAt: boundary, recordedAt: at, read: 2_100_000, cached: 2_100_000, out: 2_100_000 },
      { id: 'grok-early', account: 'same', model: 'grok-4.7', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: boundary, recordedAt: at, ...rate },
      { id: 'grok-later', account: 'same', model: 'grok-4.7', currency: 'USD', per: 'million', effectiveAt: boundary, recordedAt: at, read: 2_100_000, cached: 2_100_000, out: 2_100_000 },
    ],
    experiences: [],
  });
  const usage = { read: 100, cached: 0, out: 0 };
  const spanning = job({ id: 'span', started: '2026-10-01T23:59:00.000Z', ended: '2026-10-02T00:01:00.000Z', usage });
  const running = job({ id: 'span-run', state: 'running', started: '2026-10-01T23:59:00.000Z', usage });
  const endedLedger = buildLedger({ taskId: 'TASK-017', jobs: [spanning], settings, now: '2026-10-02T00:01:00.000Z' });
  const runningLedger = buildLedger({ taskId: 'TASK-017', jobs: [running], settings, now: '2026-10-02T00:01:00.000Z' });
  for (const ledger of [endedLedger, runningLedger]) {
    assert.equal(ledger.lines[0]?.account, 'old');
    assert.equal(ledger.lines[0]?.estimate, null);
    assert.equal(ledger.lines[0]?.knownSubtotal, null);
    assert.match(ledger.lines[0]?.unknown.join('\n') ?? '', /付款账户/);
  }
  const folded = structuredClone(spanning);
  foldRounds(folded);
  const after = buildLedger({ taskId: 'TASK-017', jobs: [folded], settings, now: '2026-10-02T00:01:00.000Z' });
  assert.equal(after.lines[0]?.id, 'job/span/round/1');
  assert.equal(after.lines[0]?.id, endedLedger.lines[0]?.id);
  assert.equal(after.lines[0]?.account, 'old');
  assert.equal(after.lines[0]?.estimate, null);
  const inside = buildLedger({
    taskId: 'TASK-017', settings, now: '2026-10-02T02:00:00.000Z',
    jobs: [
      job({ id: 'before', started: '2026-10-01T22:00:00.000Z', ended: '2026-10-01T23:00:00.000Z', usage }),
      job({ id: 'after-switch', started: '2026-10-02T00:30:00.000Z', ended: '2026-10-02T01:00:00.000Z', usage }),
    ],
  });
  assert.equal(inside.lines.find(line => line.jobId === 'before')?.account, 'old');
  assert.equal(inside.lines.find(line => line.jobId === 'before')?.estimate?.amount, 100);
  assert.equal(inside.lines.find(line => line.jobId === 'after-switch')?.account, 'new');
  assert.equal(inside.lines.find(line => line.jobId === 'after-switch')?.estimate?.amount, 210);
  const priceSpan = buildLedger({
    taskId: 'TASK-017', settings, now: '2026-10-02T00:01:00.000Z',
    jobs: [job({ id: 'price', who: 'grok', model: 'grok-4.7', started: '2026-10-01T23:59:00.000Z', ended: '2026-10-02T00:01:00.000Z', usage })],
  });
  assert.equal(priceSpan.lines[0]?.account, 'same');
  assert.equal(priceSpan.lines[0]?.estimate, null);
  assert.equal(priceSpan.lines[0]?.knownSubtotal, null);
  assert.match(priceSpan.lines[0]?.unknown.join('\n') ?? '', /价格/);
  const whileRunning = buildLedger({
    taskId: 'TASK-017', settings, now: '2026-10-01T23:00:00.000Z',
    jobs: [job({ id: 'live-price', who: 'grok', model: 'grok-4.7', state: 'running', started: '2026-10-01T22:00:00.000Z', usage })],
  });
  const afterEnd = buildLedger({
    taskId: 'TASK-017', settings, now: '2026-10-01T23:40:00.000Z',
    jobs: [job({ id: 'live-price', who: 'grok', model: 'grok-4.7', state: 'done', started: '2026-10-01T22:00:00.000Z', ended: '2026-10-01T23:30:00.000Z', usage })],
  });
  assert.equal(whileRunning.lines[0]?.estimate?.priceId, 'grok-early');
  assert.equal(whileRunning.lines[0]?.estimate?.amount, 100);
  assert.equal(afterEnd.lines[0]?.estimate?.priceId, 'grok-early');
  assert.equal(afterEnd.lines[0]?.estimate?.amount, 100);
});

test('缓存写入没上报时不能估出精确金额；不含这项的通道可以估价', () => {
  const missing = { read: 100, cached: 0, out: 10 };
  const direct = estimateUsage(missing, {
    id: 'c', account: 'acct', model: 'claude-opus-5-5', currency: 'USD', per: 'million', effectiveAt: at, recordedAt: at,
    read: 1_000_000, out: 1_000_000, cacheWrite: 2_000_000,
  });
  assert.equal(direct.priced, false);
  assert.notEqual(direct.amount, 110);
  assert.match(direct.unknown.join('\n'), /缓存写入/);
  const settings = checkCostSettings({
    version: 1,
    accounts: [
      { id: 'acct-cursor', label: 'Cursor', channel: 'cursor', kind: 'usage', source: 'manual' },
      { id: 'acct-codex', label: 'Codex', channel: 'codex', kind: 'usage', source: 'manual' },
      { id: 'acct-kimi', label: 'Kimi', channel: 'kimi', kind: 'usage', source: 'manual' },
    ],
    bindings: [
      { account: 'acct-cursor', channel: 'cursor', model: 'claude-opus-5-5', effectiveAt: '2026-01-01T00:00:00.000Z' },
      { account: 'acct-codex', channel: 'codex', model: 'gpt-6-astra', effectiveAt: '2026-01-01T00:00:00.000Z' },
      { account: 'acct-kimi', channel: 'kimi', model: 'kimi-code/kimi-for-coding', effectiveAt: '2026-01-01T00:00:00.000Z' },
    ],
    prices: [
      { id: 'cursor-price', account: 'acct-cursor', model: 'claude-opus-5-5', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: at, read: 1_000_000, cached: 1_000_000, cacheWrite: 2_000_000, out: 1_000_000 },
      { id: 'codex-price', account: 'acct-codex', model: 'gpt-6-astra', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: at, read: 1_000_000, cached: 1_000_000, cacheWrite: 2_000_000, out: 1_000_000 },
      { id: 'kimi-price', account: 'acct-kimi', model: 'kimi-code/kimi-for-coding', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: at, read: 1_000_000, cached: 1_000_000, cacheWrite: 2_000_000, out: 1_000_000 },
    ],
    experiences: [],
  });
  const ledger = buildLedger({
    taskId: 'TASK-017', settings, now: at,
    jobs: [
      job({ id: 'old-cursor', who: 'cursor-opus', model: 'claude-opus-5-5', started: at, ended: at, usage: missing }),
      job({ id: 'codex-known', started: at, ended: at, usage: missing }),
      job({ id: 'kimi-unknown', who: 'kimi', model: 'kimi-code/kimi-for-coding', started: at, ended: at, usage: missing }),
      job({ id: 'full-cursor', who: 'cursor-opus', model: 'claude-opus-5-5', started: at, ended: at, usage: { read: 100, cached: 20, cacheWrite: 30, out: 10 } }),
    ],
  });
  const oldLine = ledger.lines.find(line => line.jobId === 'old-cursor');
  assert.equal(oldLine?.estimate, null);
  assert.equal(oldLine?.knownSubtotal, null);
  assert.match(oldLine?.unknown.join('\n') ?? '', /缓存写入/);
  assert.equal(ledger.lines.find(line => line.jobId === 'codex-known')?.estimate?.amount, 110);
  assert.deepEqual(ledger.lines.find(line => line.jobId === 'codex-known')?.unknown, []);
  assert.equal(ledger.lines.find(line => line.jobId === 'kimi-unknown')?.estimate, null);
  assert.equal(ledger.lines.find(line => line.jobId === 'kimi-unknown')?.knownSubtotal, null);
  assert.equal(ledger.lines.find(line => line.jobId === 'full-cursor')?.estimate?.amount, 140);
});

test('没上报用量的续接轮仍留在账本里，时长不沿用上一轮', () => {
  const first = job({
    id: 'again', state: 'done', started: '2026-10-01T00:00:00.000Z', ended: '2026-10-01T00:01:00.000Z', seconds: 60,
    usage: { read: 100, cached: 0, out: 10 },
  });
  const archived = structuredClone(first);
  foldRounds(archived);
  const queued = structuredClone(archived);
  queued.state = 'queued';
  queued.resume = { round: 2, prompt: 'prompt-r2.md' };
  delete queued.ended;
  delete queued.usage;
  const queuedLedger = buildLedger({ taskId: 'TASK-017', jobs: [queued], settings: priced(), now: '2026-10-01T00:02:00.000Z' });
  assert.deepEqual(queuedLedger.lines.map(line => line.id), ['job/again/round/1', 'job/again/round/2']);
  assert.equal(queuedLedger.lines[1]?.usage, null);
  assert.equal(queuedLedger.lines[1]?.seconds, null);
  assert.equal(queuedLedger.coverage, 'incomplete');
  assert.match(queuedLedger.gaps.join('\n'), /缺用量/);
  assert.equal(queuedLedger.seconds.known, 60);
  assert.equal(queuedLedger.tokens?.known.fresh, 100);
  const running = structuredClone(queued);
  running.state = 'running';
  running.started = '2026-10-01T00:03:00.000Z';
  const runningLedger = buildLedger({ taskId: 'TASK-017', jobs: [running], settings: priced(), now: '2026-10-01T00:04:00.000Z' });
  assert.equal(runningLedger.lines[1]?.id, 'job/again/round/2');
  assert.equal(runningLedger.lines[1]?.usage, null);
  assert.equal(runningLedger.lines[1]?.seconds, null);
  const used = structuredClone(running);
  used.usage = { read: 5, cached: 0, out: 1 };
  const usedLedger = buildLedger({ taskId: 'TASK-017', jobs: [used], settings: priced(), now: '2026-10-01T00:04:00.000Z' });
  assert.equal(usedLedger.lines[1]?.usage?.fresh, 5);
  assert.equal(usedLedger.lines[1]?.seconds, null);
  assert.equal(usedLedger.tokens?.known.fresh, 105);
  const stopped = structuredClone(queued);
  stopped.state = 'stopped';
  stopped.ended = '2026-10-01T00:05:00.000Z';
  stopped.seconds = 999;
  const stoppedLedger = buildLedger({ taskId: 'TASK-017', jobs: [stopped], settings: priced(), now: '2026-10-01T00:05:00.000Z' });
  assert.equal(stoppedLedger.lines.find(line => line.id === 'job/again/round/2')?.seconds, null);
  assert.equal(stoppedLedger.lines.find(line => line.id === 'job/again/round/2')?.usage, null);
  const failed = structuredClone(stopped);
  failed.state = 'failed';
  const failedLedger = buildLedger({ taskId: 'TASK-017', jobs: [failed], settings: priced(), now: '2026-10-01T00:05:00.000Z' });
  assert.equal(failedLedger.lines.find(line => line.id === 'job/again/round/2')?.seconds, null);
  const done = structuredClone(used);
  done.state = 'done';
  done.ended = '2026-10-01T00:05:00.000Z';
  done.seconds = 20;
  const folded = structuredClone(done);
  foldRounds(folded);
  const foldedLedger = buildLedger({ taskId: 'TASK-017', jobs: [folded], settings: priced(), now: '2026-10-01T00:06:00.000Z' });
  assert.deepEqual(foldedLedger.lines.map(line => line.id), ['job/again/round/1', 'job/again/round/2']);
  assert.equal(foldedLedger.tokens?.known.fresh, 105);
  assert.equal(foldedLedger.lines[1]?.seconds, 20);
  assert.equal(foldedLedger.seconds.known, 80);
  assert.equal(foldedLedger.lines[1]?.estimate?.amount, 6);
});
