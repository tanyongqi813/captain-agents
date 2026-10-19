// 只读成本账本（TASK-017）。从当前任务记录和无人看守登记归集，不复制一份会漂移的状态机，也不改 usage。
// 付款账户看这一轮启动时的绑定。价格必须盖住从启动到结束的整段；跨过切换又没有分段用量时不估价。
// Cursor 的 read 已含缓存写入。缺了这个字段就不能把输入当成已知费用。Codex、Grok 的记录本来就没有这项。
// 实际账单只认记录里已有的 billed。估算不叫实际扣费。
import { listAutopilots } from './autopilot.ts';
import { hasCode } from './fsx.ts';
import type { AutopilotAttempt, AutopilotDiagnosis, AutopilotReview, AutopilotRun } from './autopilot.ts';
import { listJobs } from './job.ts';
import type { Command, Job, Usage } from './job.ts';
import { loadProject } from './project.ts';
import { samePath } from './platform.ts';
import { safeName } from './paths.ts';
import { isWho, isolationOf, vendorOf } from './roster.ts';
import type { Vendor } from './roster.ts';
import { bindingForInterval, priceForInterval, readCostSettings } from './cost-settings.ts';
import type { BillingKind, CostExperience, CostSettings, Money, PriceVersion } from './cost-settings.ts';

export type CostPhase = 'implement' | 'review' | 'diagnose' | 'handoff';
export type KnownUsage = { fresh: number; cached: number; cacheWrite: number | null; out: number };
export type CostLine = {
  id: string; phase: CostPhase; jobId: string; round: number | null; who: string; model: string | null; state: string;
  account: string | null; kind: BillingKind | null; at: string;
  usage: KnownUsage | null; seconds: number | null;
  actual: Money | null; estimate: (Money & { priceId: string }) | null; knownSubtotal: Money | null;
  unknown: string[]; experienceIds: string[]; withheld: boolean;
};
export type CurrencyRollup = { currency: string; knownSubtotal: number; complete: boolean };
export type SharedObservation = { account: string; at: string; beforePercent?: number; afterPercent?: number };
export type LedgerGap = 'lead' | 'other-client' | 'bill';
export type TaskLedger = {
  taskId: string; project: { name: string; repo: string } | null; asOf: string;
  scope: string; coverage: 'complete' | 'incomplete'; gaps: string[];
  lines: CostLine[]; spent: CurrencyRollup[]; tokens: { known: KnownUsage; missing: number } | null;
  seconds: { known: number; missing: number };
  experiences: (CostExperience & { expired: boolean; amount: null })[];
  observations: (SharedObservation & { allocated: false })[];
};

type Call = {
  id: string; phase: CostPhase; jobId: string; round: number | null; who: string; model: string | null;
  state: string; at: string; from: string | null; to: string | null;
  usage: Usage | null; seconds: number | null; billed: Money | null; withheld: boolean;
};
type Pointer = { token: string; at?: string; jobs?: string[]; usage?: Usage; phase: Exclude<CostPhase, 'handoff'> };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12;
const currencyOf = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const add = (left: number, right: number) => left + right;
const SCOPE = '只含指定项目里、这个任务号下的任务记录和无人看守登记';

function billedOf(value: unknown): Money | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!finite(row.amount) || !currencyOf(row.currency)) return null;
  if (Object.keys(row).some(key => key !== 'amount' && key !== 'currency')) return null;
  return { amount: row.amount, currency: row.currency };
}
function usageOf(value: Usage | undefined): Usage | null {
  if (!value || !finite(value.read) || !finite(value.cached) || !finite(value.out)) return null;
  if (value.cacheWrite !== undefined && !finite(value.cacheWrite)) return null;
  return value;
}
function channelOf(who: string): Vendor | null {
  return isWho(who) ? vendorOf(who) : null;
}
function openRound(job: Job): number {
  return job.resume?.round ?? ((job.rounds?.at(-1)?.n ?? 0) + 1);
}
// foldRounds 收尾后，当前轮已经按结束时间写进 rounds，job.usage 和 seconds 改成各轮合计。
function summarized(job: Job): boolean {
  if (job.state === 'queued' || job.state === 'running' || !job.ended || !job.started) return false;
  return !!job.rounds?.some(round => round.ended === job.ended);
}
function flagModel(args: readonly string[] | undefined): string | undefined {
  if (!args) return;
  for (let i = 0; i < args.length - 1; i++) if ((args[i] === '-m' || args[i] === '--model') && args[i + 1] && !args[i + 1]!.startsWith('-')) return args[i + 1];
}
function commandModel(command: Command | undefined): string | undefined {
  return flagModel(command?.args);
}
// 优先用这一轮启动参数里的模型。没有参数时，非 DeepSeek 的 job.model 是派活时记下的；DeepSeek 可能被配置改成另一个 ID，不能猜。
function launchedModel(job: Job, round: number): string | null {
  const own = commandModel(job.launches?.find(item => item.round === round)?.command);
  if (own) return own;
  if (round === openRound(job)) {
    const current = commandModel(job.command);
    if (current) return current;
  }
  const deepseek = isWho(job.who) && vendorOf(job.who) === 'deepseek';
  if (deepseek) return null;
  if (job.launches?.length) return null;
  return job.model || null;
}

