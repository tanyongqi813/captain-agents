import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createJob } from '../src/core/job.ts';
import type { Job } from '../src/core/job.ts';
import { ensureHome } from '../src/core/paths.ts';
import { accountViews, checkCostSettings, readCostSettings, updateCostSettings } from '../src/core/cost-settings.ts';
import type { CostSettings } from '../src/core/cost-settings.ts';
import { context } from './helpers.ts';

const now = '2026-10-19T00:00:00.000Z';
const balance = { amount: 10, currency: 'USD', scope: '这个付款账户', recordedAt: '2026-10-01T00:00:00.000Z', validUntil: '2026-12-01T00:00:00.000Z' };
const experience = {
  id: 'exp-ds', subject: '某类实现来回改几轮', basis: '另一类一次做完', factor: { numerator: 1, denominator: 3 },
  scope: '只作人工对照，不是厂商标价', recordedAt: '2026-10-01T00:00:00.000Z', validFrom: '2026-10-01T00:00:00.000Z', validUntil: '2026-11-01T00:00:00.000Z',
};

function settings(): CostSettings {
  return checkCostSettings({
    version: 1,
    accounts: [
      { id: 'acct-ds', label: 'DeepSeek 付款甲', channel: 'deepseek', kind: 'usage', source: 'relay', balance },
      { id: 'acct-other', label: '另一笔付款', channel: 'codex', kind: 'usage', source: 'official', balance: { ...balance, amount: 3, currency: 'CNY' } },
      { id: 'acct-kimi', label: 'Kimi 官方', channel: 'kimi', kind: 'subscription', source: 'official',
        windows: [{ label: '5 小时', recordedAt: '2026-10-18T00:00:00.000Z', usedPercent: 40, validUntil: '2026-10-20T00:00:00.000Z' }] },
    ],
    bindings: [
      { account: 'acct-ds', channel: 'deepseek', model: 'deepseek-v4-pro', effectiveAt: '2026-01-01T00:00:00.000Z' },
      { account: 'acct-ds', channel: 'deepseek', model: 'deepseek-flash', effectiveAt: '2026-01-01T00:00:00.000Z' },
      { account: 'acct-other', channel: 'codex', model: 'gpt-6-astra', effectiveAt: '2026-01-01T00:00:00.000Z' },
      { account: 'acct-kimi', channel: 'kimi', model: 'kimi-code/kimi-for-coding', effectiveAt: '2026-01-01T00:00:00.000Z' },
    ],
    prices: [],
    experiences: [experience],
  });
}

async function useHome(t: Parameters<typeof context>[0]) {
  const c = await context(t, false), previous = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (previous === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = previous; });
  return c;
}

test('同账户多模型共用一份余额，不同账户不加总；订阅窗口不折成金额', () => {
  const views = accountViews(settings(), now);
  const shared = views.find(item => item.id === 'acct-ds')!;
  const other = views.find(item => item.id === 'acct-other')!;
  const official = views.find(item => item.id === 'acct-kimi')!;
  assert.deepEqual(shared.models, ['deepseek-v4-pro', 'deepseek-flash']);
  assert.equal(shared.balance?.amount, 10);
  assert.equal(shared.balance?.currency, 'USD');
  assert.equal(other.models.length, 1);
  assert.equal(other.balance?.amount, 3);
  assert.equal(other.balance?.currency, 'CNY');
  assert.notEqual(shared.balance?.amount, other.balance?.amount);
  assert.equal(official.balance, null);
  assert.equal(official.windows[0]?.usedPercent, 40);
  assert.equal(official.kind, 'subscription');
});

