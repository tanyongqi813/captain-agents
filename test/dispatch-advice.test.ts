import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dispatchAdvice, formatDispatchAdvice, sampleFromLedger, samplesFromJobs } from '../src/core/dispatch-advice.ts';
import type { AdviceBudget, AdviceSample, DispatchAdviceInput } from '../src/core/dispatch-advice.ts';
import { effectiveWorkers } from '../src/core/policy.ts';
import { buildLedger } from '../src/core/task-cost.ts';
import { checkCostSettings } from '../src/core/cost-settings.ts';
import { foldRounds } from '../src/core/wake.ts';
import type { Job } from '../src/core/job.ts';
import type { QuotaSnapshot } from '../src/core/quota.ts';
import type { AutopilotRun } from '../src/core/autopilot.ts';
import { ensureHome } from '../src/core/paths.ts';
import { context } from './helpers.ts';

const now = '2026-10-19T12:00:00.000Z';
const reset = '2026-10-26T00:00:00.000Z';
const workers = effectiveWorkers({});

function quota(at = now): QuotaSnapshot {
  return {
    queriedAt: at,
    providers: [
      { name: 'Codex', icon: 'codex', plan: 'pro', at, bars: [{ label: '周额度', used: 10, reset, windowMinutes: 10080 }] },
      { name: 'Grok', icon: 'grok', plan: 'super', at, bars: [{ label: '本期额度', used: 10, reset }] },
      { name: 'Cursor', icon: 'cursor', plan: null, at, bars: [{ label: '自家模型池', used: 10, reset }, { label: '其他模型池', used: 12, reset }] },
      { name: 'Kimi Code', icon: 'kimi', plan: 'plan', at, bars: [
        { label: '5 小时', used: 10, reset, windowMinutes: 300 },
        { label: '每周', used: 10, reset, windowMinutes: 10080 },
      ] },
    ],
  };
}
function job(who: string, extra: Record<string, unknown> = {}): Job {
  return {
    id: who, batch: 'b', project: 'p', repo: '/repo', base: 'abc', worktree: '/wt', branch: 'xa',
    who, model: who.startsWith('grok') || who === 'cursor-grok' ? 'grok-4.7' : 'gpt-6-astra', effort: 'high', mode: 'workspace-write',
    kind: '实现', title: '题', summary: '说明', state: 'done', created: now, started: now, ended: now, ...extra,
  } as Job;
}
const sample = (who: string, amount: number, extra: Partial<AdviceSample> = {}): AdviceSample => ({
  who, kind: '实现', accepted: true, rounds: 1, currency: 'USD', amount, basis: 'actual', seconds: 30, score: null, ...extra,
});
function advise(extra: Partial<DispatchAdviceInput> & { quota?: QuotaSnapshot | null }): ReturnType<typeof dispatchAdvice> {
  return dispatchAdvice({ now, kind: '实现', quotaStop: 80, quota: extra.quota === undefined ? quota() : extra.quota, workers, jobs: [], samples: [], ...extra });
}

test('同池共享负担，短窗口触顶不能因为长窗口还有余量就显示可派', () => {
  const advice = advise({
    jobs: [
      job('codex', { id: 'run-codex', state: 'running' }),
      job('codex-luna', { id: 'run-luna', state: 'running' }),
      job('deepseek', { id: 'run-ds', state: 'running' }),
      job('cursor-grok', { id: 'run-cursor', state: 'running' }),
    ],
  });
  const codex = advice.candidates.find(item => item.who === 'codex')!;
  const luna = advice.candidates.find(item => item.who === 'codex-luna')!;
  const deepseek = advice.candidates.find(item => item.who === 'deepseek')!;
  const own = advice.candidates.find(item => item.who === 'cursor-grok')!;
  const other = advice.candidates.find(item => item.who === 'cursor-opus')!;
  assert.equal(codex.inflight, 2);
  assert.equal(luna.inflight, 2);
  assert.ok(codex.sharedWith.includes('codex-luna'));
  assert.equal(deepseek.inflight, 1);
  assert.ok(!codex.sharedWith.includes('deepseek'));
  assert.equal(own.inflight, 1);
  assert.equal(other.inflight, 0);
  assert.ok(!own.sharedWith.includes('cursor-opus'));
  assert.match(advice.notes.join('\n'), /负担共享/);
  const blocked = quota();
  blocked.providers.find(item => item.icon === 'kimi')!.bars[0]!.used = 100;
  const kimi = advise({ quota: blocked }).candidates.find(item => item.who === 'kimi')!;
  assert.equal(kimi.gate, 'block');
  assert.equal(kimi.windows.length, 2);
  assert.equal(kimi.windows[1]?.used, 10);
  const text = formatDispatchAdvice(advise({ quota: blocked }));
  assert.match(text, /Kimi Code：不能派/);
  assert.match(text, /不派发、不换人/);
  assert.doesNotMatch(text, /可以跳过|已派发|已换人/);
});

test('额度陈旧、查不到、重置未知、跨重置和并发消耗都标不确定', () => {
  const stale = advise({ quota: quota('2026-10-19T11:00:00.000Z') }).candidates.find(item => item.who === 'codex')!;
  assert.equal(stale.gate, 'uncertain');
  assert.equal(stale.windows[0]?.headroom, null);
  assert.match(stale.uncertain.join('\n'), /过期/);
  assert.doesNotMatch(formatDispatchAdvice(advise({ quota: quota('2026-10-19T11:00:00.000Z') })), /耗尽日期|月底余额/);
  const missing = quota();
  missing.providers[0]!.bars[0]!.used = null;
  const unknown = advise({ quota: missing }).candidates.find(item => item.who === 'codex')!;
  assert.equal(unknown.gate, 'uncertain');
  assert.match(unknown.uncertain.join('\n'), /用量未知，不能当成 0 或无限/);
  assert.equal(unknown.windows[0]?.used, null);
  const open = quota();
  open.providers[0]!.bars[0]!.reset = null;
  assert.match(advise({ quota: open }).candidates.find(item => item.who === 'codex')!.uncertain.join('\n'), /重置时间未知/);
  const before = quota(), after = quota();
  after.providers[0]!.bars[0]!.reset = '2027-01-01T00:00:00.000Z';
  after.providers[0]!.bars[0]!.used = 30;
  const compared = advise({ quotaDeltas: [{ who: 'codex', before, after, shared: true }] });
  assert.match(compared.notes.join('\n'), /跨重置或不可比/);
  assert.match(compared.notes.join('\n'), /共享池/);
});