// 续接排队时 job.started 还是上一轮或首轮的时间，不能拿来给定价窗口，也不能把上一轮的秒数算进这一轮。
function openWindow(job: Job, now: string): { from: string | null; to: string | null; seconds: number | null } {
  const rounds = job.rounds ?? [];
  const stale = !!job.started && rounds.some(round => round.started === job.started);
  const ownStart = job.started && !stale ? job.started : null;
  const open = job.state === 'queued' || job.state === 'running';
  let from: string | null = ownStart;
  if (!from && rounds.length === 0 && !open) from = job.started ?? job.created;
  if (!from && rounds.length === 0 && open && job.started) from = job.started;
  const ended = job.ended ?? null;
  const to = from ? (ended ?? (open ? now : from)) : null;
  let seconds: number | null = null;
  if (from && rounds.length === 0 && finite(job.seconds)) seconds = job.seconds;
  else if (ownStart && ended && finite(job.seconds)) seconds = job.seconds;
  return { from, to, seconds };
}
function callsOf(job: Job, phase: CostPhase, now: string): Call[] {
  const billed = billedOf((job as Job & { billed?: unknown }).billed);
  const rounds = job.rounds ?? [];
  const calls: Call[] = rounds.map(round => ({
    id: `job/${job.id}/round/${round.n}`, phase, jobId: job.id, round: round.n, who: job.who, model: launchedModel(job, round.n),
    state: round.state, at: round.started, from: round.started, to: round.ended,
    usage: usageOf(round.usage), seconds: finite(round.seconds) ? round.seconds : null,
    billed: null, withheld: false,
  }));
  if (summarized(job)) {
    const host = calls.find(call => rounds.find(round => round.n === call.round)?.ended === job.ended);
    if (host && billed) host.billed = billed;
    return calls.length ? calls : [{
      id: `job/${job.id}/round/${openRound(job)}`, phase, jobId: job.id, round: openRound(job), who: job.who, model: launchedModel(job, openRound(job)),
      state: job.state, at: job.started || job.created, from: job.started ?? null, to: job.ended ?? null, usage: null, seconds: null, billed, withheld: false,
    }];
  }
  const n = openRound(job);
  const usage = usageOf(job.usage);
  const window = openWindow(job, now);
  const existing = calls.find(call => call.round === n);
  if (existing) {
    if (billed) existing.billed = billed;
    return calls;
  }
  calls.push({
    id: `job/${job.id}/round/${n}`, phase, jobId: job.id, round: n, who: job.who, model: launchedModel(job, n),
    state: job.state, at: window.from ?? job.created, from: window.from, to: window.to, usage, seconds: window.seconds, billed, withheld: false,
  });
  return calls;
}

function mentioned(runs: readonly AutopilotRun[], job: string, pick: (run: AutopilotRun) => { jobs?: string[] }[] | undefined) {
  return runs.some(run => pick(run)?.some(item => item.jobs?.includes(job)));
}
function roleOf(job: Job, runs: readonly AutopilotRun[]): Exclude<CostPhase, 'handoff'> {
  if (job.autopilotRole === 'reviewer' || job.team?.role === 'reviewer') return 'review';
  if (mentioned(runs, job.id, run => run.attempts) || job.autopilotRole === 'writer' || job.team?.role === 'writer') return 'implement';
  if (mentioned(runs, job.id, run => run.diagnoses)) return 'diagnose';
  if (mentioned(runs, job.id, run => run.flow?.reviews)) return 'review';
  return 'implement';
}
function handoffIds(jobs: readonly Job[], phase: Map<string, CostPhase>): Set<string> {
  const seen = new Set<string>();
  let failed = false;
  const ids = new Set<string>();
  for (const job of [...jobs].filter(item => phase.get(item.id) === 'implement').sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))) {
    if (failed && !seen.has(job.who)) ids.add(job.id);
    if (job.state === 'failed' || job.state === 'stopped' || job.state === 'lost') { failed = true; seen.add(job.who); }
  }
  return ids;
}
function pointers(run: AutopilotRun): Pointer[] {
  const row = (phase: Pointer['phase']) => (item: AutopilotAttempt | AutopilotReview | AutopilotDiagnosis): Pointer => ({
    token: item.token, at: item.at, jobs: item.jobs, usage: usageOf(item.usage) ?? undefined, phase,
  });
  return [...run.attempts.map(row('implement')), ...(run.flow?.reviews ?? []).map(row('review')), ...(run.diagnoses ?? []).map(row('diagnose'))];
}

