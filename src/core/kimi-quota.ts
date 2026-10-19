// Kimi Code 套餐查询：官方 CLI 2.2.0 实测（docs/research/kimi-usage-2026-10-18.md、TASK-019 探针）。
// 两条受支持的路径，都不发起模型推理：
//  1. `kimi provider list --json`：文档写明“Emit the raw providers/models config as JSON”的非交互命令，
//     用来分辨官方登录（managed + oauth）与自定义接口/中转站。输出可能含 API key，只在内存里解析，绝不落盘。
//  2. 交互 TUI 里的 `/usage` 控制命令（官方斜杠命令文档，任何时候可用；`/status` 不是它的别名）。
//     不能用 `kimi -p /usage`：新版文档只保证 prompt 模式处理 `/goal` 创建，其余斜杠输入会当普通消息发给模型，
//     会把查询变成一次推理请求。这里像 Cursor 一样走 pty 桥发交互 `/usage`，有界收尾。
// 2026-10-18 两次真实探针（CLI 2.2.0，临时 KIMI_CODE_HOME）：
// - 面板分节 Session usage / Context window / Plan usage；Plan usage 才是账户窗口。本账号实测
//   “5h limit 100% used resets in 4h 12m” + “Monthly limit 5% used resets in 30d 23h 12m”（倒计时可能
//   是 Nh Nm 或 Nd Nh Nm 混合），窗口下还有 “kimi 1% · code 4%” 分类小字，不是窗口行。没有周窗口。
// - Session usage 是会话资源（“No token usage recorded yet.”），Context window 是上下文占用，都不进 bars。
// - Extra Usage 段落本账号未出现，其字段格式按主人描述做容错识别，未经真实输出验证。
// - 副作用检查：探针前后 ~/.kimi-code 全部文件 mtime 不变，无残留进程；临时状态目录自包含。
// - 全新临时状态目录首启会依次弹“信任目录”和“kimi-cli 迁移向导”两个交互对话框，不发按键应答会被挡死，
//   所以 writes 序列先盲答这两组对话框（没有对话框时这些按键只是空提交，无害）再发 /usage。
// - 窗口按实际返回保留，缺哪种都不补造；自定义接口（classifyKimiProvider 抛 KimiCustomProvider）不查官方套餐。
import { stripVTControlCharacters } from 'node:util';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { paths, toolRoot } from './paths.ts';
import { spec } from './roster.ts';
import { createHash } from 'node:crypto';

export type KimiQueryCommand = {
  file: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number;
  input?: string; writes?: { afterMs: number; text: string }[]; complete?: (output: string) => boolean;
  graceMs?: number;
};
export type KimiQueryExecutor = (command: KimiQueryCommand) => Promise<string>;

// 加油包（Extra Usage）：独立付费元数据，和套餐窗口分开。缺失（null）是未知，零是零，未启用是未启用，不混。
export type KimiExtraUsage = { enabled: boolean | null; spent: number | null; monthlyLimit: number | null; balance: number | null; currency: string | null };
export type KimiQuotaBar = { label: string; used: number | null; reset: string | null; windowMinutes?: number };
export type KimiQuotaEntry = {
  name: 'Kimi Code'; icon: 'kimi'; plan: string | null; at: string; bars: KimiQuotaBar[]; extraUsage?: KimiExtraUsage | null;
  source?: string;
};

// 自定义接口/中转站：按实际付款来源处理，不能因为模型叫 Kimi 就查或展示官方套餐。
export class KimiCustomProvider extends Error {}
export class KimiUsageUnavailable extends Error {
  source: string;
  constructor(source: string) { super('本次未能读取 Kimi 套餐，请稍后刷新。'); this.source = source; }
}

const OFFICIAL_HOSTS = /(^|\.)kimi\.com$|(^|\.)moonshot\.(ai|cn|com)$/i;