test('三轮低价达标优先于一次高分达标；不达标、超时或超预算不再推荐', () => {
  const preferred = advise({
    deadlineSeconds: 100,
    samples: [
      sample('codex', 3, { rounds: 3, score: 2, seconds: 90 }),
      sample('grok', 9, { rounds: 1, score: 5, seconds: 20 }),
    ],
  });
  assert.equal(preferred.preference, 'codex');
  assert.equal(preferred.action, 'suggest');
  assert.match(preferred.reason, /完成整件任务的成本 3 USD/);
  assert.match(preferred.reason, /不按单次分数、返工次数或余额高低挑选/);
  const text = formatDispatchAdvice(preferred);
  assert.match(text, /Codex：.*完成成本 3 USD/);
  assert.match(text, /在途 0/);
  assert.match(text, /重置 /);
  const failed = advise({ samples: [sample('codex', 1, { accepted: false }), sample('grok', 9)] });
  assert.equal(failed.preference, 'grok');
  const late = advise({ deadlineSeconds: 100, samples: [sample('codex', 1, { seconds: 500 }), sample('grok', 9, { seconds: 10 })] });
  assert.equal(late.preference, 'grok');
  const poor = advise({
    deadlineSeconds: 100,
    samples: [sample('codex', 3, { seconds: 10 }), sample('grok', 9, { seconds: 10 })],
    budgets: [{ account: 'acct', channel: 'codex', source: 'manual', kind: 'usage', currency: 'USD', remaining: 1, expired: false, models: ['gpt-6-astra'] }],
  });
  assert.equal(poor.preference, 'grok');
  assert.match(poor.candidates.find(item => item.who === 'codex')!.uncertain.join('\n'), /预算不够/);
  assert.notEqual(poor.candidates.find(item => item.who === 'codex')!.gate, 'block');
  const full = quota();
  for (const provider of full.providers) for (const bar of provider.bars) bar.used = 100;
  const none = advise({ quota: full, samples: [sample('codex', 3), sample('grok', 9)] });
  assert.equal(none.preference, null);
  assert.equal(none.action, 'wait');
  assert.match(none.reason, /等待/);
  const hard = advise({ difficulty: 'high', samples: [] });
  assert.equal(hard.preference, null);
  assert.equal(hard.action, 'ask');
  assert.match(hard.reason, /求助/);
  assert.match(hard.reason, /不降低验收/);
});

test('官方额度、中转预算和人工参考分开；换人后的完整成本参与比较，下一步只看剩余', () => {
  const relay = advise({
    samples: [],
    budgets: [
      { account: 'relay', channel: 'deepseek', source: 'relay', kind: 'usage', currency: 'CNY', remaining: null, expired: false, models: ['deepseek-v4-pro'] },
      { account: 'codex-sub', channel: 'codex', source: 'official', kind: 'subscription', remaining: null, expired: false, models: ['gpt-6-astra'] },
    ],
    experiences: [{ id: 'exp', subject: '甲', basis: '乙', factor: { numerator: 1, denominator: 3 }, scope: '只作参考', recordedAt: '2026-10-01T00:00:00.000Z' }],
  });
  const relayText = formatDispatchAdvice(relay);
  assert.match(relayText, /不派发/);
  assert.match(relay.notes.join('\n'), /中转费用单独计算，不能套官方套餐/);
  assert.match(relay.notes.join('\n'), /不把月费折成单次费用/);
  assert.match(relay.notes.join('\n'), /1\/3/);
  assert.match(relay.reason, /样本不足，需负责人判断/);
  assert.equal(relay.preference, null);
  assert.match(relay.notes.join('\n'), /预算余额未知，不能当成 0 或无限/);
  assert.equal(relay.candidates.find(item => item.who === 'deepseek')?.windows.length, 0);
  const settings = checkCostSettings({
    version: 1,
    accounts: [
      { id: 'acct-codex', label: 'Codex', channel: 'codex', kind: 'usage', source: 'manual' },
      { id: 'acct-grok', label: 'Grok', channel: 'grok', kind: 'usage', source: 'manual' },
    ],
    bindings: [
      { account: 'acct-codex', channel: 'codex', model: 'gpt-6-astra', effectiveAt: '2026-01-01T00:00:00.000Z' },
      { account: 'acct-grok', channel: 'grok', model: 'grok-4.7', effectiveAt: '2026-01-01T00:00:00.000Z' },
    ],
    prices: [
      { id: 'codex', account: 'acct-codex', model: 'gpt-6-astra', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: now, read: 1_000_000, cached: 1_000_000, out: 1_000_000 },
      { id: 'grok', account: 'acct-grok', model: 'grok-4.7', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: now, read: 1_000_000, cached: 1_000_000, out: 1_000_000 },
    ],
    experiences: [],
  });
  const plan = { taskId: 'TASK-015', spec: 'docs/tasks/TASK-015.md' };
  const failed = job('codex', { id: 'failed', state: 'failed', created: '2026-10-19T01:00:00.000Z', usage: { read: 1, cached: 0, out: 0 }, seconds: 10, plan });
  const handed = job('grok', { id: 'handed', created: '2026-10-19T02:00:00.000Z', usage: { read: 2, cached: 0, out: 0 }, seconds: 10, verify: { ok: true }, plan });
  const ledger = buildLedger({ taskId: 'TASK-015', jobs: [failed, handed], settings, now });
  assert.equal(ledger.lines.some(line => line.phase === 'handoff'), true);
  const whole = sampleFromLedger(ledger, { who: 'grok', kind: '实现', accepted: true, rounds: 2, seconds: 20, score: 5 });
  assert.equal(whole.amount, 3);
  assert.notEqual(whole.amount, 2);
  const gathered = samplesFromJobs([handed, failed], settings, now);
  const ordered = samplesFromJobs([failed, handed], settings, now);
  assert.equal(gathered.samples[0]?.who, 'grok');
  assert.equal(ordered.samples[0]?.who, 'grok');
  assert.equal(gathered.samples[0]?.amount, 3);
  assert.equal(gathered.samples[0]?.capability, false);
  assert.match(gathered.samples[0]?.note ?? '', /不能当成最后一位的单独完成能力/);
  const mixed = advise({ deadlineSeconds: 100, samples: [...gathered.samples, sample('codex', 9, { rounds: 1, score: 1, seconds: 20 })] });
  assert.equal(mixed.preference, 'codex');
  const next = advise({
    mode: 'next', deadlineSeconds: 100, sunk: { currency: 'USD', amount: 100 },
    recoveryCap: { currency: 'USD', amount: 3 },
    samples: [sample('codex', 9, { seconds: 10 }), sample('grok', 3, { seconds: 10 })],
    forward: [{ who: 'codex', currency: 'USD', amount: 1, seconds: 10 }, { who: 'grok', currency: 'USD', amount: 8, seconds: 10 }],
  });
  assert.equal(next.preference, 'codex');
  assert.match(next.reason, /已耗成本不计入/);
  assert.match(next.notes.join('\n'), /已耗成本 100 USD/);
  const stuck = advise({ progress: 'none', samples: [sample('codex', 3), sample('grok', 9)] });
  assert.equal(stuck.preference, null);
  assert.match(stuck.reason, /求助/);
});