function accountFor(settings: CostSettings, who: string, model: string | null, from: string, to: string): { id: string; kind: BillingKind; crossed: boolean } | null | 'ambiguous' | 'unknown-model' {
  if (!model) return 'unknown-model';
  const channel = channelOf(who);
  if (!channel) return null;
  const found = bindingForInterval(settings, channel, model, from, to);
  if (found.status === 'ambiguous') return 'ambiguous';
  if (found.status !== 'bound') return null;
  const account = settings.accounts.find(item => item.id === found.binding.account);
  return account ? { id: account.id, kind: account.kind, crossed: found.crossed } : null;
}
// Codex / Grok 的解析结果本来就不带缓存写入。Cursor 旧记录缺这个字段时，输入里可能已经含着写入。
function cacheWritePolicy(who: string): 'not-applicable' | 'unknown' {
  if (!isWho(who)) return 'unknown';
  const isolation = isolationOf(who);
  if (isolation === 'codex' || isolation === 'grok') return 'not-applicable';
  return 'unknown';
}

export function splitUsage(usage: Usage): { fresh: number; cached: number; cacheWrite: number | null; out: number } | null {
  if (usage.cached > usage.read) return null;
  if (usage.cacheWrite === undefined) return { fresh: usage.read - usage.cached, cached: usage.cached, cacheWrite: null, out: usage.out };
  if (usage.cached + usage.cacheWrite > usage.read) return null;
  return { fresh: usage.read - usage.cached - usage.cacheWrite, cached: usage.cached, cacheWrite: usage.cacheWrite, out: usage.out };
}

// 已知维度各自计价。缓存写入已经算在 read 里，不能再按输入价收一遍。
// cacheWrite 缺省是未知：不能把缺项当成 0，也不能把可能含写入的输入估成精确金额。
export function estimateUsage(usage: Usage, price: PriceVersion, cacheWrite: 'not-applicable' | 'unknown' = 'unknown'): { amount: number; priced: boolean; unknown: string[] } {
  if (usage.cacheWrite === undefined && cacheWrite !== 'not-applicable') {
    return { amount: 0, priced: false, unknown: ['没有缓存写入用量，输入里分不出写入，不能估价'] };
  }
  const unknown: string[] = [];
  const parts = splitUsage(usage);
  if (!parts) return { amount: 0, priced: false, unknown: ['用量对不上，缓存命中和缓存写入大于输入'] };
  let amount = 0, priced = false;
  const take = (tokens: number, rate: number | undefined, missing: string) => {
    if (tokens === 0) return;
    if (rate === undefined) { unknown.push(missing); return; }
    amount += tokens * rate / 1_000_000;
    priced = true;
  };
  take(parts.fresh, price.read, '缺输入价格');
  take(parts.cached, price.cached, '缓存价格不明');
  if (parts.cacheWrite === null) { /* 这个通道的用量不含缓存写入，不补 0，也不另收费。 */ }
  else take(parts.cacheWrite, price.cacheWrite, '缓存写入没有价格');
  take(parts.out, price.out, '缺输出价格');
  return { amount, priced, unknown };
}

