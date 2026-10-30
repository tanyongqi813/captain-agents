export const deepseekWireApis = ['responses', 'chat'] as const;
export type DeepseekWireApi = typeof deepseekWireApis[number];
export type DeepseekReasoningCapabilities = { baseUrl: string; wireApi: DeepseekWireApi; models: Record<string, { high: boolean; source: 'user'; updatedAt: string }> };
export type DeepseekPrice = { input: number; cached: number; output: number; cacheWrite?: number };
export type DeepseekMoney = { enabled: boolean; soft: number; hard: number; reserve: number; safetyMargin?: number; unknownSeconds: number; pro: DeepseekPrice; flash: DeepseekPrice; modelPrices?: Record<string, DeepseekPrice>; legacyModels?: { pro: string; flash: string } };
export type DeepseekEndpoint = { baseUrl: string; wireApi: DeepseekWireApi; proModel: string; flashModel: string; offPeakOnly: boolean; proReasoning?: 'default' | 'high'; flashReasoning?: 'default' | 'high'; reasoningCapabilities?: DeepseekReasoningCapabilities; money?: DeepseekMoney; moneyGroups?: Record<string, DeepseekMoney>; budgetGroup?: string };
export const defaultDeepseekMoney: DeepseekMoney = { enabled: false, soft: 8, hard: 10, reserve: 1, unknownSeconds: 180, pro: { input: 0, cached: 0, output: 0 }, flash: { input: 0, cached: 0, output: 0 } };

export function deepseekMoney(raw: unknown): DeepseekMoney {
  if (!object(raw) || typeof raw.enabled !== 'boolean') throw new Error('每日费用配置格式不正确。');
  const money = raw as unknown as DeepseekMoney;
  for (const value of [money.soft, money.hard, money.reserve]) if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) throw new Error('预算和预留金额须大于 0，且不超过 100 万元。');
  if (money.soft > money.hard || money.reserve > money.hard) throw new Error('软预算和单任务预留不能超过上限预算。');
  if (money.safetyMargin !== undefined && (typeof money.safetyMargin !== 'number' || !Number.isFinite(money.safetyMargin) || money.safetyMargin < 0 || money.safetyMargin > money.hard)) throw new Error('安全余量须为非负金额，且不能超过上限预算。');
  if (!Number.isInteger(money.unknownSeconds) || money.unknownSeconds < 30 || money.unknownSeconds > 3600) throw new Error('无用量观测时限须为 30～3600 秒。');
  const modelPrices = money.modelPrices === undefined ? undefined : parseModelPrices(money.modelPrices, money.enabled);
  const legacyModels = money.legacyModels;
  if (legacyModels !== undefined && (!object(legacyModels) || Object.keys(legacyModels).length !== 2
    || !Object.keys(legacyModels).every(key => key === 'pro' || key === 'flash')
    || [legacyModels.pro, legacyModels.flash].some(id => typeof id !== 'string' || !MODEL.test(id) || id.includes('://')))) throw new Error('旧槽位价格的模型绑定不合法。');
  for (const price of [money.pro, money.flash]) {
    if (!object(price) || [price.input, price.cached, price.output].some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1_000_000)) throw new Error('模型单价须为 0～100 万元/百万 token。');
    if (price.cacheWrite !== undefined && (typeof price.cacheWrite !== 'number' || !Number.isFinite(price.cacheWrite) || price.cacheWrite < 0 || price.cacheWrite > 1_000_000)) throw new Error('缓存写入单价须为 0～100 万元/百万 token。');
    if (money.enabled && modelPrices === undefined && price.input === 0 && price.output === 0) throw new Error('启用预算前请填写两款模型的输入或输出单价。');
  }
  return { enabled: money.enabled, soft: money.soft, hard: money.hard, reserve: money.reserve,
    ...(money.safetyMargin === undefined ? {} : { safetyMargin: money.safetyMargin }),
    ...(modelPrices === undefined ? {} : { modelPrices }),
    ...(legacyModels === undefined ? {} : { legacyModels: { pro: legacyModels.pro, flash: legacyModels.flash } }),
    unknownSeconds: money.unknownSeconds, pro: { ...money.pro }, flash: { ...money.flash } };
}