const plan = { taskId: 'TASK-015', spec: 'docs/tasks/TASK-015.md' };
const priced = checkCostSettings({
  version: 1,
  accounts: [
    { id: 'shared', label: '共用账户', channel: 'codex', kind: 'usage', source: 'manual', balance: { amount: 3, currency: 'USD', scope: '两个模型共用', recordedAt: now } },
    { id: 'acct-grok', label: 'Grok', channel: 'grok', kind: 'usage', source: 'manual' },
  ],
  bindings: [
    { account: 'shared', channel: 'codex', model: 'gpt-6-astra', effectiveAt: '2026-01-01T00:00:00.000Z' },
    { account: 'shared', channel: 'codex', model: 'gpt-6-luna', effectiveAt: '2026-01-01T00:00:00.000Z' },
    { account: 'acct-grok', channel: 'grok', model: 'grok-4.7', effectiveAt: '2026-01-01T00:00:00.000Z' },
  ],
  prices: [
    { id: 'astra', account: 'shared', model: 'gpt-6-astra', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: now, read: 1_000_000, cached: 1_000_000, out: 1_000_000 },
    { id: 'luna', account: 'shared', model: 'gpt-6-luna', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: now, read: 1_000_000, cached: 1_000_000, out: 1_000_000 },
    { id: 'grok', account: 'acct-grok', model: 'grok-4.7', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: now, read: 1_000_000, cached: 1_000_000, out: 1_000_000 },
  ],
  experiences: [],
});
const budget = (extra: Partial<AdviceBudget> = {}): AdviceBudget => ({
  account: 'acct', channel: 'codex', source: 'manual', kind: 'usage', currency: 'USD', remaining: 2, expired: false, models: ['gpt-6-astra'], ...extra,
});

test('写手、验收和换人以最后的权威结果为准，不跟列表顺序走', () => {
  const writer = job('codex', { id: 'impl', created: '2026-10-19T01:00:00.000Z', verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, seconds: 10, plan });
  const reviewer = job('codex-luna', { id: 'rev', created: '2026-10-19T04:00:00.000Z', mode: 'read-only', model: 'gpt-6-luna', verify: { ok: true }, usage: { read: 2, cached: 0, out: 0 }, seconds: 10, plan });
  const forward = samplesFromJobs([reviewer, writer], priced, now);
  const backward = samplesFromJobs([writer, reviewer], priced, now);
  assert.equal(forward.samples[0]?.who, 'codex');
  assert.equal(backward.samples[0]?.who, 'codex');
  assert.equal(forward.samples[0]?.capability, true);
  assert.equal(forward.samples[0]?.amount, backward.samples[0]?.amount);
  assert.equal(forward.samples[0]?.amount, 3);
  const early = job('codex', { id: 'early', created: '2026-10-19T01:00:00.000Z', verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, seconds: 10, plan });
  const later = job('codex', { id: 'later', created: '2026-10-19T03:00:00.000Z', state: 'failed', verify: { ok: false }, usage: { read: 1, cached: 0, out: 0 }, seconds: 10, plan });
  const failed = samplesFromJobs([later, early], priced, now);
  assert.equal(failed.samples[0]?.capability, false);
  assert.match(failed.samples[0]?.note ?? '', /早前通过不算/);
  const alpha = job('codex', { id: 'alpha-job', project: 'alpha', repo: '/repos/alpha', created: '2026-10-19T01:00:00.000Z', verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, seconds: 10, plan });
  const beta = job('grok', { id: 'beta-job', project: 'beta', repo: '/repos/beta', created: '2026-10-19T01:00:00.000Z', verify: { ok: true }, usage: { read: 2, cached: 0, out: 0 }, seconds: 10, plan });
  const split = samplesFromJobs([beta, alpha], priced, now);
  assert.deepEqual(split.samples.map(item => item.who).sort(), ['codex', 'grok']);
  assert.deepEqual(split.samples.map(item => item.amount).sort(), [1, 2]);
  const run = { id: 'only-auto', project: 'alpha', repo: '/repos/alpha', taskId: 'TASK-015', attempts: [{ token: 'tok', jobs: ['missing-job'], usage: { read: 10, cached: 0, out: 1 }, at: now }] } as AutopilotRun;
  const alone = samplesFromJobs([], priced, now, [run]);
  assert.equal(alone.samples.length, 0);
  assert.match(alone.notes.join('\n'), /找不到任务 missing-job/);
  const unpriced = samplesFromJobs([writer], checkCostSettings({ version: 1, accounts: [], bindings: [], prices: [], experiences: [] }), now);
  assert.equal(unpriced.samples[0]?.amount, null);
  assert.equal(unpriced.samples[0]?.capability, false);
});