test('拒绝网址、密钥字段、中转套官方额度、重复绑定和把未知补成 0', () => {
  const base = settings();
  assert.throws(() => checkCostSettings({ ...base, accounts: base.accounts.map(item => item.id === 'acct-ds' ? { ...item, label: 'https://user:pass@relay.example/v1' } : item) }), /名称/);
  assert.throws(() => checkCostSettings({ ...base, token: 'secret' }), /不能保存的字段/);
  assert.throws(() => checkCostSettings({ ...base, accounts: [...base.accounts, { id: 'acct-bad', label: '中转套餐', channel: 'kimi', kind: 'subscription', source: 'relay' }] }), /不能套用官方/);
  assert.throws(() => checkCostSettings({
    ...base,
    accounts: [...base.accounts, { id: 'acct-codex-2', label: '另一家 Codex', channel: 'codex', kind: 'usage', source: 'manual' }],
    bindings: [...base.bindings, { account: 'acct-codex-2', channel: 'codex', model: 'gpt-6-astra', effectiveAt: '2026-01-01T00:00:00.000Z' }],
  }), /两个付款账户/);
  assert.throws(() => checkCostSettings({ ...base, accounts: base.accounts.map(item => item.id === 'acct-ds' ? { ...item, balance: { amount: 0, currency: 'USD', scope: '范围' } } : item) }), /记录时间/);
  assert.throws(() => checkCostSettings({ ...base, prices: [{ id: 'price-1', account: 'acct-kimi', model: 'kimi-code/kimi-for-coding', effectiveAt: now, recordedAt: now, currency: 'USD', per: 'million', read: 1 }] }), /按量单价只能挂在按量账户/);
  assert.throws(() => checkCostSettings({ ...base, accounts: [...base.accounts, { id: 'acct-local', label: '本机', channel: 'codex', kind: 'local', source: 'manual', balance, local: { recordedAt: now } }] }), /不记金额/);
});

test('经验可以保存和修改，过期仍留着；改资料不改任务用量', async t => {
  const c = await useHome(t);
  await ensureHome();
  assert.deepEqual(await readCostSettings(), { version: 1, accounts: [], bindings: [], prices: [], experiences: [] });
  await updateCostSettings(current => { current.experiences.push(experience); });
  await updateCostSettings(current => {
    const row = current.experiences[0]!;
    row.factor = { numerator: 1, denominator: 4 };
    row.validUntil = '2026-10-10T00:00:00.000Z';
  });
  const saved = await readCostSettings();
  assert.equal(saved.experiences[0]?.factor.denominator, 4);
  assert.equal(saved.experiences[0]?.validUntil, '2026-10-10T00:00:00.000Z');
  assert.equal(accountViews(saved, now)[0], undefined);
  const job: Job = {
    id: '1019-cost', batch: 'b', project: 'p', repo: c.repo, base: 'abc', worktree: c.repo, branch: 'xa/1019-cost',
    who: 'codex', model: 'gpt-6-astra', effort: 'high', mode: 'workspace-write', kind: '实现', title: '旧记录', summary: '说明',
    state: 'stopped', created: '2026-09-01T00:00:00.000Z', usage: { read: 7, cached: 1, out: 2 },
  };
  await createJob(job);
  const file = join(c.home, 'jobs', job.id, 'job.json');
  const before = await readFile(file, 'utf8');
  await assert.rejects(updateCostSettings(() => { throw new Error('这次不写'); }), /这次不写/);
  await assert.rejects(updateCostSettings(current => { current.accounts.push({ id: 'acct-x', label: 'http://relay.example', channel: 'codex', kind: 'usage', source: 'manual' }); }), /名称/);
  assert.deepEqual(await readCostSettings(), saved);
  assert.equal(await readFile(file, 'utf8'), before);
  const [left, right] = await Promise.all([
    updateCostSettings(current => { current.experiences.push({ ...experience, id: 'exp-left', subject: '左边' }); }),
    updateCostSettings(current => { current.experiences.push({ ...experience, id: 'exp-right', subject: '右边' }); }),
  ]);
  assert.equal(left.experiences.length + right.experiences.length > 2, true);
  const both = await readCostSettings();
  assert.deepEqual(both.experiences.map(item => item.id).sort(), ['exp-ds', 'exp-left', 'exp-right']);
  assert.equal(await readFile(file, 'utf8'), before);
});