export const defaultDeepseekEndpoint: DeepseekEndpoint = {
  baseUrl: 'https://api.deepseek.com/', wireApi: 'responses', proModel: 'deepseek-v4-pro', flashModel: 'deepseek-flash', offPeakOnly: false,
};

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._+\-/:]{0,159}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function parseModelPrices(raw: unknown, enabled: boolean): Record<string, DeepseekPrice> {
  if (!object(raw) || Object.keys(raw).length > 128) throw new Error('实际模型价表须为配置表，最多128项。');
  const prices: Record<string, DeepseekPrice> = {};
  for (const [model, price] of Object.entries(raw)) {
    if (!MODEL.test(model) || model.includes('://') || ['constructor', 'prototype', '__proto__'].includes(model)) throw new Error('实际模型价表的模型ID不合法。');
    if (!object(price) || Object.keys(price).some(key => !['input', 'cached', 'output', 'cacheWrite'].includes(key))
      || [price.input, price.cached, price.output, ...(price.cacheWrite === undefined ? [] : [price.cacheWrite])]
        .some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000)
      || (enabled && price.input === 0 && price.output === 0)) throw new Error('实际模型单价须合法，启用预算时输入或输出单价须大于0。');
    prices[model] = { input: price.input as number, cached: price.cached as number, output: price.output as number,
      ...(price.cacheWrite === undefined ? {} : { cacheWrite: price.cacheWrite as number }) };
  }
  return prices;
}

export function deepseekModelPrice(money: DeepseekMoney, model: string, legacySlot: 'pro' | 'flash'): DeepseekPrice {
  const checked = deepseekMoney(money);
  if (checked.modelPrices !== undefined) {
    if (!Object.hasOwn(checked.modelPrices, model)) throw new Error(`实际模型 ${model} 尚未配置单价，已暂停派活。`);
    return { ...checked.modelPrices[model] };
  }
  if (checked.legacyModels && checked.legacyModels[legacySlot] !== model) throw new Error(`实际模型 ${model} 尚未配置单价，不能沿用旧模型价格。`);
  return { ...checked[legacySlot] };
}
const budgetGroupName = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);

function deepseekMoneyGroups(value: unknown): Record<string, DeepseekMoney> {
  if (!object(value) || Object.keys(value).length > 32) throw new Error('费用预算组须为配置表，最多32个非默认组。');
  const groups: Record<string, DeepseekMoney> = {};
  for (const [group, money] of Object.entries(value)) {
    if (!budgetGroupName(group) || group === 'default') throw new Error('费用预算组名称不合法；默认组请使用原每日费用配置。');
    groups[group] = deepseekMoney(money);
  }
  return groups;
}

// 查找运行记录的冻结组；不能用当前编辑连接或其他组做缺失兜底。
export function deepseekBudgetForGroup(endpoint: DeepseekEndpoint, group = 'default'): DeepseekMoney | undefined {
  if (!budgetGroupName(group)) throw new Error('费用预算组名称不合法。');
  if (group === 'default') return endpoint.money === undefined ? undefined : deepseekMoney(endpoint.money);
  const groups = deepseekMoneyGroups(endpoint.moneyGroups);
  if (!Object.hasOwn(groups, group)) throw new Error('任务所属费用预算组配置缺失，已暂停收费调用。');
  return groups[group];
}