test('每家额度按自己的数据时间判断，近似值和没查到的旧数不能给出确定余量', () => {
  const fresh = quota();
  fresh.providers.find(item => item.icon === 'codex')!.at = '2026-10-01T00:00:00.000Z';
  const stale = advise({ quota: fresh, deadlineSeconds: 100, samples: [sample('codex', 1, { seconds: 10 }), sample('grok', 9, { seconds: 10 })] });
  const codex = stale.candidates.find(item => item.who === 'codex')!;
  assert.equal(codex.windows[0]?.headroom, null);
  assert.match(codex.uncertain.join('\n'), /过期/);
  assert.equal(stale.preference, 'grok');
  const approx = quota();
  approx.providers[0]!.bars[0]!.approx = true;
  const fuzzy = advise({ quota: approx, deadlineSeconds: 100, samples: [sample('codex', 1, { seconds: 10 }), sample('grok', 9, { seconds: 10 })] });
  assert.equal(fuzzy.candidates.find(item => item.who === 'codex')!.windows[0]?.headroom, null);
  assert.match(fuzzy.candidates.find(item => item.who === 'codex')!.uncertain.join('\n'), /近似值/);
  assert.notEqual(fuzzy.preference, 'codex');
  const failed = quota();
  failed.providers[0]!.error = '这次没查到';
  failed.providers[0]!.bars[0]!.used = 10;
  const kept = advise({ quota: failed, deadlineSeconds: 100, samples: [sample('codex', 1, { seconds: 10 }), sample('grok', 9, { seconds: 10 })] });
  assert.equal(kept.candidates.find(item => item.who === 'codex')!.windows[0]?.headroom, null);
  assert.match(kept.candidates.find(item => item.who === 'codex')!.uncertain.join('\n'), /旧数不能当成当前可派/);
  assert.notEqual(kept.preference, 'codex');
  const future = quota();
  future.providers[0]!.at = '2026-10-20T00:00:00.000Z';
  assert.match(advise({ quota: future }).candidates.find(item => item.who === 'codex')!.uncertain.join('\n'), /额度时间无效/);
});

test('预算按共用账户和这一步的剩余费用比较，过期、未知或币种不同都不能当成够用', () => {
  const affordable = advise({
    mode: 'next', deadlineSeconds: 100,
    samples: [sample('codex', 9, { seconds: 10 })],
    forward: [{ who: 'codex', currency: 'USD', amount: 1, seconds: 10 }],
    budgets: [budget()],
  });
  assert.equal(affordable.preference, 'codex');
  assert.doesNotMatch(affordable.candidates.find(item => item.who === 'codex')!.uncertain.join('\n'), /预算不够/);
  const expired = advise({ deadlineSeconds: 100, samples: [sample('codex', 1, { seconds: 10 }), sample('grok', 9, { seconds: 10 })], budgets: [budget({ remaining: 100, expired: true })] });
  assert.notEqual(expired.preference, 'codex');
  assert.match(expired.candidates.find(item => item.who === 'codex')!.uncertain.join('\n'), /已过期/);
  const unknown = advise({ deadlineSeconds: 100, samples: [sample('codex', 1, { seconds: 10 }), sample('grok', 9, { seconds: 10 })], budgets: [budget({ remaining: null })] });
  assert.notEqual(unknown.preference, 'codex');
  assert.match(unknown.notes.join('\n'), /不能当成 0 或无限/);
  const other = advise({ deadlineSeconds: 100, samples: [sample('codex', 1, { seconds: 10 }), sample('grok', 9, { seconds: 10 })], budgets: [budget({ currency: 'CNY' })] });
  assert.notEqual(other.preference, 'codex');
  assert.match(other.candidates.find(item => item.who === 'codex')!.uncertain.join('\n'), /币种不同/);
  const shared = advise({
    deadlineSeconds: 100,
    samples: [sample('codex', 4, { seconds: 10 }), sample('codex-luna', 4, { seconds: 10 })],
    budgets: [budget({ account: '共用账户', remaining: 3, models: ['gpt-6-astra', 'gpt-6-luna'] })],
  });
  assert.equal(shared.preference, null);
  assert.match(shared.notes.join('\n'), /共用账户/);
  assert.match(shared.candidates.find(item => item.who === 'codex')!.uncertain.join('\n'), /预算不够/);
  assert.match(shared.candidates.find(item => item.who === 'codex-luna')!.uncertain.join('\n'), /预算不够/);
  const one = advise({ deadlineSeconds: 100, samples: [sample('codex', 3, { seconds: 10 })] });
  const text = formatDispatchAdvice(one);
  assert.match(text, /数据时间 2026-10-19T12:00:00.000Z/);
  assert.match(text, /可信度低/);
  assert.match(text, /样本少/);
  assert.match(one.candidates.find(item => item.who === 'codex')!.uncertain.join('\n') + text, /数据时间/);
  const gone = advise({
    deadlineSeconds: 100,
    samples: [sample('codex', 1, { seconds: 10 }), sample('grok', 9, { seconds: 10 })],
    unavailable: [{ who: 'codex', reason: '这台电脑上没找到 Codex' }],
  });
  assert.equal(gone.preference, 'grok');
  assert.equal(gone.candidates.find(item => item.who === 'codex')!.gate, 'block');
  assert.match(formatDispatchAdvice(gone), /没找到 Codex/);
  const old = advise({
    samples: [],
    experiences: [{ id: 'old', subject: '甲', basis: '乙', factor: { numerator: 1, denominator: 3 }, scope: '过期对照', recordedAt: '2026-10-01T00:00:00.000Z', validUntil: '2026-10-02T00:00:00.000Z' }],
  });
  assert.match(old.notes.join('\n'), /已过期，不作为依据/);
  assert.doesNotMatch(old.notes.join('\n'), /人工参考：甲/);
});