type ProviderEntry = { baseUrl?: unknown; apiKey?: unknown; oauth?: unknown };
// 从 `kimi provider list --json` 的原始输出判断平台实际用的模型是不是官方登录。
// 只在这里消费原始 JSON（可能含 key），返回值不含任何敏感字段。
export function classifyKimiProvider(raw: string, model: string): string {
  let data: { providers?: Record<string, ProviderEntry>; models?: Record<string, { provider?: unknown }> };
  try { data = JSON.parse(raw); } catch { throw new Error('认不出 provider 名单：不是 JSON'); }
  if (!data || typeof data !== 'object' || !data.providers || typeof data.providers !== 'object' || !data.models || typeof data.models !== 'object')
    throw new Error('认不出 provider 名单：字段不全');
  const providerName = data.models[model]?.provider;
  if (typeof providerName !== 'string') throw new Error(`认不出 provider 名单：没有模型 ${model}`);
  const provider = data.providers[providerName];
  if (!provider || typeof provider !== 'object') throw new Error(`认不出 provider 名单：没有 ${providerName}`);
  const baseUrl = typeof provider.baseUrl === 'string' ? new URL(provider.baseUrl) : null; // 中转站的 baseUrl 可能不是合法 URL，下面分开判
  const officialByOAuth = provider.oauth !== undefined && provider.oauth !== null || providerName.startsWith('managed:');
  const officialByHost = baseUrl !== null && OFFICIAL_HOSTS.test(baseUrl.hostname);
  const hasApiKey = typeof provider.apiKey === 'string' && provider.apiKey !== '';
  if (!officialByOAuth || !officialByHost || hasApiKey)
    throw new KimiCustomProvider('接的是自定义接口，不查官方套餐');
  return createHash('sha256').update(JSON.stringify({ providerName, model, url: baseUrl!.href, oauth: provider.oauth })).digest('hex');
}