export function deepseekEndpoint(value: unknown): DeepseekEndpoint {
  if (!object(value) || !Object.keys(value).every(k => ['baseUrl', 'wireApi', 'proModel', 'flashModel', 'offPeakOnly', 'proReasoning', 'flashReasoning', 'reasoningCapabilities', 'money', 'moneyGroups', 'budgetGroup'].includes(k))) {
    throw new Error('DeepSeek 设置须包含接口地址、协议和两个模型 ID。');
  }
  const { baseUrl, wireApi, proModel, flashModel, offPeakOnly = false } = value;
  if (typeof baseUrl !== 'string' || baseUrl.length > 500) throw new Error('DeepSeek 接口地址不合法。');
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('DeepSeek 接口地址必须是完整的 http 或 https 网址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('DeepSeek 接口地址只能是 http 或 https 网址，不能带账号、查询参数或锚点。');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol === 'http:' && !loopback) throw new Error('DeepSeek 公网接口必须使用 HTTPS，避免 API 密钥被明文窃取；HTTP 只允许本机地址。');
  if (!deepseekWireApis.includes(wireApi as DeepseekWireApi)) throw new Error('DeepSeek 接口协议只能选 Responses 或 Chat Completions。');
  if (typeof proModel !== 'string' || !MODEL.test(proModel) || typeof flashModel !== 'string' || !MODEL.test(flashModel)) {
    throw new Error('DeepSeek 模型 ID 格式不对，请按中转站的模型名填写。');
  }
  if (typeof offPeakOnly !== 'boolean') throw new Error('DeepSeek 闲时派活开关只能是开或关。');
  for (const key of ['proReasoning', 'flashReasoning'] as const) {
    if (value[key] !== undefined && value[key] !== 'default' && value[key] !== 'high') throw new Error('DeepSeek 推理强度只允许默认或已配置的高档。');
  }
  const pathname = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
  url.pathname = pathname;
  const groups = value.moneyGroups === undefined ? undefined : deepseekMoneyGroups(value.moneyGroups);
  if (value.budgetGroup !== undefined && (!budgetGroupName(value.budgetGroup)
    || value.budgetGroup !== 'default' && !Object.hasOwn(groups ?? {}, value.budgetGroup))) throw new Error('所选费用预算组配置缺失或名称不合法。');
  return { baseUrl: url.toString(), wireApi: wireApi as DeepseekWireApi, proModel, flashModel, offPeakOnly,
    ...(value.reasoningCapabilities === undefined ? {} : { reasoningCapabilities: reasoningCapabilities(value.reasoningCapabilities) }),
    ...(value.money !== undefined ? { money: deepseekMoney(value.money) } : {}),
    ...(groups === undefined ? {} : { moneyGroups: groups }),
    ...(value.budgetGroup === undefined ? {} : { budgetGroup: value.budgetGroup }),
    ...(value.proReasoning ? { proReasoning: value.proReasoning as 'default' | 'high' } : {}),
    ...(value.flashReasoning ? { flashReasoning: value.flashReasoning as 'default' | 'high' } : {}) };
}

function reasoningCapabilities(raw: unknown): DeepseekReasoningCapabilities {
  if (!object(raw) || Object.keys(raw).some(key => !['baseUrl', 'wireApi', 'models'].includes(key)) || !object(raw.models) || Object.keys(raw.models).length > 128) throw new Error('推理能力声明格式不正确，最多128个实际模型。');
  // 复用连接规范化；这里不递归携带能力字段，也不读取密钥或推断目录能力。
  const connection = deepseekEndpoint({ ...defaultDeepseekEndpoint, baseUrl: raw.baseUrl, wireApi: raw.wireApi });
  const models: DeepseekReasoningCapabilities['models'] = {};
  for (const [id, entry] of Object.entries(raw.models)) {
    if (!MODEL.test(id) || ['constructor', 'prototype', '__proto__'].includes(id) || !object(entry)
      || Object.keys(entry).some(key => !['high', 'source', 'updatedAt'].includes(key)) || typeof entry.high !== 'boolean'
      || entry.source !== 'user' || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))
      || new Date(entry.updatedAt).toISOString() !== entry.updatedAt) throw new Error('推理能力须注明实际模型、用户确认来源和ISO更新时间，不能用目录列表猜测。');
    models[id] = { high: entry.high, source: 'user', updatedAt: entry.updatedAt };
  }
  return { baseUrl: connection.baseUrl, wireApi: connection.wireApi, models };
}

export function assertDeepseekReasoning(endpoint: DeepseekEndpoint, model: string, mode: 'default' | 'high' = 'high'): void {
  if (mode === 'default') return;
  const capability = endpoint.reasoningCapabilities;
  if (!capability || capability.baseUrl !== endpoint.baseUrl || capability.wireApi !== endpoint.wireApi
    || !Object.hasOwn(capability.models, model) || !capability.models[model].high) {
    throw new Error(`模型 ${model} 的高档推理能力尚未确认或不支持，请选择默认强度，或按当前连接确认该模型能力后再派活。`);
  }
}

// DeepSeek 官方峰谷计价（2026-08-17 起）：北京时间工作日 09:00–12:00、14:00–18:00 为高峰。
// 周末可直接确定为闲时；法定节假日需年度日历，未命中时保守按普通工作日处理，不会在可能的高峰误派。
export function deepseekOffPeak(at = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at).reduce<Record<string, string>>((all, part) => (all[part.type] = part.value, all), {});
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  // 国务院 2026 年放假安排中的法定休假日；未来年份在公布后补入，未命中时保守按工作日计。
  const holiday2026 = [
    ['2026-01-01', '2026-01-03'], ['2026-02-15', '2026-02-23'], ['2026-04-04', '2026-04-06'],
    ['2026-05-01', '2026-05-05'], ['2026-06-19', '2026-06-21'], ['2026-09-25', '2026-09-27'], ['2026-10-01', '2026-10-07'],
  ] as const;
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun' || holiday2026.some(([from, to]) => date >= from && date <= to)) return true;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return !((minute >= 9 * 60 && minute < 12 * 60) || (minute >= 14 * 60 && minute < 18 * 60));
}

export function assertDeepseekAvailable(endpoint: DeepseekEndpoint, selected: boolean, at = new Date()): void {
  if (endpoint.offPeakOnly && selected && !deepseekOffPeak(at)) {
    throw new Error('DeepSeek 已开启“仅闲时派活”；当前是官方高峰时段（北京时间工作日 09:00–12:00、14:00–18:00），请改派其他选手或等到闲时。');
  }
}

export function effectiveDeepseekEndpoint(value: unknown): DeepseekEndpoint {
  try { return deepseekEndpoint(value); } catch { return { ...defaultDeepseekEndpoint }; }
}