function span(who: string, id: string, from: string, seconds: number, extra: Record<string, unknown> = {}) {
  const started = from;
  const ended = new Date(Date.parse(from) + seconds * 1000).toISOString();
  return job(who, { id, created: started, started, ended, seconds, ...extra });
}

test('没有计划号的自治关联任务并进账本，跨仓库和真正缺失仍分开', () => {
  const writer = job('codex', { id: 'impl', verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, plan });
  const diagnosed = job('codex', { id: 'd', usage: { read: 1, cached: 0, out: 0 } });
  const review = job('codex-luna', { id: 'rev', mode: 'read-only', model: 'gpt-6-luna', usage: { read: 1, cached: 0, out: 0 } });
  const mixedRun = {
    id: 'mix', project: 'p', repo: '/repo', taskId: 'TASK-015',
    attempts: [{ token: 'a', jobs: ['impl', 'impl'] }],
    flow: { reviews: [{ token: 'r', jobs: ['rev'] }] },
    diagnoses: [{ token: 'g', jobs: ['d'] }],
  } as AutopilotRun;
  const mixed = samplesFromJobs([diagnosed, review, writer], priced, now, [mixedRun]);
  assert.equal(mixed.samples[0]?.who, 'codex');
  assert.equal(mixed.samples[0]?.amount, 3);
  assert.doesNotMatch(`${mixed.notes.join('\n')}\n${mixed.samples[0]?.note ?? ''}`, /找不到任务 d|找不到任务 rev|找不到任务 impl/);
  const solo = job('codex', { id: 'solo', verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 } });
  const reviewOnly = job('codex-luna', { id: 'rev-only', mode: 'read-only', model: 'gpt-6-luna', usage: { read: 2, cached: 0, out: 0 } });
  const diagOnly = job('grok', { id: 'diag-only', model: 'grok-4.7', usage: { read: 1, cached: 0, out: 0 } });
  const auto = {
    id: 'roles', project: 'p', repo: '/repo', taskId: 'TASK-015',
    attempts: [{ token: 'w', jobs: ['solo'] }],
    flow: { reviews: [{ token: 'rv', jobs: ['rev-only'] }] },
    diagnoses: [{ token: 'dg', jobs: ['diag-only'] }],
  } as AutopilotRun;
  const linked = samplesFromJobs([diagOnly, reviewOnly, solo], priced, now, [auto]);
  assert.equal(linked.samples[0]?.who, 'codex');
  assert.equal(linked.samples[0]?.capability, true);
  assert.equal(linked.samples[0]?.amount, 4);
  const other = job('grok', { id: 'other-repo', project: 'beta', repo: '/repos/beta', usage: { read: 9, cached: 0, out: 0 } });
  const cross = { id: 'cross', project: 'p', repo: '/repo', taskId: 'TASK-015', attempts: [{ token: 'x', jobs: ['impl', 'other-repo', 'gone'] }] } as AutopilotRun;
  const separated = samplesFromJobs([writer, other], priced, now, [cross]);
  const home = separated.samples.find(item => item.who === 'codex');
  assert.equal(home?.amount, null);
  assert.match(home?.note ?? '', /找不到任务 gone/);
  assert.match(home?.note ?? '', /别的项目/);
  assert.equal(separated.samples.some(item => item.who === 'grok'), false);
});

