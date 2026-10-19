// 主人填写的成本资料（TASK-017）。不含密钥、不含带凭据的网址，也不发起网络请求。
// 订阅窗口、按量金额、次数套餐、本地时长各记各的，不能折成一个分数。
// 改这份资料只在锁里读改写，临时文件改名；不碰任务记录里的 usage。
import { join } from 'node:path';
import { hasCode, readJson, withLock, writeJson } from './fsx.ts';
import { paths, safeName } from './paths.ts';
import { isChannel } from './roster.ts';
import type { Vendor } from './roster.ts';

export type BillingKind = 'subscription' | 'usage' | 'package' | 'local';
export type AccountSource = 'official' | 'relay' | 'manual';
export type Money = { amount: number; currency: string };
export type Factor = { numerator: number; denominator: number };

export type AccountBalance = {
  amount: number; currency: string; scope: string; recordedAt: string; validUntil?: string;
};
export type AccountWindow = {
  label: string; recordedAt: string; usedPercent?: number; reset?: string; validUntil?: string;
};
export type AccountAllowance = {
  scope: string; recordedAt: string; count?: number; validUntil?: string;
};
export type LocalBudget = {
  recordedAt: string; timezone?: string; secondsPerDay?: number; attemptsPerDay?: number; concurrent?: number; validUntil?: string;
};
export type BudgetAccount = {
  id: string; label: string; channel: Vendor; kind: BillingKind; source: AccountSource;
  balance?: AccountBalance; windows?: AccountWindow[]; allowance?: AccountAllowance; local?: LocalBudget;
};
// 绑定认的是当时实际启动的模型名，可以是中转站上的自定义 ID。生效时间用来避免改绑以后把旧调用算到新账户。
export type ModelBinding = { account: string; channel: Vendor; model: string; effectiveAt: string; expiresAt?: string };
export type PriceVersion = {
  id: string; account: string; model: string; effectiveAt: string; recordedAt: string; expiresAt?: string;
  currency: string; per: 'million'; read?: number; cached?: number; cacheWrite?: number; out?: number;
};
export type CostExperience = {
  id: string; subject: string; basis: string; factor: Factor; scope: string; recordedAt: string;
  validFrom?: string; validUntil?: string;
};
export type CostSettings = {
  version: 1;
  accounts: BudgetAccount[];
  bindings: ModelBinding[];
  prices: PriceVersion[];
  experiences: CostExperience[];
};

const KINDS: readonly BillingKind[] = ['subscription', 'usage', 'package', 'local'];
const SOURCES: readonly AccountSource[] = ['official', 'relay', 'manual'];
const LIMITS = { accounts: 40, bindings: 80, prices: 120, experiences: 40, windows: 8 } as const;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysOf = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
  && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value) && !/[a-z][a-z0-9+.-]*:\/\//i.test(value);
