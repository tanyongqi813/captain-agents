// 只读派活参考（TASK-015）。比较完成整件任务的成本，不派发、不换人、不绕过额度检查。
// 顺序固定：能不能达标，完成总成本，期限，最后才看剩余额度。余额高不是首选理由。
import { active } from './job.ts';
import type { Job } from './job.ts';
import { checkQuota, quotaBar, quotaPool, quotaPoints } from './quota.ts';
import type { QuotaSnapshot } from './quota.ts';
import type { QuotaStop } from './settings.ts';
import type { WorkersPolicy } from './policy.ts';
import { isWho, spec, vendorOf, isolationOf, keptWhos, launchModel, allowedEfforts, supportsFast } from './roster.ts';
import type { Vendor, Who } from './roster.ts';
import type { CostSettings } from './cost-settings.ts';
import { accountViews } from './cost-settings.ts';
import type { CostExperience } from './cost-settings.ts';
import { buildLedger } from './task-cost.ts';
import type { TaskLedger } from './task-cost.ts';
import type { AutopilotRun } from './autopilot.ts';
import { samePath } from './platform.ts';

const FRESH_MS = 600_000;

export type AdviceSample = {
  who: Who; kind: string; accepted: boolean; rounds: number;
  currency: string | null; amount: number | null; basis: 'actual' | 'estimate' | 'unknown';
  seconds: number | null; score: number | null;
  // 不能确认是这位写手独立达标时为 false。换人合计可以留着金额，但不进能力比较。
  capability?: boolean;
  note?: string;
};
export type AdviceBudget = {
  account: string; channel: Vendor; source: 'official' | 'relay' | 'manual'; kind: 'subscription' | 'usage' | 'package' | 'local';
  currency?: string; remaining: number | null; expired: boolean; models: string[];
};
export type DispatchAdviceInput = {
  now: string;
  kind: string;
  deadlineSeconds?: number | null;
  difficulty?: 'unknown' | 'high';
  mode?: 'new' | 'next';
  quotaStop: QuotaStop;
  quota: QuotaSnapshot | null;
  workers: WorkersPolicy;
  jobs: readonly Job[];
  samples: readonly AdviceSample[];
  budgets?: readonly AdviceBudget[];
  experiences?: readonly CostExperience[];
  remarks?: readonly string[];
  unavailable?: readonly { who: Who; reason: string }[];
  forward?: readonly { who: Who; currency: string; amount: number; seconds?: number | null }[];
  sunk?: { currency: string; amount: number } | null;
  recoveryCap?: { currency: string; amount: number } | null;
  progress?: 'none' | 'some';
  quotaDeltas?: readonly { who: Who; before?: QuotaSnapshot | null; after?: QuotaSnapshot | null; shared?: boolean }[];
};
export type AdviceWindow = { label: string; used: number | null; reset: string | null; headroom: number | null };
export type CandidateAdvice = {
  who: Who; pool: string; sharedWith: Who[]; windows: AdviceWindow[];
  dataAt: string | null; inflight: number;
  gate: 'pass' | 'block' | 'uncertain';
  uncertain: string[];
  fullCost: { currency: string; low: number; high: number; basis: 'actual' | 'estimate'; samples: number } | null;
  deadline: 'inside' | 'outside' | 'unknown';
  // 能不能拿来比较，只看这个状态，不看展示句子。
  fund: 'ready' | 'unknown' | 'short';
};
export type DispatchAdvice = {
  decisionOrder: readonly ['预计可达标', '完成总成本', '期限', '剩余额度'];
  preference: Who | null;
  action: 'suggest' | 'wait' | 'ask';
  reason: string;
  candidates: CandidateAdvice[];
  notes: string[];
};

const order = ['预计可达标', '完成总成本', '期限', '剩余额度'] as const;
const poolKey = (who: Who) => `${vendorOf(who)}:${quotaPool(who).label}`;
const official = (who: Who) => vendorOf(who) === isolationOf(who);