function lineOf(call: Call, settings: CostSettings, experiences: CostExperience[], now: string): CostLine {
  const unknown: string[] = [];
  let account: string | null = null;
  let kind: BillingKind | null = null;
  let crossed = false;
  if (call.withheld) unknown.push('引用的任务不齐，这份用量不能并进合计');
  if (!call.from || !call.to) unknown.push('没有这一轮的启动时间，不能确定付款账户和价格');
  else {
    const bound = accountFor(settings, call.who, call.model, call.from, call.to);
    if (bound === 'unknown-model') unknown.push('没有这一轮的启动模型，不能套当前绑定');
    else if (bound === 'ambiguous') unknown.push('同一个模型绑了多个账户');
    else if (bound) { account = bound.id; kind = bound.kind; crossed = bound.crossed; }
    else unknown.push('没有对应的预算账户');
    if (crossed) unknown.push('这一轮跨过了付款账户的切换，没有分段用量，不能整段计价');
  }
  const usage = call.usage ? splitUsage(call.usage) : null;
  if (!call.usage) unknown.push('缺用量');
  else if (!usage) unknown.push('用量对不上，缓存命中和缓存写入大于输入');
  let estimate: CostLine['estimate'] = null;
  let knownSubtotal: Money | null = call.withheld ? null : call.billed;
  if (!call.withheld && !call.billed && !crossed && call.usage && usage && account && kind === 'usage' && call.model && call.from && call.to) {
    const price = priceForInterval(settings, account, call.model, call.from, call.to);
    if (price.status === 'split') unknown.push('这一轮跨过了价格的生效或失效，没有分段用量，不能整段计价');
    else if (price.status === 'none') unknown.push('价格不适用或已过期');
    else {
      const priced = estimateUsage(call.usage, price.price, call.usage.cacheWrite === undefined ? cacheWritePolicy(call.who) : 'not-applicable');
      unknown.push(...priced.unknown);
      if (priced.unknown.length === 0) {
        knownSubtotal = { amount: priced.amount, currency: price.price.currency };
        estimate = { ...knownSubtotal, priceId: price.price.id };
      } else if (priced.priced) knownSubtotal = { amount: priced.amount, currency: price.price.currency };
    }
  } else if (!call.withheld && !call.billed && kind && kind !== 'usage') unknown.push(kind === 'local' ? '本地预算不能折成金额' : '订阅或套餐不能当成这件任务的按量费用');
  const experienceIds = call.usage ? [] : experiences.filter(item => Date.parse(item.recordedAt) <= Date.parse(now)
    && (item.validFrom === undefined || Date.parse(item.validFrom) <= Date.parse(now))
    && (item.validUntil === undefined || Date.parse(item.validUntil) > Date.parse(now))).map(item => item.id);
  return { id: call.id, phase: call.phase, jobId: call.jobId, round: call.round, who: call.who, model: call.model, state: call.state,
    account, kind, at: call.at, usage, seconds: call.seconds, actual: call.withheld ? null : call.billed, estimate, knownSubtotal, unknown, experienceIds, withheld: call.withheld };
}

export function buildLedger(input: {
  taskId: string; project?: { name: string; repo: string } | null; jobs: readonly Job[]; runs?: readonly AutopilotRun[]; settings: CostSettings; now?: string;
  observations?: readonly SharedObservation[]; untracked?: readonly LedgerGap[]; outsideRefs?: readonly string[];
}): TaskLedger {
  const now = input.now ?? new Date().toISOString();
  const jobs: Job[] = [];
  for (const job of input.jobs) if (!jobs.some(item => item.id === job.id)) jobs.push(job);
  const runs = input.runs ?? [];
  const known = new Set(jobs.map(job => job.id));
  const outside = new Set(input.outsideRefs ?? []);
  const phases = new Map(jobs.map(job => [job.id, roleOf(job, runs)] as const));
  const moved = handoffIds(jobs, phases);
  const calls: Call[] = [];
  const missing = new Set<string>();
  for (const job of jobs) {
    const phase = moved.has(job.id) ? 'handoff' : phases.get(job.id)!;
    for (const call of callsOf(job, phase, now)) if (!calls.some(item => item.id === call.id)) calls.push(call);
  }
  const seen = new Set<string>();
  for (const run of runs) for (const pointer of pointers(run)) {
    const ids = pointer.jobs ?? [];
    const absent = ids.filter(id => !known.has(id) || outside.has(id));
    const present = ids.filter(id => known.has(id) && !outside.has(id));
    for (const id of absent) missing.add(id);
    if (ids.length && absent.length === 0) continue;
    const id = `run/${run.id}/${pointer.token}`;
    if (seen.has(id) || calls.some(call => call.id === id)) continue;
    seen.add(id);
    if (!pointer.usage && absent.length === 0) continue;
    const atPointer = pointer.at || now;
    calls.push({ id, phase: pointer.phase, jobId: '', round: null, who: '', model: null, state: 'unknown', at: atPointer, from: atPointer, to: atPointer,
      usage: pointer.usage ?? null, seconds: null, billed: null, withheld: present.length > 0 || absent.some(id => outside.has(id)) });
  }
  calls.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const experiences = input.settings.experiences.map(item => ({ ...item, expired: item.validUntil !== undefined && Date.parse(item.validUntil) <= Date.parse(now), amount: null as null }));
  const lines = calls.map(call => lineOf(call, input.settings, input.settings.experiences, now));
  const counted = lines.filter(line => !line.withheld);
  const gaps = [...new Set([
    ...(input.untracked?.includes('lead') ? ['有负责人调用没有纳入账本'] : []),
    ...(input.untracked?.includes('other-client') ? ['有其他客户端的消耗没有纳入账本'] : []),
    ...(input.untracked?.includes('bill') ? ['账单有缺项'] : []),
    ...[...outside].map(id => `任务 ${id} 属于别的项目，没有并进这本账`),
    ...[...missing].filter(id => !outside.has(id)).map(id => `找不到任务 ${id}`),
    ...lines.flatMap(line => line.unknown),
  ])];
  if (!counted.length && !lines.length) gaps.push('没有这件任务的调用记录，不能当成零成本');
  const observations = (input.observations ?? []).map(item => ({ ...item, allocated: false as const }));
  if (observations.length) gaps.push('额度快照是共享观察值，不能平摊成这件任务的费用');
  const currencies = [...new Set(counted.flatMap(line => line.knownSubtotal ? [line.knownSubtotal.currency] : []))];
  if (currencies.length > 1) gaps.push('币种不同，不能合成一笔');
  const spent = currencies.map(currency => {
    const rows = counted.filter(line => line.knownSubtotal?.currency === currency);
    return { currency, knownSubtotal: rows.reduce((sum, line) => add(sum, line.knownSubtotal!.amount), 0),
      complete: rows.length > 0 && rows.every(line => line.unknown.length === 0 && (line.actual !== null || line.estimate !== null)) && currencies.length === 1 && gaps.length === 0 };
  });
  const measured = counted.filter(line => line.usage);
  const tokens = measured.length || counted.some(line => !line.usage) ? {
    known: {
      fresh: measured.reduce((sum, line) => sum + line.usage!.fresh, 0),
      cached: measured.reduce((sum, line) => sum + line.usage!.cached, 0),
      cacheWrite: measured.every(line => line.usage!.cacheWrite !== null) ? measured.reduce((sum, line) => sum + (line.usage!.cacheWrite ?? 0), 0) : null,
      out: measured.reduce((sum, line) => sum + line.usage!.out, 0),
    },
    missing: counted.filter(line => !line.usage).length,
  } : null;
  return { taskId: input.taskId, project: input.project ?? null, asOf: now, scope: SCOPE, coverage: gaps.length ? 'incomplete' : 'complete', gaps, lines, spent,
    tokens, seconds: { known: counted.reduce((sum, line) => sum + (line.seconds ?? 0), 0), missing: counted.filter(line => line.seconds === null).length },
    experiences, observations };
}