test('期限用完整流程的可靠时间，重叠不连加，下一步不用历史时长', () => {
  const writer = span('codex', 'impl', '2026-10-19T01:00:00.000Z', 30, { verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, plan });
  const review = span('codex-luna', 'rev', '2026-10-19T01:00:30.000Z', 100, { mode: 'read-only', model: 'gpt-6-luna', usage: { read: 1, cached: 0, out: 0 }, plan });
  const serial = samplesFromJobs([writer, review], priced, now);
  assert.equal(serial.samples[0]?.seconds, 130);
  assert.equal(serial.samples[0]?.amount, 2);
  const late = advise({ deadlineSeconds: 60, samples: [...serial.samples, sample('grok', 9, { seconds: 20 })] });
  assert.equal(late.candidates.find(item => item.who === 'codex')!.deadline, 'outside');
  assert.equal(late.preference, 'grok');
  const diag = span('codex', 'diag', '2026-10-19T01:02:10.000Z', 40, { usage: { read: 1, cached: 0, out: 0 } });
  const rework = { id: 'rework', project: 'p', repo: '/repo', taskId: 'TASK-015', attempts: [{ token: 'a', jobs: ['impl'] }], diagnoses: [{ token: 'g', jobs: ['diag'] }] } as AutopilotRun;
  assert.equal(samplesFromJobs([writer, diag], priced, now, [rework]).samples[0]?.seconds, 70);
  const folded = span('codex', 'folded', '2026-10-19T02:00:00.000Z', 30, {
    verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, plan,
    rounds: [
      { n: 1, started: '2026-10-19T02:00:00.000Z', ended: '2026-10-19T02:00:10.000Z', seconds: 10, exit: 0, state: 'done' },
      { n: 2, started: '2026-10-19T02:00:10.000Z', ended: '2026-10-19T02:00:30.000Z', seconds: 20, exit: 0, state: 'done' },
    ],
  });
  assert.equal(samplesFromJobs([folded], priced, now).samples[0]?.seconds, 30);
  const main = span('codex', 'main', '2026-10-19T03:00:00.000Z', 120, { verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, plan });
  const side = span('codex-luna', 'side', '2026-10-19T03:00:00.000Z', 60, { mode: 'read-only', model: 'gpt-6-luna', usage: { read: 1, cached: 0, out: 0 }, plan });
  assert.equal(samplesFromJobs([main, side], priced, now).samples[0]?.seconds, 120);
  const blind = job('codex', { id: 'blind', verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, seconds: 30, plan });
  const unknownTime = samplesFromJobs([blind], priced, now);
  assert.equal(unknownTime.samples[0]?.seconds, null);
  const skipped = advise({ deadlineSeconds: 60, samples: [...unknownTime.samples, sample('grok', 9, { seconds: 20 })] });
  assert.equal(skipped.candidates.find(item => item.who === 'codex')!.deadline, 'unknown');
  assert.equal(skipped.preference, 'grok');
  const historical = sample('codex', 9, { seconds: 130 });
  const next = advise({
    mode: 'next', deadlineSeconds: 60,
    samples: [historical, sample('grok', 8, { seconds: 200 })],
    forward: [{ who: 'codex', currency: 'USD', amount: 1, seconds: 20 }, { who: 'grok', currency: 'USD', amount: 4, seconds: 20 }],
  });
  assert.equal(next.candidates.find(item => item.who === 'codex')!.deadline, 'inside');
  assert.equal(next.preference, 'codex');
  const missingRemain = advise({ mode: 'next', deadlineSeconds: 60, samples: [historical], forward: [{ who: 'codex', currency: 'USD', amount: 1 }] });
  assert.equal(missingRemain.candidates.find(item => item.who === 'codex')!.deadline, 'unknown');
  assert.equal(missingRemain.preference, null);
});

test('当前轮还没归档也算进流程时长，归档前后都是 130 秒', () => {
  const open = job('codex', {
    id: 'round-open', created: '2026-10-19T00:00:00.000Z',
    started: '2026-10-19T00:01:00.000Z', ended: '2026-10-19T00:02:40.000Z', seconds: 100,
    state: 'done', verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, plan,
    resume: { round: 2, prompt: 'prompt-r2.md' },
    rounds: [{ n: 1, started: '2026-10-19T00:00:00.000Z', ended: '2026-10-19T00:00:30.000Z', seconds: 30, exit: 0, state: 'done', usage: { read: 1, cached: 0, out: 0 } }],
  });
  const folded = structuredClone(open);
  foldRounds(folded);
  const before = samplesFromJobs([open], priced, now);
  const after = samplesFromJobs([folded], priced, now);
  assert.equal(open.rounds?.length, 1);
  assert.equal(open.seconds, 100);
  assert.equal(folded.rounds?.length, 2);
  assert.equal(folded.seconds, 130);
  assert.equal(before.samples[0]?.seconds, 130);
  assert.equal(after.samples[0]?.seconds, 130);
  assert.equal(before.samples[0]?.amount, after.samples[0]?.amount);
  assert.equal(before.samples[0]?.accepted, true);
  assert.equal(after.samples[0]?.accepted, true);
  const early = advise({ deadlineSeconds: 60, samples: before.samples });
  const later = advise({ deadlineSeconds: 60, samples: after.samples });
  assert.equal(early.candidates.find(item => item.who === 'codex')!.deadline, 'outside');
  assert.equal(later.candidates.find(item => item.who === 'codex')!.deadline, 'outside');
  assert.equal(early.preference, null);
  assert.equal(later.preference, null);
  assert.equal(early.action, later.action);
  const running = structuredClone(open);
  running.state = 'running';
  delete running.ended;
  delete running.verify;
  const live = samplesFromJobs([running], priced, now);
  assert.equal(live.samples[0]?.seconds, null);
  assert.equal(advise({ deadlineSeconds: 60, samples: live.samples }).candidates.find(item => item.who === 'codex')!.deadline, 'unknown');
  const queued = structuredClone(open);
  queued.state = 'queued';
  delete queued.ended;
  assert.equal(samplesFromJobs([queued], priced, now).samples[0]?.seconds, null);
  const stale = structuredClone(open);
  stale.started = '2026-10-19T00:00:00.000Z';
  assert.equal(samplesFromJobs([stale], priced, now).samples[0]?.seconds, null);
  const untimed = structuredClone(open);
  delete untimed.seconds;
  assert.equal(samplesFromJobs([untimed], priced, now).samples[0]?.seconds, null);
  const overlap = job('codex', {
    id: 'round-overlap', created: '2026-10-19T04:00:00.000Z',
    started: '2026-10-19T04:01:00.000Z', ended: '2026-10-19T04:02:30.000Z', seconds: 90,
    state: 'done', verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, plan,
    resume: { round: 2, prompt: 'prompt-r2.md' },
    rounds: [{ n: 1, started: '2026-10-19T04:00:00.000Z', ended: '2026-10-19T04:02:00.000Z', seconds: 120, exit: 0, state: 'done', usage: { read: 1, cached: 0, out: 0 } }],
  });
  const overlapFolded = structuredClone(overlap);
  foldRounds(overlapFolded);
  const overlapBefore = samplesFromJobs([overlap], priced, now);
  const overlapAfter = samplesFromJobs([overlapFolded], priced, now);
  assert.equal(overlapBefore.samples[0]?.seconds, 150);
  assert.equal(overlapAfter.samples[0]?.seconds, 150);
  assert.equal(overlapFolded.seconds, 210);
  assert.equal(overlapBefore.samples[0]?.amount, overlapAfter.samples[0]?.amount);
  assert.equal(advise({ deadlineSeconds: 60, samples: overlapBefore.samples }).preference, advise({ deadlineSeconds: 60, samples: overlapAfter.samples }).preference);
});