const when = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
const currency = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12;
const count = (value: unknown, max: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
const optional = <T>(value: unknown, ok: (value: unknown) => value is T): value is T | undefined => value === undefined || ok(value);

export const emptyCostSettings = (): CostSettings => ({ version: 1, accounts: [], bindings: [], prices: [], experiences: [] });
export const costFile = () => join(paths().home, 'cost.json');
export const costLockDir = () => join(paths().home, 'cost');

function idOf(value: unknown): string {
  if (typeof value !== 'string') throw new Error('成本资料的编号必须是文字。');
  return safeName(value);
}
function order(from: string | undefined, to: string | undefined) {
  if (from && to && Date.parse(from) > Date.parse(to)) throw new Error('成本资料的开始时间不能晚于结束时间。');
}

function balanceOf(value: unknown): AccountBalance | undefined {
  if (value === undefined) return;
  if (!object(value) || !keysOf(value, ['amount', 'currency', 'scope', 'recordedAt', 'validUntil'])) throw new Error('人工余额字段不对。');
  if (!amount(value.amount) || !currency(value.currency) || !text(value.scope, 120) || !when(value.recordedAt) || !optional(value.validUntil, when)) {
    throw new Error('人工余额要有金额、币种、适用范围和记录时间，缺了不能当成 0。');
  }
  order(value.recordedAt, value.validUntil);
  return { amount: value.amount, currency: value.currency, scope: value.scope, recordedAt: value.recordedAt, ...(value.validUntil ? { validUntil: value.validUntil } : {}) };
}
function windowOf(value: unknown): AccountWindow {
  if (!object(value) || !keysOf(value, ['label', 'recordedAt', 'usedPercent', 'reset', 'validUntil'])) throw new Error('套餐窗口字段不对。');
  if (!text(value.label, 40) || !when(value.recordedAt) || !optional(value.usedPercent, (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)
    || !optional(value.reset, when) || !optional(value.validUntil, when)) throw new Error('套餐窗口要有名称和记录时间；用量未知就留空，不能写成 0。');
  order(value.recordedAt, value.validUntil);
  return { label: value.label, recordedAt: value.recordedAt, ...(value.usedPercent === undefined ? {} : { usedPercent: value.usedPercent }),
    ...(value.reset ? { reset: value.reset } : {}), ...(value.validUntil ? { validUntil: value.validUntil } : {}) };
}
function allowanceOf(value: unknown): AccountAllowance | undefined {
  if (value === undefined) return;
  if (!object(value) || !keysOf(value, ['scope', 'recordedAt', 'count', 'validUntil'])) throw new Error('次数套餐字段不对。');
  if (!text(value.scope, 120) || !when(value.recordedAt) || !optional(value.count, v => count(v, 1_000_000)) || !optional(value.validUntil, when)) {
    throw new Error('次数套餐要有适用范围和记录时间；次数未知就留空。');
  }
  order(value.recordedAt, value.validUntil);
  return { scope: value.scope, recordedAt: value.recordedAt, ...(value.count === undefined ? {} : { count: value.count as number }), ...(value.validUntil ? { validUntil: value.validUntil } : {}) };
}
function localOf(value: unknown): LocalBudget | undefined {
  if (value === undefined) return;
  if (!object(value) || !keysOf(value, ['recordedAt', 'timezone', 'secondsPerDay', 'attemptsPerDay', 'concurrent', 'validUntil'])) throw new Error('本地预算字段不对。');
  if (!when(value.recordedAt) || !optional(value.timezone, v => text(v, 64)) || !optional(value.secondsPerDay, v => count(v, 86_400))
    || !optional(value.attemptsPerDay, v => count(v, 10_000)) || !optional(value.concurrent, v => count(v, 100)) || !optional(value.validUntil, when)) {
    throw new Error('本地预算要有记录时间；没填的上限是未知，不是无限，也不是 0。');
  }
  order(value.recordedAt, value.validUntil);
  return { recordedAt: value.recordedAt, ...(value.timezone ? { timezone: value.timezone } : {}),
    ...(value.secondsPerDay === undefined ? {} : { secondsPerDay: value.secondsPerDay as number }),
    ...(value.attemptsPerDay === undefined ? {} : { attemptsPerDay: value.attemptsPerDay as number }),
    ...(value.concurrent === undefined ? {} : { concurrent: value.concurrent as number }),
    ...(value.validUntil ? { validUntil: value.validUntil } : {}) };
}
function accountOf(value: unknown): BudgetAccount {
  if (!object(value) || !keysOf(value, ['id', 'label', 'channel', 'kind', 'source', 'balance', 'windows', 'allowance', 'local'])) throw new Error('预算账户含有不能保存的字段。');
  const id = idOf(value.id);
  if (!text(value.label, 80) || !isChannel(value.channel) || !KINDS.includes(value.kind as BillingKind) || !SOURCES.includes(value.source as AccountSource)) {
    throw new Error('预算账户要有名称、通道、计费方式和来源。');
  }
  if ((value.kind === 'subscription' || value.kind === 'package') && value.source === 'relay') throw new Error('中转账户不能套用官方订阅或官方套餐。');
  if (value.kind !== 'subscription' && value.kind !== 'package' && value.windows !== undefined) throw new Error('只有订阅或套餐账户才记录官方窗口。');
  if (value.kind !== 'package' && value.allowance !== undefined) throw new Error('只有次数套餐账户才记录次数。');
  if (value.kind !== 'local' && value.local !== undefined) throw new Error('只有本地预算账户才记录时长和次数上限。');
  if (value.kind === 'local' && value.balance !== undefined) throw new Error('本地预算只记时长和次数，不记金额。');
  const windows = value.windows === undefined ? undefined : Array.isArray(value.windows) && value.windows.length <= LIMITS.windows ? value.windows.map(windowOf) : null;
  if (windows === null) throw new Error('套餐窗口太多或格式不对。');
  return { id, label: value.label, channel: value.channel, kind: value.kind as BillingKind, source: value.source as AccountSource,
    ...(balanceOf(value.balance) ? { balance: balanceOf(value.balance) } : {}), ...(windows ? { windows } : {}),
    ...(allowanceOf(value.allowance) ? { allowance: allowanceOf(value.allowance) } : {}), ...(localOf(value.local) ? { local: localOf(value.local) } : {}) };
}
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._+\-/:]*$/;
function bindingOf(value: unknown, accounts: BudgetAccount[]): ModelBinding {
  if (!object(value) || !keysOf(value, ['account', 'channel', 'model', 'effectiveAt', 'expiresAt'])) throw new Error('模型绑定含有不能保存的字段。');
  const account = accounts.find(item => item.id === value.account);
  if (!account || !isChannel(value.channel) || value.channel !== account.channel || typeof value.model !== 'string' || value.model.length > 160 || !MODEL_ID.test(value.model)) {
    throw new Error('模型绑定必须指向已有账户，而且通道要和账户一致。');
  }
  if (!when(value.effectiveAt) || !optional(value.expiresAt, when)) throw new Error('模型绑定要有生效时间；没有时间就不能用来给旧调用归账户。');
  order(value.effectiveAt, value.expiresAt);
  return { account: account.id, channel: value.channel, model: value.model, effectiveAt: value.effectiveAt, ...(value.expiresAt ? { expiresAt: value.expiresAt } : {}) };
}
function windowsOverlap(left: ModelBinding, right: ModelBinding) {
  const start = Math.max(Date.parse(left.effectiveAt), Date.parse(right.effectiveAt));
  const end = Math.min(left.expiresAt ? Date.parse(left.expiresAt) : Infinity, right.expiresAt ? Date.parse(right.expiresAt) : Infinity);
  return start < end;
}
function priceOf(value: unknown, accounts: BudgetAccount[], bindings: ModelBinding[]): PriceVersion {
  if (!object(value) || !keysOf(value, ['id', 'account', 'model', 'effectiveAt', 'recordedAt', 'expiresAt', 'currency', 'per', 'read', 'cached', 'cacheWrite', 'out'])) {
    throw new Error('价格版本含有不能保存的字段。');
  }
  const account = accounts.find(item => item.id === value.account);
  if (!account || account.kind !== 'usage') throw new Error('按量单价只能挂在按量账户上，不能挂到订阅、套餐或本地预算。');
  if (!bindings.some(item => item.account === account.id && item.model === value.model)) throw new Error('价格版本的模型必须已经绑到这个账户。');
  const dims = ['read', 'cached', 'cacheWrite', 'out'] as const;
  if (!dims.some(key => value[key] !== undefined) || dims.some(key => !optional(value[key], amount))) throw new Error('价格至少要有一个维度；没写的维度是未知，不能补 0。');
  if (value.per !== 'million' || !currency(value.currency) || !when(value.effectiveAt) || !when(value.recordedAt) || !optional(value.expiresAt, when)) {
    throw new Error('价格要有币种、生效时间和记录时间，计量只能是每百万 token。');
  }
  order(value.effectiveAt, value.expiresAt);
  const priced: PriceVersion = { id: idOf(value.id), account: account.id, model: value.model as string, effectiveAt: value.effectiveAt, recordedAt: value.recordedAt,
    currency: value.currency, per: 'million' };
  for (const key of dims) if (value[key] !== undefined) priced[key] = value[key] as number;
  if (value.expiresAt) priced.expiresAt = value.expiresAt;
  return priced;
}
function factorOf(value: unknown): Factor {
  if (!object(value) || !keysOf(value, ['numerator', 'denominator']) || !count(value.numerator, 100_000) || !count(value.denominator, 100_000) || value.numerator === 0 || value.denominator === 0) {
    throw new Error('经验倍率要写成正整数的分子和分母，例如三分之一。');
  }
  return { numerator: value.numerator as number, denominator: value.denominator as number };
}
function experienceOf(value: unknown): CostExperience {
  if (!object(value) || !keysOf(value, ['id', 'subject', 'basis', 'factor', 'scope', 'recordedAt', 'validFrom', 'validUntil'])) throw new Error('成本经验含有不能保存的字段。');
  if (!text(value.subject, 120) || !text(value.basis, 120) || !text(value.scope, 200) || !when(value.recordedAt) || !optional(value.validFrom, when) || !optional(value.validUntil, when)) {
    throw new Error('成本经验要有对照双方、适用范围和记录时间。');
  }
  order(value.validFrom, value.validUntil);
  return { id: idOf(value.id), subject: value.subject, basis: value.basis, factor: factorOf(value.factor), scope: value.scope, recordedAt: value.recordedAt,
    ...(value.validFrom ? { validFrom: value.validFrom } : {}), ...(value.validUntil ? { validUntil: value.validUntil } : {}) };
}

export function checkCostSettings(value: unknown): CostSettings {
  if (!object(value) || !keysOf(value, ['version', 'accounts', 'bindings', 'prices', 'experiences'])) throw new Error('成本资料含有不能保存的字段。');
  if (value.version !== 1) throw new Error('认不出这份成本资料的版本。');
  if (!Array.isArray(value.accounts) || value.accounts.length > LIMITS.accounts) throw new Error('预算账户太多或格式不对。');
  if (!Array.isArray(value.bindings) || value.bindings.length > LIMITS.bindings) throw new Error('模型绑定太多或格式不对。');
  if (!Array.isArray(value.prices) || value.prices.length > LIMITS.prices) throw new Error('价格版本太多或格式不对。');
  if (!Array.isArray(value.experiences) || value.experiences.length > LIMITS.experiences) throw new Error('成本经验太多或格式不对。');
  const accounts = value.accounts.map(accountOf);
  if (new Set(accounts.map(item => item.id)).size !== accounts.length) throw new Error('预算账户编号重复。');
  const bindings = value.bindings.map(item => bindingOf(item, accounts));
  for (let i = 0; i < bindings.length; i++) for (let j = i + 1; j < bindings.length; j++) {
    const left = bindings[i]!, right = bindings[j]!;
    if (left.channel === right.channel && left.model === right.model && windowsOverlap(left, right)) throw new Error('同一个模型不能同时绑到两个付款账户。');
  }
  const prices = value.prices.map(item => priceOf(item, accounts, bindings));
  if (new Set(prices.map(item => item.id)).size !== prices.length) throw new Error('价格版本编号重复。');
  const experiences = value.experiences.map(experienceOf);
  if (new Set(experiences.map(item => item.id)).size !== experiences.length) throw new Error('成本经验编号重复。');
  return { version: 1, accounts, bindings, prices, experiences };
}

async function load(): Promise<CostSettings> {
  try { return checkCostSettings(await readJson(costFile())); }
  catch (error) {
    if (hasCode(error, 'ENOENT')) return emptyCostSettings();
    throw error;
  }
}
export const readCostSettings = (): Promise<CostSettings> => load();
export async function updateCostSettings(edit: (current: CostSettings) => void): Promise<CostSettings> {
  return withLock(costLockDir(), async () => {
    const current = await load();
    edit(current);
    const checked = checkCostSettings(current);
    await writeJson(costFile(), checked);
    return checked;
  });
}

export function expiredAt(validUntil: string | undefined, now: string): boolean {
  return validUntil !== undefined && Date.parse(validUntil) <= Date.parse(now);
}
export type AccountView = {
  id: string; label: string; channel: Vendor; kind: BillingKind; source: AccountSource; models: string[];
  balance: (AccountBalance & { expired: boolean }) | null;
  windows: (AccountWindow & { expired: boolean })[];
  allowance: (AccountAllowance & { expired: boolean }) | null;
  local: (LocalBudget & { expired: boolean }) | null;
};
// 同一账户下多个模型共用这一份余额；不同账户即使通道相同也不加总。
export function accountViews(settings: CostSettings, now: string): AccountView[] {
  return settings.accounts.map(account => ({
    id: account.id, label: account.label, channel: account.channel, kind: account.kind, source: account.source,
    models: settings.bindings.filter(item => item.account === account.id && Date.parse(item.effectiveAt) <= Date.parse(now)
      && (item.expiresAt === undefined || Date.parse(item.expiresAt) > Date.parse(now))).map(item => item.model),
    balance: account.balance ? { ...account.balance, expired: expiredAt(account.balance.validUntil, now) } : null,
    windows: (account.windows ?? []).map(item => ({ ...item, expired: expiredAt(item.validUntil, now) })),
    allowance: account.allowance ? { ...account.allowance, expired: expiredAt(account.allowance.validUntil, now) } : null,
    local: account.local ? { ...account.local, expired: expiredAt(account.local.validUntil, now) } : null,
  }));
}
export function selectPrice(settings: CostSettings, account: string, model: string, at: string): PriceVersion | undefined {
  const atMs = Date.parse(at);
  return settings.prices.filter(price => price.account === account && price.model === model && Date.parse(price.effectiveAt) <= atMs
    && (price.expiresAt === undefined || Date.parse(price.expiresAt) > atMs))
    .sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt) || a.id.localeCompare(b.id)).at(-1);
}

