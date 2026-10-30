import { join } from 'node:path';
import { paths } from './paths.ts';
import { hasCode, readJson, readOptional, withLock, writeJson } from './fsx.ts';
import type { DeepseekMoney, DeepseekPrice } from './deepseek-settings.ts';
import { deepseekMoney } from './deepseek-settings.ts';
import type { Usage } from './job.ts';

// 身份标签不单独授予额度；隔离必须显式选择会计组。
export type MoneyIdentity = { budgetGroup: string; model: string };
const validGroup = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
  && !['constructor', 'prototype', '__proto__'].includes(value);
function validIdentity(value: unknown): value is MoneyIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 && typeof record.budgetGroup === 'string'
    && validGroup(record.budgetGroup)
    && typeof record.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+\-/:]{0,159}$/.test(record.model)
    && !record.model.includes('://');
}
// 一份 DeepSeek 预算跨项目共享；改地址或模型不清空今日账。
type Entry = { day: string; charged: number; reserve: number; margin?: number; active: boolean; started: number; observed: number; price: DeepseekPrice; unknown: boolean;
  identity?: MoneyIdentity; budgetGroup?: string; observationStopped?: boolean;
  lastUsageAt?: number; uncertainSince?: number; uncertainUntil?: number;
  source?: 'cumulative_tokens' | 'reservation_fallback'; unknownReason?: 'awaiting_usage' | 'missing_final_usage' | 'cross_day_usage' };
type Balance = { days: Record<string, number>; stopped: string[] };
type Ledger = Balance & { version: 1 | 2; entries: Record<string, Entry>; groups?: Record<string, Balance> };
const entryGroup = (entry: Entry) => entry.budgetGroup ?? 'default';
function balance(book: Ledger, group: string): Balance {
  if (group === 'default') return book;
  if (!book.groups || !Object.hasOwn(book.groups, group)) throw new Error('费用预算组账目缺失，已暂停收费调用。');
  return book.groups[group];
}
export type MoneyStatus = { day: string; spent: number; reserved: number; unknown: number; stopped: boolean;
  remaining?: number | null; softRemaining?: number | null };