function providerClock(at: string | null | undefined, now: number): 'fresh' | 'stale' | 'invalid' {
  const parsed = Date.parse(at ?? '');
  if (!at || !Number.isFinite(parsed) || parsed > now) return 'invalid';
  return now - parsed <= FRESH_MS ? 'fresh' : 'stale';
}
function windowsOf(who: Who, quota: QuotaSnapshot | null, quotaStop: QuotaStop, now: number): AdviceWindow[] {
  if (!official(who) || !quota) return [];
  const entry = quota.providers.find(item => item.icon === isolationOf(who));
  if (!entry) return [];
  const fresh = providerClock(entry.at, now) === 'fresh' && !entry.error;
  const bars = isolationOf(who) === 'kimi' ? entry.bars : entry.bars.filter(bar => bar.label === quotaPool(who).label);
  return bars.map(bar => ({
    label: bar.label,
    used: bar.used,
    reset: bar.reset,
    headroom: !fresh || quotaStop === null || bar.used === null || bar.approx ? null : quotaStop - bar.used,
  }));
}
function quotaGate(who: Who, input: DispatchAdviceInput, now: number): { gate: CandidateAdvice['gate']; uncertain: string[] } {
  const uncertain: string[] = [];
  if (!official(who)) return { gate: 'uncertain', uncertain: ['不占官方套餐，要看单独的预算'] };
  if (!input.quota) return { gate: 'uncertain', uncertain: ['没有额度数据，不能当成零消耗或无限余额'] };
  const entry = input.quota.providers.find(item => item.icon === isolationOf(who));
  const clock = providerClock(entry?.at, now);
  if (!entry || entry.error) uncertain.push(entry?.error ? '这次没查到，沿用的旧数不能当成当前可派' : '额度查不到，不能当成零消耗或无限余额');
  else if (clock === 'stale') uncertain.push('这家的额度数据已过期，不能当成当前可派');
  else if (clock === 'invalid') uncertain.push('额度时间无效，不能当成当前可派');
  const bars = windowsOf(who, input.quota, input.quotaStop, now);
  if (bars.length === 0) uncertain.push('额度查不到，不能当成零消耗或无限余额');
  if (bars.some(bar => bar.used === null)) uncertain.push('用量未知，不能当成 0 或无限');
  if (entry?.bars.some(bar => bar.approx && (isolationOf(who) === 'kimi' || bar.label === quotaPool(who).label))) uncertain.push('用量是近似值，不能当成确定余量');
  if (bars.some(bar => bar.reset === null)) uncertain.push('重置时间未知，不推算月底余额');
  try { checkQuota(input.quota, [{ who }], false, input.quotaStop); }
  catch (error) { return { gate: 'block', uncertain: [error instanceof Error ? error.message : String(error), ...uncertain] }; }
  if (uncertain.length) return { gate: 'uncertain', uncertain };
  return { gate: 'pass', uncertain };
}