function belongs(job: Job, project: { name: string; repo: string }) {
  return job.project === project.name && samePath(job.repo, project.repo);
}
export async function readTaskLedger(projectName: string, taskId: string, options: { now?: string; observations?: readonly SharedObservation[]; untracked?: readonly LedgerGap[]; external?: 'confirmed' } = {}): Promise<TaskLedger> {
  safeName(projectName);
  if (!/^TASK-\d+$/.test(taskId)) throw new Error('任务号必须是 TASK- 加数字。');
  const project = await loadProject(projectName).catch(error => {
    if (hasCode(error, 'ENOENT')) throw new Error(`没有登记叫 ${projectName} 的项目。`);
    throw error;
  });
  const scope = { name: project.name, repo: project.repo };
  const [jobs, listed, settings] = await Promise.all([
    listJobs(false).catch(error => { if (hasCode(error, 'ENOENT')) return [] as Job[]; throw error; }),
    listAutopilots(), readCostSettings(),
  ]);
  const runs = listed.runs.filter(run => run.taskId === taskId && run.project === scope.name && samePath(run.repo, scope.repo));
  const linked = [...new Set(runs.flatMap(run => [...run.attempts, ...(run.flow?.reviews ?? []), ...(run.diagnoses ?? [])].flatMap(item => item.jobs ?? [])))];
  const outsideRefs = linked.filter(id => {
    const job = jobs.find(item => item.id === id);
    return !!job && !belongs(job, scope);
  });
  const related = jobs.filter(job => belongs(job, scope) && (job.plan?.taskId === taskId || linked.includes(job.id)));
  const { external, ...rest } = options;
  const ledger = buildLedger({ taskId, project: scope, jobs: related, runs, settings, outsideRefs, ...rest });
  if (external !== 'confirmed') ledger.gaps.push('只覆盖这个项目里已有的任务记录，没有证明负责人在别处的调用或其他客户端的消耗已经纳入');
  if (listed.broken.length) ledger.gaps.push('有无人看守登记读不出来');
  ledger.gaps = [...new Set(ledger.gaps)];
  if (ledger.gaps.length) ledger.coverage = 'incomplete';
  for (const rollup of ledger.spent) if (ledger.gaps.length) rollup.complete = false;
  return ledger;
}