test('没有可靠预算时不优先，换掉说明句子也不改变这个结论', () => {
  const bare = advise({ quota: null, deadlineSeconds: 100, samples: [sample('deepseek', 3, { currency: 'CNY', seconds: 10 })] });
  assert.equal(bare.candidates.find(item => item.who === 'deepseek')!.fund, 'unknown');
  assert.equal(bare.preference, null);
  assert.equal(bare.action, 'ask');
  assert.match(bare.candidates.find(item => item.who === 'deepseek')!.uncertain.join('\n'), /不占官方套餐/);
  const expired = advise({
    quota: null, deadlineSeconds: 100,
    samples: [sample('deepseek', 3, { currency: 'CNY', seconds: 10 })],
    budgets: [budget({ account: 'relay', channel: 'deepseek', source: 'relay', currency: 'CNY', remaining: 10, expired: true, models: ['deepseek-v4-pro'] })],
  });
  assert.equal(expired.candidates.find(item => item.who === 'deepseek')!.fund, 'unknown');
  assert.equal(expired.preference, null);
  const unnamed = advise({
    quota: null, deadlineSeconds: 100,
    samples: [sample('deepseek', 3, { currency: 'CNY', seconds: 10 })],
    budgets: [budget({ account: 'relay', channel: 'deepseek', source: 'relay', currency: 'CNY', remaining: null, models: ['deepseek-v4-pro'] })],
  });
  assert.equal(unnamed.candidates.find(item => item.who === 'deepseek')!.fund, 'unknown');
  assert.equal(unnamed.preference, null);
  const custom = advise({
    quota: null, deadlineSeconds: 100,
    samples: [sample('deepseek', 3, { currency: 'CNY', seconds: 10 })],
    budgets: [budget({ account: 'relay', channel: 'deepseek', source: 'relay', currency: 'CNY', remaining: 10, models: ['my-relay-model'] })],
  });
  assert.equal(custom.candidates.find(item => item.who === 'deepseek')!.fund, 'unknown');
  assert.equal(custom.preference, null);
  const paid = advise({
    quota: null, deadlineSeconds: 100,
    samples: [sample('deepseek', 3, { currency: 'CNY', seconds: 10 })],
    budgets: [budget({ account: 'relay', channel: 'deepseek', source: 'relay', currency: 'CNY', remaining: 10, models: ['deepseek-v4-pro'] })],
  });
  assert.equal(paid.candidates.find(item => item.who === 'deepseek')!.fund, 'ready');
  assert.equal(paid.preference, 'deepseek');
  const fast = advise({
    deadlineSeconds: 100,
    samples: [sample('grok', 4, { seconds: 10 }), sample('codex', 9, { seconds: 10 })],
    budgets: [budget({ account: 'fast', channel: 'grok', currency: 'USD', remaining: 10, models: ['grok-4.7-build-fast'] })],
  });
  assert.equal(fast.candidates.find(item => item.who === 'grok')!.fund, 'ready');
  assert.equal(fast.preference, 'grok');
  const effort = advise({
    deadlineSeconds: 100,
    samples: [sample('cursor-opus', 3, { seconds: 10 }), sample('codex', 9, { seconds: 10 })],
    budgets: [budget({ account: 'opus', channel: 'cursor', currency: 'USD', remaining: 10, models: ['claude-opus-5-5-high'] })],
  });
  assert.equal(effort.candidates.find(item => item.who === 'cursor-opus')!.fund, 'ready');
  assert.equal(effort.preference, 'cursor-opus');
});