function comparable(samples: readonly AdviceSample[], who: Who, kind: string) {
  return samples.filter(sample => sample.who === who && sample.kind === kind && sample.capability !== false && sample.accepted && sample.amount !== null && sample.currency);
}
function costOf(samples: AdviceSample[]): CandidateAdvice['fullCost'] {
  if (!samples.length) return null;
  const currencies = [...new Set(samples.map(sample => sample.currency!))];
  if (currencies.length !== 1) return null;
  const amounts = samples.map(sample => sample.amount!);
  const basis = samples.every(sample => sample.basis === 'actual') ? 'actual' as const : 'estimate' as const;
  return { currency: currencies[0]!, low: Math.min(...amounts), high: Math.max(...amounts), basis, samples: samples.length };
}
function deadlineOf(seconds: number | null, limit: number | null | undefined): CandidateAdvice['deadline'] {
  if (limit === undefined || limit === null || seconds === null) return 'unknown';
  return seconds <= limit ? 'inside' : 'outside';
}
function knownModels(who: Who): string[] {
  const models = [spec(who).model];
  for (const fast of supportsFast(who) ? [false, true] : [false]) {
    for (const effort of allowedEfforts(who)) models.push(launchModel(who, effort, fast));
  }
  return [...new Set(models)];
}
function budgetStanding(who: Who, budgets: readonly AdviceBudget[], amount: number | null, currency: string | null, gate: CandidateAdvice['gate']): { fund: CandidateAdvice['fund']; note: string | null } {
  if (gate === 'block') return { fund: 'short', note: null };
  const rows = budgets.filter(item => item.kind === 'usage' && item.channel === vendorOf(who));
  const models = knownModels(who);
  const matched = rows.filter(item => item.models.some(model => models.includes(model)));
  if (!official(who) && !matched.length) return { fund: 'unknown', note: rows.length ? '预算模型和这位选手对不上，不能当成够用' : '没有单独的预算余额，不能当成够用' };
  if (official(who) && gate !== 'pass') return { fund: 'unknown', note: null };
  if (!matched.length) return { fund: rows.length ? 'unknown' : 'ready', note: rows.length ? '预算模型和这位选手对不上，不能当成够用' : null };
  if (amount === null || !currency) return official(who) ? { fund: 'ready', note: null } : { fund: 'unknown', note: '没有可比较的费用，不能判断预算够不够' };
  if (matched.some(item => item.expired)) return { fund: 'unknown', note: '预算余额已过期，不能当成够用' };
  if (matched.some(item => item.remaining === null)) return { fund: 'unknown', note: '预算余额未知，不能当成 0 或无限' };
  if (matched.some(item => item.currency !== currency)) return { fund: 'unknown', note: '预算币种不同，不能当成够用' };
  if (matched.some(item => (item.remaining ?? 0) < amount)) return { fund: 'short', note: '预算不够，只影响这次参考，不会在这里拦截派发' };
  return { fund: 'ready', note: null };
}