function cleanPanel(raw: string) {
  // 光标定位、清屏当分隔，避免前后两屏的字粘在一起；颜色码剥掉；进度条块换成空格。
  return stripVTControlCharacters(raw.replace(/\x1b\[[0-9;?]*[HfABCDJKG]/g, '\n')).replace(/[█░]/g, ' ').replace(/\r/g, '\n');
}
// 面板完整画出来了才算读到：标题在、收尾边框也在（边框缺失说明只收到半屏，不能当新数据）。
export function kimiUsageComplete(output: string) {
  const text = cleanPanel(output), start = text.lastIndexOf('╭ Usage');
  return start >= 0 && text.indexOf('╰', start) > start;
}
function countdownToReset(text: string | undefined, at: string): string | null {
  if (!text) return null;
  const units: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };
  const since = Date.parse(at);
  if (!Number.isFinite(since)) return null;
  let ms = 0, matched = false, match: RegExpExecArray | null;
  const re = /(\d+)\s*([dhms])/g;
  while ((match = re.exec(text))) { ms += Number(match[1]) * units[match[2]]; matched = true; }
  return matched ? new Date(since + ms).toISOString() : null;
}
// “5h limit / Weekly limit / Monthly limit / 别的 limit” → 固定中文标签；窗口分钟数只在确知时给。
function kimiWindow(name: string): { label: string; windowMinutes?: number } {
  const key = name.trim().toLowerCase();
  if (/^5\s*h(?:ours?)?\b/.test(key)) return { label: '5 小时额度', windowMinutes: 300 };
  if (/week/.test(key)) return { label: '周额度', windowMinutes: 10080 };
  if (/month/.test(key)) return { label: '月度额度' }; // 日历月，实际分钟数随月份变，不写死
  const match = /^(.+?)\s+limit$/.exec(key);
  return { label: `${match ? match[1] : name} 额度` };
}
// Extra Usage 段落（本账号未出现，格式未经真实输出验证）：按主人描述的字段做容错识别，认不出的保持未知。
function parseExtraUsage(lines: string[]): KimiExtraUsage {
  const text = lines.join(' ');
  const fields: Partial<Record<'spent' | 'monthlyLimit' | 'balance', { amount: number | null; currency: string | null }>> = {};
  const labels = [...text.matchAll(/\b(?:spent|consumed|monthly\s*(?:limit|cap)|balance)\b|已用|消耗|上限|余额|剩余/gi)];
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i], key = /spent|consumed|已用|消耗/i.test(label[0]) ? 'spent' : /monthly|上限/i.test(label[0]) ? 'monthlyLimit' : 'balance';
    const value = text.slice(label.index! + label[0].length, labels[i + 1]?.index ?? text.length).trim().replace(/^[:：]\s*/, '');
    // 必须紧邻本字段，且有明确币种；unknown/unlimited/缺值不向下一字段借数。
    const match = /^(?:(USD|CNY|EUR|GBP)\s*|([$¥￥€£])\s*)(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s|$)/i.exec(value);
    const currency = match ? match[1] ? ({ USD: '$', CNY: '¥', EUR: '€', GBP: '£' } as Record<string, string>)[match[1].toUpperCase()] : match[2] === '￥' ? '¥' : match[2] : null;
    const amount = match ? Number(match[3].replaceAll(',', '')) : null;
    fields[key] = fields[key] ? { amount: null, currency: null } : { amount: amount !== null && Number.isFinite(amount) ? amount : null, currency };
  }
  const currencies = new Set(Object.values(fields).map(f => f.currency).filter(Boolean));
  const mixed = currencies.size > 1;
  return {
    enabled: /\b(disabled|off)\b|未开启/i.test(text) ? false : /\b(enabled|on)\b|已开启/i.test(text) ? true : null,
    spent: mixed ? null : fields.spent?.amount ?? null,
    monthlyLimit: mixed ? null : fields.monthlyLimit?.amount ?? null,
    balance: mixed ? null : fields.balance?.amount ?? null,
    currency: mixed ? null : [...currencies][0] ?? null,
  };
}
export function parseKimiUsage(raw: string, at: string): KimiQuotaEntry {
  const text = cleanPanel(raw), start = text.lastIndexOf('╭ Usage');
  if (start < 0) throw new Error('界面可能改了');
  const rest = text.slice(start), end = rest.indexOf('╰');
  if (end < 0) throw new Error('界面可能改了'); // 只收到半屏
  // 去掉边框字符，逐行归类到各个小节。
  const lines = rest.slice(0, end).split('\n')
    .map(line => line.replace(/[│╭╮╰]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(line => line && !/^Usage[ ─-]*$/.test(line) && !/^[-─]+$/.test(line));
  const sections = new Map<string, string[]>();
  let current = '';
  for (const line of lines) {
    const head = /^(Session usage|Context window|Plan usage|Extra Usage)$/i.exec(line);
    if (head) { current = head[1].toLowerCase(); sections.set(current, []); continue; }
    if (current) sections.get(current)!.push(line);
  }
  if (!sections.has('session usage') && !sections.has('plan usage')) throw new Error('界面可能改了');
  const bars: KimiQuotaBar[] = [];
  for (const line of sections.get('plan usage') ?? []) {
    const row = /^(.*?)\s*(?:(\d+(?:\.\d+)?)\s*%\s*used)?(?:\s+resets?\s+in\s+(.+?))?\s*$/.exec(line);
    if (!row || (row[2] === undefined && row[3] === undefined)) continue; // 分类小字（如 “kimi 0% · code 2%”）不是窗口行
    const { label, windowMinutes } = kimiWindow(row[1]);
    bars.push({ label, used: row[2] === undefined ? null : Number(row[2]), reset: countdownToReset(row[3], at), ...(windowMinutes ? { windowMinutes } : {}) });
  }
  const extraLines = sections.get('extra usage');
  return { name: 'Kimi Code', icon: 'kimi', plan: null, at, bars, ...(extraLines ? { extraUsage: parseExtraUsage(extraLines) } : {}) };
}

export type KimiQuotaOptions = {
  execute: KimiQueryExecutor; at: string;
  now?: Date;                       // 固定采集时间（缺省 new Date()），倒计时从这一刻换算绝对重置时间
  model?: string;                   // 缺省用选手名单里 Kimi 的模型
  stateSource?: string;             // 登录状态来源目录（缺省 ~/.kimi-code）；测试传替身目录
  home?: string;                    // 测试覆盖用
};
export async function queryKimiSource(execute: KimiQueryExecutor, model = spec('kimi').model): Promise<string> {
  const { kimiPath } = await import('./workers.ts');
  const cache = paths().cache; await mkdir(cache, { recursive: true });
  return classifyKimiProvider(await execute({ file: kimiPath(), args: ['provider', 'list', '--json'], cwd: cache, timeoutMs: 15_000 }), model);
}
export async function queryKimiQuota(options: KimiQuotaOptions): Promise<KimiQuotaEntry> {
  const model = options.model ?? spec('kimi').model, at = options.at;
  const { kimiPath } = await import('./workers.ts');
  const cache = paths().cache;
  await mkdir(cache, { recursive: true });
  // 第一步：结构化入口分辨官方登录与自定义接口（只读，非交互；原始输出不落盘）。
  const sourceId = await queryKimiSource(options.execute, model);
  // 第二步：独立临时状态目录跑交互 TUI 发 /usage，与派活同款做法（config.toml、credentials 复制进临时目录）。
  // 替身测试不复制真实登录文件（XAGENTS_FAKE_WORKER），由执行器替身返回样本。
  const root = await mkdtemp(join(cache, 'kimi-usage-')), state = join(root, 'state'), work = join(root, 'work');
  try {
    await mkdir(work);
    await mkdir(join(state, 'skills'), { recursive: true });
    if (!process.env.XAGENTS_FAKE_WORKER || options.stateSource) {
      const source = options.stateSource ?? join(options.home ?? homedir(), '.kimi-code');
      for (const name of ['config.toml', 'credentials']) {
        try { await cp(join(source, name), join(state, name), { recursive: true, force: false, errorOnExist: false }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      }
    }
    // 只发 /usage 控制命令。全新临时状态目录首启实测会依次弹“信任目录”（回车收下，只写临时状态）和
    // “kimi-cli 迁移向导”（↓ ↓ 回车选 Never ask again、回车选 Config only、回车继续）两个对话框；
    // 有界执行器只能按时间盲发按键，没有对话框时它们落在输入框只是空提交/翻历史，无害。
    const raw = await options.execute({
      file: 'python3', args: [join(toolRoot, 'src/core/pty-bridge.py'), '60', '140', kimiPath(), '--skills-dir', join(state, 'skills'), '--model', model],
      cwd: work, timeoutMs: 60_000, graceMs: 3000, // 宽限要比桥的收尾宽限（1.5 秒）长，桥才来得及让 CLI 自己退出。
      env: { KIMI_CODE_HOME: state, KIMI_DISABLE_TELEMETRY: '1', CHOKIDAR_USEPOLLING: '1' },
      writes: [{ afterMs: 3000, text: '\r' },                 // 信任目录：Trust and continue
        { afterMs: 6000, text: '\x1b[B\x1b[B\r' },            // 迁移向导：Never ask again
        { afterMs: 8000, text: '\r' },                        // 迁移向导：Config only
        { afterMs: 10_000, text: '\r' },                      // 迁移向导：continue to kimi-code
        { afterMs: 14_000, text: '/usage\r' },
        { afterMs: 26_000, text: '/usage\r' },
        { afterMs: 40_000, text: '/usage\r' }],
      complete: kimiUsageComplete,
    });
    return { ...parseKimiUsage(raw, at), source: sourceId };
  } catch { throw new KimiUsageUnavailable(sourceId);
  } finally { await rm(root, { recursive: true, force: true }); }
}
