export const deepseekWireApis = ['responses', 'chat'] as const;
export type DeepseekWireApi = typeof deepseekWireApis[number];
export type DeepseekEndpoint = { baseUrl: string; wireApi: DeepseekWireApi; proModel: string; flashModel: string; offPeakOnly: boolean };

export const defaultDeepseekEndpoint: DeepseekEndpoint = {
  baseUrl: 'https://api.deepseek.com/', wireApi: 'responses', proModel: 'deepseek-v4-pro', flashModel: 'deepseek-flash', offPeakOnly: false,
};

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._+\-/:]{0,159}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function deepseekEndpoint(value: unknown): DeepseekEndpoint {
  if (!object(value) || !Object.keys(value).every(k => ['baseUrl', 'wireApi', 'proModel', 'flashModel', 'offPeakOnly'].includes(k))) {
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
  const pathname = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
  url.pathname = pathname;
  return { baseUrl: url.toString(), wireApi: wireApi as DeepseekWireApi, proModel, flashModel, offPeakOnly };
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