test('真实手册入口读账户、任务、无人看守和安装情况，不改登记也不查额度', async t => {
  const c = await context(t, false), previous = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  const previousHome = process.env.HOME, previousProfile = process.env.USERPROFILE, previousCodex = process.env.CODEX_HOME;
  process.env.HOME = join(c.temp, 'user-home');
  process.env.USERPROFILE = join(c.temp, 'user-home');
  process.env.CODEX_HOME = join(c.temp, 'user-home', '.codex');
  t.after(() => {
    if (previous === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = previous;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousProfile;
    if (previousCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodex;
  });
  await ensureHome();
  const at = '2026-10-18T00:00:00.000Z';
  await mkdir(join(c.home, 'projects'), { recursive: true });
  await writeFile(join(c.home, 'projects', 'alpha.json'), JSON.stringify({ repo: '/repos/alpha', worktreeRoot: '.worktrees' }));
  const impl = job('codex', { id: 'impl', project: 'alpha', repo: '/repos/alpha', created: at, started: at, ended: at, seconds: 30, verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, plan });
  const review = job('codex-luna', { id: 'rev', project: 'alpha', repo: '/repos/alpha', created: '2026-10-18T01:00:00.000Z', started: '2026-10-18T01:00:00.000Z', ended: '2026-10-18T01:00:00.000Z', seconds: 10, mode: 'read-only', model: 'gpt-6-luna', verify: { ok: true }, usage: { read: 2, cached: 0, out: 0 }, plan });
  const diagnosed = job('codex', { id: 'diag', project: 'alpha', repo: '/repos/alpha', created: '2026-10-18T02:00:00.000Z', started: '2026-10-18T02:00:00.000Z', ended: '2026-10-18T02:00:00.000Z', usage: { read: 1, cached: 0, out: 0 } });
  const outside = job('grok', { id: 'beta-link', project: 'beta', repo: '/repos/beta', created: at, started: at, ended: at, usage: { read: 9, cached: 0, out: 0 } });
  const relay = job('deepseek', { id: 'ds-job', project: 'beta', repo: '/repos/beta', created: at, started: at, ended: at, model: 'deepseek-v4-pro', command: { args: ['exec', '-m', 'deepseek-v4-pro'] }, verify: { ok: true }, usage: { read: 1, cached: 0, out: 0 }, plan: { taskId: 'TASK-015', spec: 'docs/tasks/TASK-015.md' } });
  for (const row of [impl, review, diagnosed, outside, relay]) {
    await mkdir(join(c.home, 'jobs', row.id), { recursive: true });
    await writeFile(join(c.home, 'jobs', row.id, 'job.json'), JSON.stringify(row));
  }
  const run = {
    id: '1019-1200-auto', version: 1, project: 'alpha', repo: '/repos/alpha', base: 'abc1234', taskId: 'TASK-015', spec: 'docs/tasks/TASK-015.md',
    state: 'stopped', who: ['codex:high'], network: false, ro: false, policy: { id: 'short', minutes: 60, attempts: 4, nodes: 3 },
    created: at, updated: at, ended: at, reason: '缺一份记录', elapsedSeconds: 0, sleeps: 0, attemptCount: 1, nodeCount: 1,
    nodes: [{ id: 'n', depth: 0, state: 'failed', attempts: 1, continues: 0, retries: 0 }],
    attempts: [{ node: 'n', attempt: 1, token: 'tok-missing', at, jobs: ['impl', 'impl', 'missing-job', 'beta-link'], usage: { read: 4, cached: 0, out: 1 } }],
    diagnoses: [{ node: 'n', attempt: 1, at, token: 'tok-diag', fingerprint: '0123456789abcdef', jobs: ['diag'] }],
  };
  await mkdir(join(c.home, 'autopilots', run.id), { recursive: true });
  await writeFile(join(c.home, 'autopilots', run.id, 'run.json'), JSON.stringify(run));
  const settings = checkCostSettings({
    version: 1,
    accounts: [
      { id: 'shared', label: '共用账户', channel: 'codex', kind: 'usage', source: 'manual', balance: { amount: 2, currency: 'USD', scope: '两个模型共用', recordedAt: at, validUntil: '2027-01-01T00:00:00.000Z' } },
      { id: 'relay', label: '中转账户', channel: 'deepseek', kind: 'usage', source: 'relay' },
    ],
    bindings: [
      { account: 'shared', channel: 'codex', model: 'gpt-6-astra', effectiveAt: '2026-01-01T00:00:00.000Z' },
      { account: 'shared', channel: 'codex', model: 'gpt-6-luna', effectiveAt: '2026-01-01T00:00:00.000Z' },
      { account: 'relay', channel: 'deepseek', model: 'deepseek-v4-pro', effectiveAt: '2026-01-01T00:00:00.000Z' },
    ],
    prices: [
      { id: 'astra', account: 'shared', model: 'gpt-6-astra', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: at, read: 1_000_000, cached: 1_000_000, out: 1_000_000 },
      { id: 'luna', account: 'shared', model: 'gpt-6-luna', currency: 'USD', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: at, read: 1_000_000, cached: 1_000_000, out: 1_000_000 },
      { id: 'ds', account: 'relay', model: 'deepseek-v4-pro', currency: 'CNY', per: 'million', effectiveAt: '2026-01-01T00:00:00.000Z', recordedAt: at, read: 1_000_000, cached: 1_000_000, out: 1_000_000 },
    ],
    experiences: [{ id: 'old', subject: '过期对照', basis: '一次做完', factor: { numerator: 1, denominator: 3 }, scope: '不再引用', recordedAt: '2026-10-01T00:00:00.000Z', validUntil: '2026-10-02T00:00:00.000Z' }],
  });
  await writeFile(join(c.home, 'cost.json'), JSON.stringify(settings));
  const snap = quota(new Date().toISOString());
  snap.providers.find(item => item.icon === 'codex')!.at = '2026-10-01T00:00:00.000Z';
  await writeFile(join(c.home, 'cache', 'quota.json'), JSON.stringify(snap));
  const costPath = join(c.home, 'cost.json');
  const before = { cost: await readFile(costPath, 'utf8'), jobs: (await readdir(join(c.home, 'jobs'))).sort(), home: (await readdir(c.home)).sort() };
  const { guideAppendix } = await import('../src/core/guide.ts');
  const installed = await guideAppendix({ found: async () => true });
  const missing = await guideAppendix({ found: async icon => icon !== 'codex' });
  const adviceLine = installed.split('\n').find(line => line.includes('数据时间 2026-10-01T00:00:00.000Z'));
  assert.ok(adviceLine);
  assert.match(adviceLine!, /过期/);
  assert.doesNotMatch(adviceLine!, /到停派线还剩/);
  assert.match(installed, /共用账户/);
  assert.match(installed, /当前余额 2 USD/);
  assert.match(installed, /写手按 Codex/);
  assert.doesNotMatch(installed, /写手按 Codex · Luna/);
  assert.match(installed, /找不到任务 missing-job/);
  assert.doesNotMatch(installed, /找不到任务 diag|找不到任务 impl/);
  assert.match(installed, /别的项目/);
  assert.match(installed, /中转账户/);
  assert.match(installed, /预算余额未知/);
  assert.doesNotMatch(installed, /优先 DeepSeek/);
  assert.match(installed, /已过期，不作为依据/);
  assert.doesNotMatch(installed, /优先 Codex/);
  assert.match(missing, /没找到 Codex/);
  assert.doesNotMatch(missing, /优先 Codex/);
  assert.equal(await readFile(costPath, 'utf8'), before.cost);
  assert.deepEqual((await readdir(join(c.home, 'jobs'))).sort(), before.jobs);
  assert.deepEqual((await readdir(c.home)).sort(), before.home);
  assert.equal((await readdir(c.home)).includes('worktrees'), false);
});