export function dispatchAdvice(input: DispatchAdviceInput): DispatchAdvice {
  const now = Date.parse(input.now);
  const notes: string[] = [];
  if (input.sunk) notes.push(`已耗成本 ${input.sunk.amount} ${input.sunk.currency} 单独保留，不拿它决定要不要继续`);
  for (const budget of input.budgets ?? []) {
    const names = keptWhos.filter(who => vendorOf(who) === budget.channel && budget.models.some(model => knownModels(who).includes(model))).map(who => spec(who).name);
    if (budget.source === 'relay') notes.push(`${names.join('、') || budget.account} 的中转费用单独计算，不能套官方套餐`);
    if (budget.kind === 'subscription' || budget.kind === 'package') notes.push(`${names.join('、') || budget.account} 的官方额度按窗口百分比展示，不把月费折成单次费用`);
    if (budget.kind === 'usage' && names.length > 1) notes.push(`付款账户 ${budget.account} 的余额由 ${names.join('、')} 共用`);
    if (budget.kind === 'usage' && budget.expired) notes.push(`付款账户 ${budget.account} 的余额已过期，不能当成够用`);
    if (budget.kind === 'usage' && !budget.expired && budget.remaining === null) notes.push(`付款账户 ${budget.account} 的预算余额未知，不能当成 0 或无限`);
    if (budget.kind === 'usage' && !budget.expired && budget.remaining !== null) notes.push(`付款账户 ${budget.account} 当前余额 ${budget.remaining} ${budget.currency ?? ''}`.trim());
  }
  for (const sample of input.samples) if (sample.note) notes.push(sample.note);
  for (const remark of input.remarks ?? []) notes.push(remark);
  for (const row of input.quotaDeltas ?? []) {
    if (quotaPoints(quotaBar(row.before, row.who), quotaBar(row.after, row.who)) === null) notes.push(`${spec(row.who).name} 的额度快照跨重置或不可比，不能折成这件任务的成本`);
    if (row.shared) notes.push(`${spec(row.who).name} 的额度差值来自共享池，不能摊成单任务成本`);
  }
  const activeJobs = input.jobs.filter(active);
  const candidates = keptWhos.filter(isWho).map(who => {
    const same = keptWhos.filter(item => item !== who && poolKey(item) === poolKey(who));
    const inflight = activeJobs.filter(job => isWho(job.who) && poolKey(job.who) === poolKey(who)).length;
    if (inflight > 1) notes.push(`${quotaPool(who).name} 的${quotaPool(who).label}有多件在途，负担共享，不能把差额算成一件的成本`);
    const samples = comparable(input.samples, who, input.kind);
    const fullCost = costOf(samples);
    const gate = quotaGate(who, input, now);
    const uncertain = [...gate.uncertain];
    const closed = input.workers[who]?.enabled !== true;
    const missing = input.unavailable?.find(item => item.who === who)?.reason;
    const forward = (input.forward ?? []).find(row => row.who === who);
    const compared = input.mode === 'next' ? forward : fullCost ? { amount: fullCost.high, currency: fullCost.currency } : null;
    const standing = budgetStanding(who, input.budgets ?? [], compared?.amount ?? null, compared?.currency ?? null, gate.gate);
    if (standing.note) uncertain.push(standing.note);
    if (closed) uncertain.push('主人关掉了这位选手');
    if (missing) uncertain.push(missing);
    const blocked = closed || !!missing || gate.gate === 'block';
    const historicalSeconds = samples.length > 0 && samples.every(item => typeof item.seconds === 'number') ? Math.max(...samples.map(item => item.seconds!)) : null;
    const seconds = input.mode === 'next' ? (forward?.seconds ?? null) : historicalSeconds;
    return {
      who, pool: `${quotaPool(who).name}·${quotaPool(who).label}`, sharedWith: same, windows: windowsOf(who, input.quota, input.quotaStop, now),
      dataAt: input.quota?.providers.find(item => item.icon === isolationOf(who))?.at ?? null,
      inflight, gate: blocked ? 'block' as const : gate.gate, uncertain, fullCost,
      deadline: deadlineOf(seconds, input.deadlineSeconds), fund: standing.fund,
    };
  });
  const seen = new Set<string>();
  const uniqueNotes = notes.filter(note => seen.has(note) ? false : (seen.add(note), true));
  const currencies = [...new Set(candidates.flatMap(item => item.fullCost ? [item.fullCost.currency] : []))];
  if (currencies.length > 1) uniqueNotes.push('完成成本的货币不同，没有换算依据，不做价格排名');
  const experiences = (input.experiences ?? []).filter(item => experienceCurrent(item, now));
  for (const item of input.experiences ?? []) if (!experienceCurrent(item, now)) uniqueNotes.push(`人工参考「${item.subject}」未生效或已过期，不作为依据`);
  if (experiences.length && candidates.every(item => !item.fullCost)) {
    uniqueNotes.push(experiences.map(item => experienceLine(item)).join(''));
  }
  const forwardOf = (who: Who) => (input.forward ?? []).find(row => row.who === who);
  const viable = candidates.filter(item => {
    if (item.gate === 'block' || item.fund !== 'ready' || !item.fullCost) return false;
    if (currencies.length > 1) return false;
    if (input.deadlineSeconds != null && item.deadline !== 'inside') return false;
    if (input.mode === 'next') {
      const next = forwardOf(item.who);
      if (!next || next.currency !== item.fullCost.currency) return false;
      if (input.recoveryCap && (next.currency !== input.recoveryCap.currency || next.amount > input.recoveryCap.amount)) return false;
    }
    return true;
  });
  const noProgress = input.progress === 'none';
  const hard = input.difficulty === 'high' && candidates.every(item => !item.fullCost);
  let preference: Who | null = null;
  let action: DispatchAdvice['action'] = 'ask';
  let reason = '样本不足，需负责人判断';
  if (noProgress) reason = '这件任务没有实质进展，建议求助，不继续无限重试';
  else if (hard) reason = '高难任务没有合适样本，建议求助，不降低验收要求';
  else if (currencies.length > 1) reason = '完成成本的货币不同，不能排名，需负责人判断';
  else if (viable.length) {
    const ranked = [...viable].sort((a, b) => {
      const left = input.mode === 'next' ? forwardOf(a.who)!.amount : a.fullCost!.high;
      const right = input.mode === 'next' ? forwardOf(b.who)!.amount : b.fullCost!.high;
      return left - right || a.who.localeCompare(b.who);
    });
    const nextCost = input.mode === 'next' ? forwardOf(ranked[0]!.who) : null;
    preference = ranked[0]!.who;
    action = 'suggest';
    const cost = nextCost ? `${nextCost.amount} ${nextCost.currency}` : `${ranked[0]!.fullCost!.low === ranked[0]!.fullCost!.high ? ranked[0]!.fullCost!.high : `${ranked[0]!.fullCost!.low}–${ranked[0]!.fullCost!.high}`} ${ranked[0]!.fullCost!.currency}`;
    reason = `优先 ${spec(preference).name}：从现在比较的是完成整件任务的成本 ${cost}。不按单次分数、返工次数或余额高低挑选`;
    if (input.mode === 'next') reason += '。已耗成本不计入这一步';
    const count = comparable(input.samples, preference, input.kind).length;
    reason += `。难度未知，不按难度分组，同类样本 ${count} 件${count < 3 ? '，样本少' : ''}，可信度低`;
  } else if (candidates.some(item => item.gate === 'block' || item.deadline === 'outside')) {
    action = 'wait';
    reason = '没有又达标、又赶得上期限、又没超预算的选手，建议等待';
  }
  return { decisionOrder: order, preference, action, reason, candidates, notes: uniqueNotes };
}