export type IntervalBinding =
  | { status: 'none' }
  | { status: 'ambiguous' }
  | { status: 'bound'; binding: ModelBinding; crossed: boolean };
export type IntervalPrice =
  | { status: 'none' }
  | { status: 'split' }
  | { status: 'priced'; price: PriceVersion };

function instant(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}
// 启动时刻只有一个绑定时，账户就归它。调用跨过失效或换账户、又没有分段用量时，不能把整段算到结束时的账户。
export function bindingForInterval(settings: CostSettings, channel: Vendor, model: string, from: string, to: string): IntervalBinding {
  const start = instant(from), end = instant(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return { status: 'none' };
  const rows = settings.bindings.filter(item => item.channel === channel && item.model === model);
  const active = rows.filter(item => Date.parse(item.effectiveAt) <= start && (item.expiresAt === undefined || Date.parse(item.expiresAt) > start));
  if (active.length !== 1) return active.length > 1 ? { status: 'ambiguous' } : { status: 'none' };
  const binding = active[0]!;
  const coversEnd = Date.parse(binding.effectiveAt) <= end && (binding.expiresAt === undefined || Date.parse(binding.expiresAt) > end);
  const switched = rows.some(item => item.account !== binding.account && Date.parse(item.effectiveAt) > start && Date.parse(item.effectiveAt) <= end);
  return { status: 'bound', binding, crossed: !coversEnd || switched };
}
// 只有一份价格盖住从启动到结束的整段时才能用。中途生效或失效都算跨段，不取开始价，也不取结束价。
export function priceForInterval(settings: CostSettings, account: string, model: string, from: string, to: string): IntervalPrice {
  const start = instant(from), end = instant(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return { status: 'none' };
  const rows = settings.prices.filter(price => price.account === account && price.model === model);
  const chosen = rows.filter(price => Date.parse(price.effectiveAt) <= start && (price.expiresAt === undefined || Date.parse(price.expiresAt) > start))
    .sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt) || a.id.localeCompare(b.id)).at(-1);
  if (!chosen) return { status: 'none' };
  const later = rows.some(price => price.id !== chosen.id && Date.parse(price.effectiveAt) > start && Date.parse(price.effectiveAt) <= end);
  const expires = chosen.expiresAt !== undefined && Date.parse(chosen.expiresAt) <= end;
  if (later || expires) return { status: 'split' };
  return { status: 'priced', price: chosen };
}