const dir = () => join(paths().home, 'money-budget');
const file = () => join(dir(), 'deepseek.json');
const dayOf = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
// 把 Number 的十进制表示转为定点系数，避免 100 * 0.07 被 ceil 成 8 微元。
function decimal(value: number): { coefficient: bigint; scale: number } {
  if (!Number.isFinite(value) || value < 0) throw new Error('费用金额不合法，已暂停收费调用。');
  const [mantissa, exponent = '0'] = String(value).split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const scale = fraction.length - Number(exponent);
  const coefficient = BigInt(whole + fraction);
  return scale < 0 ? { coefficient: coefficient * 10n ** BigInt(-scale), scale: 0 } : { coefficient, scale };
}
function safeAmount(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('费用金额超过安全精度，已暂停收费调用。');
  return Number(value);
}
function ceilAmount(numerator: bigint, scale: number): number {
  const divisor = 10n ** BigInt(scale);
  return safeAmount((numerator + divisor - 1n) / divisor);
}
const units = (yuan: number) => { const d = decimal(yuan); return ceilAmount(d.coefficient * 1_000_000n, d.scale); };
const addAmount = (a: number, b: number) => safeAmount(BigInt(a) + BigInt(b));
function usageAmount(usage: Usage, price: DeepseekPrice): number {
  // 独立写入价需要通道明确返回写入量；缺量不能补零而低估费用。
  if (price.cacheWrite !== undefined && usage.cacheWrite === undefined) throw new Error('缓存写入用量未知，无法按独立单价核算，已暂停收费调用。');
  const write = usage.cacheWrite ?? 0;
  const prices = [price.input, price.cached, price.output, price.cacheWrite ?? price.input].map(decimal);
  const scale = Math.max(...prices.map(p => p.scale));
  const counts = [usage.read - usage.cached - write, usage.cached, usage.out, write];
  return ceilAmount(prices.reduce((sum, p, i) => sum + BigInt(counts[i]) * p.coefficient * 10n ** BigInt(scale - p.scale), 0n), scale);
}
function markUncertain(e: Entry, now: number): void {
  const previous = e.lastUsageAt ?? e.started;
  if (dayOf(previous) !== dayOf(now)) {
    e.uncertainSince = Math.min(e.uncertainSince ?? previous, previous, now);
    e.uncertainUntil = Math.max(e.uncertainUntil ?? now, previous, now);
  }
}
function settleUnknown(book: Ledger, entry: Entry, now: number): void {
  const day = dayOf(now);
  const account = balance(book, entryGroup(entry));
  account.days[day] = addAmount(account.days[day] ?? 0, Math.max(0, entry.reserve - entry.charged));
  markUncertain(entry, now);
  entry.charged = Math.max(entry.reserve, entry.charged); entry.active = false; entry.unknown = true; entry.day = day;
  entry.source = 'reservation_fallback'; entry.unknownReason = 'missing_final_usage';
}
async function load(): Promise<Ledger> {
  let raw: unknown;
  try { raw = await readJson(file()); }
  catch (error) {
    // 只有文件不存在才是首次使用；空文件、坏 JSON 或读取失败都不能清账。
    if (hasCode(error, 'ENOENT')) return { version: 1, days: {}, stopped: [], entries: {} };
    throw new Error('费用账本无法读取或已损坏，已暂停收费调用。', { cause: error });
  }
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(raw) || ![1, 2].includes(raw.version as number) || !object(raw.days) || !object(raw.entries) || !Array.isArray(raw.stopped)
    || raw.stopped.some(day => typeof day !== 'string')) throw new Error('费用账本损坏，已暂停收费调用。');
  const value = raw as unknown as Ledger;
  const amount = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (value.version === 1 ? value.groups !== undefined || Object.values(value.entries).some(e => e?.budgetGroup !== undefined)
    : !object(value.groups) || Object.entries(value.groups).some(([group, b]) => !validGroup(group) || group === 'default' || !object(b)
      || !object(b.days) || Object.values(b.days).some(v => !amount(v)) || !Array.isArray(b.stopped) || b.stopped.some(day => typeof day !== 'string'))) {
    throw new Error('费用分组账本不合法，已暂停收费调用。');
  }
  if (Object.values(value.days).some(v => !amount(v)) || Object.values(value.entries).some(e => !e || !amount(e.charged) || !amount(e.reserve)
    || (e.budgetGroup !== undefined && (!validGroup(e.budgetGroup) || (e.budgetGroup !== 'default' && (!value.groups || !Object.hasOwn(value.groups, e.budgetGroup)))
      || e.identity?.budgetGroup !== e.budgetGroup))
    || (e.identity !== undefined && !validIdentity(e.identity))
    || (e.margin !== undefined && !amount(e.margin))
    || (e.observationStopped !== undefined && typeof e.observationStopped !== 'boolean')
    || !Number.isFinite(e.started) || !Number.isFinite(e.observed) || typeof e.active !== 'boolean' || typeof e.unknown !== 'boolean'
    || !e.price || [e.price.input, e.price.cached, e.price.output].some(v => !Number.isFinite(v) || v < 0)
    || (e.price.cacheWrite !== undefined && (!Number.isFinite(e.price.cacheWrite) || e.price.cacheWrite < 0 || e.price.cacheWrite > 1_000_000))
    || [e.lastUsageAt, e.uncertainSince, e.uncertainUntil].some(v => v !== undefined && (!Number.isFinite(v) || !Number.isFinite(new Date(v).getTime())))
    || (e.uncertainSince === undefined) !== (e.uncertainUntil === undefined)
    || (e.uncertainSince !== undefined && e.uncertainUntil! < e.uncertainSince)
    || (e.source !== undefined && !['cumulative_tokens', 'reservation_fallback'].includes(e.source))
    || (e.unknownReason !== undefined && !['awaiting_usage', 'missing_final_usage', 'cross_day_usage'].includes(e.unknownReason)))) throw new Error('费用账本内容不合法，已暂停收费调用。');
  return value;
}
function status(book: Ledger, now: number, group = 'default'): MoneyStatus {
  const day = dayOf(now);
  const account = balance(book, group);
  return { day, spent: (account.days[day] ?? 0) / 1_000_000,
    reserved: reservedAmount(book, group) / 1_000_000,
    unknown: Object.values(book.entries).filter(e => entryGroup(e) === group && e.unknown && (e.active || e.day === day
      || (e.uncertainSince !== undefined && day >= dayOf(e.uncertainSince) && day <= dayOf(e.uncertainUntil!)))).length, stopped: account.stopped.includes(day) };
}
function reservedAmount(book: Ledger, group = 'default'): number {
  // 余量独立冻结，只占预算；结算仍仅使用执行 reserve，不将余量记为消费。
  return Object.values(book.entries).filter(e => e.active && entryGroup(e) === group).reduce((sum, e) => addAmount(sum, addAmount(Math.max(0, e.reserve - e.charged), e.margin ?? 0)), 0);
}
export function moneyStatusWithBudget(snapshot: MoneyStatus, config?: DeepseekMoney): MoneyStatus {
  if (!config) return { ...snapshot, remaining: null, softRemaining: null };
  const checked = deepseekMoney(config);
  if (!checked.enabled) return { ...snapshot, remaining: null, softRemaining: null };
  const occupied = addAmount(units(snapshot.spent), units(snapshot.reserved));
  return { ...snapshot, remaining: Math.max(0, units(checked.hard) - occupied) / 1_000_000,
    softRemaining: Math.max(0, units(checked.soft) - occupied) / 1_000_000 };
}
export async function readMoneyStatus(now = Date.now(), config?: DeepseekMoney, group = 'default'): Promise<MoneyStatus> {
  if (!validGroup(group)) throw new Error('费用预算组不合法。');
  // 文件原子替换，读取不需要创建锁目录；构造只读看板不能产生目录或记录。
  return moneyStatusWithBudget(status(await load(), now, group), config);
}
export async function reserveMoney(id: string, config: DeepseekMoney, price: DeepseekPrice, now = Date.now(), identity?: MoneyIdentity, group = 'default'): Promise<void> {
  if (!config.enabled) return;
  config = deepseekMoney(config);
  if (identity !== undefined && !validIdentity(identity)) throw new Error('费用预算组或实际模型身份不合法。');
  if (!validGroup(group) || (group !== 'default' && identity?.budgetGroup !== group)) throw new Error('费用预算组须与实际模型身份一致。');
  const frozenIdentity = identity === undefined ? undefined : { ...identity };
  await withLock(dir(), async () => {
    const book = await load();
    const existing = book.entries[id];
    if (existing && (entryGroup(existing) !== group || existing.identity?.budgetGroup !== frozenIdentity?.budgetGroup || existing.identity?.model !== frozenIdentity?.model)) {
      throw new Error('费用预留身份与原记录不一致，不能改归属或补写历史模型。');
    }
    if (group !== 'default' && (!book.groups || !Object.hasOwn(book.groups, group))) {
      book.version = 2; book.groups ??= {}; book.groups[group] = { days: {}, stopped: [] };
    }
    // 已结束但未完成结算的记录，重启后按剩余预留保守结算；无法核对的运行记录继续保留预留。
    for (const [jobId, entry] of Object.entries(book.entries)) if (entry.active && /^[A-Za-z0-9._-]+$/.test(jobId)) {
      let recorded: { state?: string };
      try { recorded = JSON.parse(await readOptional(join(paths().jobs, jobId, 'job.json'))); }
      catch { continue; /* 未能确认则保留预留，不猜测为免费。 */ }
      if (recorded?.state && ['done', 'failed', 'stopped'].includes(recorded.state)) settleUnknown(book, entry, now);
    }
    await writeJson(file(), book);
    const s = status(book, now, group);
    if (book.entries[id]) return;
    const occupied = addAmount(balance(book, group).days[s.day] ?? 0, reservedAmount(book, group));
    if (s.stopped || occupied >= units(config.soft)) throw new Error('DeepSeek 已达到每日软预算或上限，今天暂停新派活。');
    const margin = units(config.safetyMargin ?? 0);
    if (addAmount(occupied, addAmount(units(config.reserve), margin)) > units(config.hard)) throw new Error('DeepSeek 剩余每日预算不足以预留这次任务，请减少并发或调整预算。');
    book.entries[id] = { day: s.day, charged: 0, reserve: units(config.reserve), margin, active: true, started: now, observed: now, price: { ...price },
      ...(group === 'default' ? {} : { budgetGroup: group }),
      ...(frozenIdentity === undefined ? {} : { identity: frozenIdentity }), unknown: true, unknownReason: 'awaiting_usage' };
    await writeJson(file(), book);
  });
}
export async function observeMoney(id: string, config: DeepseekMoney | undefined, usage: Usage | undefined, final = false, now = Date.now()): Promise<string | null> {
  return withLock(dir(), async () => {
    const book = await load(), e = book.entries[id];
    if (!e) return config?.enabled ? 'DeepSeek 费用预留记录缺失，已停止本任务。' : null;
    if (!e.active && !final && config?.enabled) return '本任务费用预留已结算，请重新派活；不会自动续接收费会话。';
    const account = balance(book, entryGroup(e));
    const day = dayOf(now);
    // 恢复时的新累计量可以补账，但不能洗掉看管未观测的长间隔。
    if (!final && config?.enabled && e.active && now - e.observed >= config.unknownSeconds * 1000) e.observationStopped = true;
    if (usage) {
      if ([usage.read, usage.cached, usage.out, ...(usage.cacheWrite === undefined ? [] : [usage.cacheWrite])]
        .some(v => !Number.isSafeInteger(v) || v < 0) || usage.cached > usage.read
        || (usage.cacheWrite !== undefined && usage.cacheWrite > usage.read - usage.cached)) throw new Error('费用用量不合法，停止调用。');
      const total = usageAmount(usage, e.price);
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('费用用量不合法，停止调用。');
      const delta = Math.max(0, total - e.charged);
      account.days[day] = addAmount(account.days[day] ?? 0, delta);
      if (delta > 0 || (e.lastUsageAt === undefined && total > 0)) {
        markUncertain(e, now);
        e.day = day;
      }
      if (delta > 0) e.observed = now;
      // 重放相同累计量不是新的观测，不能延长无新增用量时限或洗掉跨日未知。
      if (delta > 0 || e.lastUsageAt === undefined) e.lastUsageAt = now;
      e.charged = Math.max(e.charged, total);
      if (total >= e.charged) {
        e.source = 'cumulative_tokens';
        e.unknown = e.uncertainSince !== undefined;
        if (e.unknown) e.unknownReason = 'cross_day_usage';
        else delete e.unknownReason;
      }
    }
    if (final) {
      // 只对尚未结算的轮次兜底；重复缺量收尾不改历史归账日期或未知区间。
      if (!usage && e.active) settleUnknown(book, e, now);
      e.active = false;
    }
    let reason: string | null = null;
    if (config?.enabled) {
      if ((account.days[day] ?? 0) >= units(config.hard)) {
        if (!account.stopped.includes(day)) account.stopped.push(day);
      }
      if (account.stopped.includes(day)) reason = 'DeepSeek 已达到每日预估费用上限，已独立停止；今天不会自动恢复。';
      else if (e.active && e.observationStopped) reason = 'DeepSeek 长时间未返回新增用量，已按无观测时限停止，费用待核对。';
      else if (e.charged >= e.reserve) reason = 'DeepSeek 已用完本任务预留金额，已停止，请调整预留后重新派活。';
    }
    await writeJson(file(), book);
    return reason;
  });
}