function experienceCurrent(item: CostExperience, now: number): boolean {
  if (!Number.isFinite(Date.parse(item.recordedAt)) || Date.parse(item.recordedAt) > now) return false;
  if (item.validFrom !== undefined && Date.parse(item.validFrom) > now) return false;
  if (item.validUntil !== undefined && Date.parse(item.validUntil) <= now) return false;
  return true;
}
function experienceLine(item: CostExperience): string {
  return `人工参考：${item.subject} 约为 ${item.basis} 的 ${item.factor.numerator}/${item.factor.denominator}（${item.scope}，记于 ${item.recordedAt}）。这不是报价，也不据此派发。`;
}

export function budgetsFromSettings(settings: CostSettings, now: string): AdviceBudget[] {
  return accountViews(settings, now).map(view => ({
    account: view.label || view.id, channel: view.channel, source: view.source, kind: view.kind,
    ...(view.balance ? { currency: view.balance.currency } : {}),
    remaining: view.kind === 'usage' && view.balance && !view.balance.expired ? view.balance.amount : null,
    expired: view.kind === 'usage' && view.balance?.expired === true,
    models: view.models,
  }));
}

export function sampleFromLedger(ledger: TaskLedger, meta: Omit<AdviceSample, 'currency' | 'amount' | 'basis'>): AdviceSample {
  const rollup = ledger.spent.length === 1 ? ledger.spent[0] : undefined;
  const complete = ledger.coverage === 'complete' && !!rollup?.complete && ledger.spent.length === 1;
  const actual = complete && ledger.lines.filter(line => !line.withheld).every(line => line.actual);
  return { ...meta, currency: complete ? rollup!.currency : null, amount: complete ? rollup!.knownSubtotal : null, basis: complete ? (actual ? 'actual' : 'estimate') : 'unknown' };
}

function mentioned(runs: readonly AutopilotRun[], job: string, pick: (run: AutopilotRun) => { jobs?: string[] }[] | undefined) {
  return runs.some(run => pick(run)?.some(item => item.jobs?.includes(job)));
}
function writerJob(job: Job, runs: readonly AutopilotRun[]): boolean {
  if (job.autopilotRole === 'reviewer' || job.team?.role === 'reviewer' || job.mode === 'read-only') return false;
  if (mentioned(runs, job.id, run => run.attempts) || job.autopilotRole === 'writer' || job.team?.role === 'writer') return true;
  if (mentioned(runs, job.id, run => run.diagnoses) || mentioned(runs, job.id, run => run.flow?.reviews)) return false;
  return true;
}
function reliableSpan(from: string | undefined, to: string | undefined, seconds: number | undefined): { from: number; to: number } | null {
  const start = Date.parse(from ?? '');
  const end = Date.parse(to ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  if (Math.abs(Math.round((end - start) / 1000) - seconds) > 1) return null;
  return { from: start, to: end };
}
// 和 wake.ts 的 foldRounds、任务账本的轮次窗口同一套：已归档的轮在 rounds 里；
// 当前轮还没归档时，起止和秒数在任务顶上。顶上的秒数在归档后变成各轮合计，不能再加一次。
function currentRoundArchived(job: Job): boolean {
  return job.state !== 'queued' && job.state !== 'running' && !!job.ended && !!job.started
    && !!job.rounds?.some(round => round.ended === job.ended);
}
function flowSeconds(jobs: readonly Job[]): number | null {
  const spans: { from: number; to: number }[] = [];
  for (const job of jobs) {
    if (job.state === 'queued' || job.state === 'running') return null;
    const rounds = job.rounds ?? [];
    for (const round of rounds) {
      const span = reliableSpan(round.started, round.ended, round.seconds);
      if (!span) return null;
      spans.push(span);
    }
    if (currentRoundArchived(job)) continue;
    if (!rounds.length) {
      const span = reliableSpan(job.started, job.ended, job.seconds);
      if (!span) return null;
      spans.push(span);
      continue;
    }
    const staleStart = !!job.started && rounds.some(round => round.started === job.started);
    if (staleStart || !job.ended) return null;
    const current = reliableSpan(job.started, job.ended, job.seconds);
    if (!current) return null;
    spans.push(current);
  }
  if (!spans.length) return null;
  spans.sort((left, right) => left.from - right.from || left.to - right.to);
  let total = 0;
  let from = spans[0]!.from;
  let to = spans[0]!.to;
  for (const span of spans.slice(1)) {
    if (span.from <= to) to = Math.max(to, span.to);
    else { total += to - from; from = span.from; to = span.to; }
  }
  return Math.round((total + to - from) / 1000);
}
function verifyOk(job: Job | undefined): boolean | undefined {
  const ok = (job?.verify as { ok?: boolean } | undefined)?.ok;
  return typeof ok === 'boolean' ? ok : undefined;
}

export type JobSamples = { samples: AdviceSample[]; notes: string[] };
export function samplesFromJobs(jobs: readonly Job[], settings: CostSettings, now: string, runs: readonly AutopilotRun[] = []): JobSamples {
  const groups: { project: string; repo: string; taskId: string; jobs: Job[]; runs: AutopilotRun[] }[] = [];
  const take = (project: string, repo: string, taskId: string) => {
    const found = groups.find(item => item.project === project && item.taskId === taskId && samePath(item.repo, repo));
    if (found) return found;
    const created = { project, repo, taskId, jobs: [] as Job[], runs: [] as AutopilotRun[] };
    groups.push(created);
    return created;
  };
  for (const job of jobs) if (job.plan?.taskId && isWho(job.who)) take(job.project, job.repo, job.plan.taskId).jobs.push(job);
  for (const run of runs) take(run.project, run.repo, run.taskId).runs.push(run);
  const samples: AdviceSample[] = [];
  const notes: string[] = [];
  for (const group of groups) {
    const linked = [...new Set(group.runs.flatMap(run => [...run.attempts, ...(run.flow?.reviews ?? []), ...(run.diagnoses ?? [])].flatMap(item => item.jobs ?? [])))];
    const related = new Map(group.jobs.map(job => [job.id, job]));
    for (const id of linked) {
      const job = jobs.find(item => item.id === id);
      if (!job || !isWho(job.who) || job.project !== group.project || !samePath(job.repo, group.repo) || related.has(job.id)) continue;
      related.set(job.id, job);
    }
    const ordered = [...related.values()].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    const outsideRefs = linked.filter(id => {
      const job = jobs.find(item => item.id === id);
      return !!job && (job.project !== group.project || !samePath(job.repo, group.repo));
    });
    const ledger = buildLedger({
      taskId: group.taskId, project: { name: group.project, repo: group.repo }, jobs: ordered, runs: group.runs, settings, now, outsideRefs,
    });
    const writers = ordered.filter(job => writerJob(job, group.runs));
    const latest = writers.at(-1);
    const writerWhos = [...new Set(writers.map(job => job.who))];
    const handoff = ledger.lines.some(line => line.phase === 'handoff') || writerWhos.length > 1;
    const who = writerWhos.length === 1 ? writerWhos[0] : latest?.who;
    if (!who || !isWho(who)) {
      notes.push([`${group.project} 的 ${group.taskId}`, ledger.gaps.join('；'), '没有可确认的写手，不把审查或诊断当成实现达标'].filter(Boolean).join('：').replace('：：', '：'));
      continue;
    }
    const passed = verifyOk(latest) === true && latest?.state !== 'failed' && latest?.state !== 'stopped' && latest?.state !== 'lost';
    const row = sampleFromLedger(ledger, {
      who, kind: latest?.kind ?? ordered[0]?.kind ?? '实现', accepted: false, capability: false, rounds: writers.length, score: null,
      seconds: flowSeconds(ordered),
    });
    const capability = passed && !handoff && row.amount !== null && ledger.coverage === 'complete';
    row.capability = capability;
    row.accepted = capability;
    const detail = [
      `这件任务的写手按 ${spec(who).name} 记`,
      handoff ? '换人后的合计留在账上，不能当成最后一位的单独完成能力' : '',
      !passed ? '最后一次实现没有验收通过，早前通过不算这件任务达标' : '',
      ledger.coverage !== 'complete' ? (ledger.gaps.join('；') || '成本不完整，不能当成可比较样本') : '',
    ].filter(Boolean);
    row.note = detail.join('。');
    samples.push(row);
  }
  return { samples, notes };
}

function gateText(item: CandidateAdvice): string {
  if (item.gate === 'block') return '不能派';
  if (item.fund === 'unknown') return '预算或额度不确定，不能据此派发';
  if (item.fund === 'short') return '预算不够，只影响这次参考';
  if (item.gate === 'uncertain') return '官方额度不适用，单独预算够这次参考，仍要等真正派发时再查';
  return '额度没有拦住，仍要等真正派发时再查';
}
export function formatDispatchAdvice(advice: DispatchAdvice): string {
  const lines = ['### 派活参考（只读，不派发）', '',
    '先看能不能达标，再比完成整件任务的成本，然后看期限，最后才看剩余额度。这里不派发、不换人，也不跳过额度、策略或登录检查。', ''];
  for (const item of advice.candidates) {
    const shared = item.sharedWith.length ? `，与 ${item.sharedWith.map(who => spec(who).name).join('、')} 同池共享` : '';
    const windows = item.windows.length ? item.windows.map(bar => `${bar.label} ${bar.used === null ? '查不到' : `${bar.used}%`}${bar.headroom === null ? '' : `，到停派线还剩 ${bar.headroom} 个点`}，${bar.reset ? `重置 ${bar.reset}` : '重置时间未知'}`).join('；') : '无官方窗口';
    const deadline = item.deadline === 'inside' ? '期限内' : item.deadline === 'outside' ? '超期限' : '期限不明';
    const cost = item.fullCost ? `完成成本 ${item.fullCost.low === item.fullCost.high ? item.fullCost.high : `${item.fullCost.low}–${item.fullCost.high}`} ${item.fullCost.currency}（${item.fullCost.samples} 件，${item.fullCost.basis === 'actual' ? '实际账单' : '估算'}）` : '没有可比较的完成成本';
    const facts = [item.dataAt ? `数据时间 ${item.dataAt}` : '没有这家的数据时间', item.uncertain.length ? `不确定：${item.uncertain.join('、')}` : ''].filter(Boolean).join('；');
    lines.push(`- ${spec(item.who).name}：${gateText(item)}；${facts}；${item.pool}${shared}；在途 ${item.inflight}；${windows}；${deadline}；${cost}`);
  }
  lines.push('', advice.reason, ...advice.notes);
  return lines.join('\n');
}

export type { TaskLedger };
