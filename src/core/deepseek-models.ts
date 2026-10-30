import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, readOptional, withLock, writeAtomic, writeJson } from './fsx.ts';
import { deepseekHome } from './sandbox.ts';
import { deepseekEndpoint } from './deepseek-settings.ts';
import type { DeepseekEndpoint } from './deepseek-settings.ts';
import { withDeepseekCatalogConsent } from './settings.ts';
import type { DeepseekCatalogConsent } from './settings.ts';

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._+\-/:]{0,159}$/;
const MAX_MODEL_RESPONSE_BYTES = 2_000_000;

async function modelResponseJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_MODEL_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('中转站返回的模型列表过大。');
  }
  if (!response.body) throw new SyntaxError('模型列表正文为空。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0, complete = false;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) { complete = true; break; }
      bytes += part.value.byteLength;
      if (bytes > MAX_MODEL_RESPONSE_BYTES) throw new Error('中转站返回的模型列表过大。');
      chunks.push(part.value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
}

async function savedKey(): Promise<string> {
  const raw = await readOptional(join(deepseekHome(), 'auth.json'));
  if (!raw) return '';
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const key = (value as Record<string, unknown>).OPENAI_API_KEY;
    return typeof key === 'string' ? key : '';
  } catch { return ''; }
}

export function parseDeepseekModels(value: unknown): string[] {
  const root = value as { data?: unknown; models?: unknown };
  const list = Array.isArray(root?.data) ? root.data : Array.isArray(root?.models) ? root.models : Array.isArray(value) ? value : null;
  if (!list) throw new Error('中转站返回的模型列表格式无法识别。');
  const models = list.map(item => typeof item === 'string' ? item : item && typeof item === 'object' ? (item as Record<string, unknown>).id : null)
    .filter((id): id is string => typeof id === 'string' && MODEL.test(id));
  const unique = [...new Set(models)].sort((a, b) => a.localeCompare(b));
  if (!unique.length) throw new Error('中转站没有返回可用的模型 ID。');
  return unique.slice(0, 500);
}

export async function queryDeepseekModels(endpointValue: DeepseekEndpoint, freshKey = '', request: typeof fetch = fetch): Promise<string[]> {
  const endpoint = deepseekEndpoint(endpointValue);
  const key = freshKey.trim() || await savedKey();
  if (!key) throw new Error('请先输入 API 密钥，或先保存一次密钥。');
  if (key.length < 8 || key.length > 500 || /\s|[\u0000-\u001f\u007f]/u.test(key)) throw new Error('API 密钥格式不对。');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await request(new URL('models', endpoint.baseUrl), { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`获取模型失败（HTTP ${response.status}），请检查地址、协议和密钥。`);
    return parseDeepseekModels(await modelResponseJson(response));
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('获取模型超时，请检查中转站地址。');
    throw error;
  } finally { clearTimeout(timer); }
}

// 模型目录（docs/tasks/TASK-031.md，attempt-01 目录基础切片）：把查询成功结果按连接持久化，
// 地址或协议不同各记各的；刷新失败保留上次成功目录并标陈旧。目录不含密钥、认证头或密钥派生指纹。
export type DeepseekCatalog = {
  version: 1;
  wireApi: DeepseekEndpoint['wireApi'];
  baseUrl: string;
  models: string[];
  fetchedAt: string;
  stale: boolean;
  // 落盘只写固定中文摘要和稳定错误码：原始异常信息可能带认证头、密钥或带凭据的地址，一律不写。
  failure: string | null;
  failureCode: string | null;
  // 用没保存过的临时密钥查出来的结果：账户身份未核验，不作为已保存连接的权威目录，也不据此放行或拦截派发。
  accountVerified: boolean;
  // 请求序号（落盘的单调计数）：早发的请求晚回来不能覆盖晚发请求已写下的结果。
  sequence: number;
};

// 落盘的失败只用这几类稳定码；http_<状态码> 只记数字，不记原文。
export type CatalogFailureCode = 'timeout' | 'network' | 'key' | 'invalid' | 'too_large' | `http_${number}`;
const FAILURE_CODE = /^(?:timeout|network|key|invalid|too_large|http_\d{3})$/;

// 把一次失败压成（稳定码, 固定中文摘要）。原始 error.message 一个字都不落盘。
export function catalogFailure(error: unknown): { code: CatalogFailureCode; summary: string } {
  const message = String((error as Error)?.message ?? '');
  if ((error as Error)?.name === 'AbortError' || message === '获取模型超时，请检查中转站地址。') return { code: 'timeout', summary: '获取模型超时，请检查中转站地址。' };
  const status = /HTTP (\d{3})/.exec(message)?.[1];
  if (status) return { code: `http_${status}` as CatalogFailureCode, summary: '中转站拒绝了这次查询，请检查地址、协议和密钥。' };
  if (/密钥/.test(message)) return { code: 'key', summary: '没有可用的 API 密钥，没有发起查询。' };
  if (error instanceof SyntaxError || /格式无法识别|没有返回可用/.test(message)) return { code: 'invalid', summary: '中转站返回的模型列表不符合约定。' };
  if (/过大/.test(message)) return { code: 'too_large', summary: '中转站返回的模型列表过大。' };
  return { code: 'network', summary: '查询模型失败，请稍后重试。' };
}

// 连接身份 = 规范化地址 + 协议。散列的是地址，不是密钥，文件名不带原始 URL 片段。
function catalogId(endpoint: DeepseekEndpoint): string {
  return createHash('sha256').update(`${endpoint.wireApi} ${endpoint.baseUrl}`).digest('hex').slice(0, 24);
}
const catalogDir = () => join(deepseekHome(), 'model-catalog');
const catalogFile = (endpoint: DeepseekEndpoint) => join(catalogDir(), `${catalogId(endpoint)}.json`);
const catalogLocks = () => join(catalogDir(), 'locks');
const sequenceFile = () => join(catalogDir(), 'sequence');
const requestFile = (endpoint: DeepseekEndpoint, verified: boolean) =>
  join(catalogDir(), `${catalogId(endpoint)}.${verified ? 'saved' : 'temporary'}.request`);

async function requestSequence(endpoint: DeepseekEndpoint, verified: boolean): Promise<number | null> {
  const raw = await readOptional(requestFile(endpoint, verified));
  if (!raw.trim()) return null;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('模型目录请求记录损坏，请检查本地缓存。');
  return value;
}

// 请求号落盘，并在跨进程锁里取号：两个进程同时开始时也不会拿到同一个号；
// 号只增不减，取 max(当前毫秒, 上次号 + 1)，所以先后顺序在落盘后仍然可比。
let sequenceQueue: Promise<unknown> = Promise.resolve();
async function nextSequence(endpoint: DeepseekEndpoint, verified: boolean): Promise<number> {
  const pending = sequenceQueue.then(() => withLock(catalogLocks(), async () => {
    const last = Number((await readOptional(sequenceFile()).catch(() => '') ?? '').trim()) || 0;
    const next = Math.max(Date.now(), last + 1);
    if (!Number.isSafeInteger(next)) throw new Error('模型目录请求序号不合法。');
    await writeAtomic(sequenceFile(), `${next}\n`);
    // 在发请求之前占位，即使首次查询失败、没有成功目录，也能拒绝旧请求回写。
    await writeAtomic(requestFile(endpoint, verified), `${next}\n`);
    return next;
  }));
  sequenceQueue = pending.catch(() => {});
  return pending;
}

function catalogOf(value: unknown): DeepseekCatalog | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  // 旧登记没有 failureCode：读作 null，历史目录照样能用。
  const failureCode = row.failureCode === undefined ? null : row.failureCode;
  if (row.version !== 1 || (row.wireApi !== 'chat' && row.wireApi !== 'responses') || typeof row.baseUrl !== 'string'
    || !Array.isArray(row.models) || row.models.some(item => typeof item !== 'string')
    || typeof row.fetchedAt !== 'string' || Number.isNaN(Date.parse(row.fetchedAt))
    || typeof row.stale !== 'boolean' || typeof row.accountVerified !== 'boolean' || typeof row.sequence !== 'number'
    || !(row.failure === null || typeof row.failure === 'string')
    || !(failureCode === null || (typeof failureCode === 'string' && FAILURE_CODE.test(failureCode)))) return null;
  return { ...row, failureCode } as unknown as DeepseekCatalog;
}

export async function readDeepseekCatalog(endpointValue: DeepseekEndpoint): Promise<DeepseekCatalog | null> {
  const endpoint = deepseekEndpoint(endpointValue);
  try { return catalogOf(await readJson(catalogFile(endpoint))); }
  catch { return null; } // 读不出（不存在或损坏）按没有目录对待，不拖垮查询。
}

async function writeCatalog(endpoint: DeepseekEndpoint, catalog: DeepseekCatalog): Promise<void> {
  await writeJson(catalogFile(endpoint), catalog);
}

export async function invalidateDeepseekCatalog(endpointValue: DeepseekEndpoint): Promise<void> {
  const endpoint = deepseekEndpoint(endpointValue);
  const sequence = await nextSequence(endpoint, true);
  await withLock(catalogLocks(), async () => {
    if (await requestSequence(endpoint, true) !== sequence) return;
    const current = await readDeepseekCatalog(endpoint);
    if (current) await writeCatalog(endpoint, { ...current, sequence, stale: true, accountVerified: false,
      failureCode: 'key', failure: '凭据已更新，请重新获取模型目录。' });
  });
}

type CatalogCommitGuard = (write: () => Promise<void>, success: boolean) => Promise<void>;
export async function refreshDeepseekCatalog(endpointValue: DeepseekEndpoint, freshKey = '', request: typeof fetch = fetch,
  commit: CatalogCommitGuard = write => write()): Promise<string[]> {
  const endpoint = deepseekEndpoint(endpointValue);
  // 用没保存过的临时密钥：账户身份未核验，成功和失败都不该改写已保存连接的权威目录。
  const verified = !freshKey.trim();
  const sequence = await nextSequence(endpoint, verified);
  try {
    const models = await queryDeepseekModels(endpointValue, freshKey, request);
    await withLock(catalogLocks(), () => commit(async () => {
      const current = await readDeepseekCatalog(endpoint);
      if (await requestSequence(endpoint, verified) !== sequence) return;
      // 临时目录不能挡住已保存凭据的结果，也不能在权威请求进行中发布。
      if (!verified && await requestSequence(endpoint, true) !== null) return;
      // 临时密钥的结果不覆盖已保存连接的权威目录；可以补写一份标注“未核验”的空位。
      if (current && current.accountVerified && !verified) return;
      await writeCatalog(endpoint, { version: 1, wireApi: endpoint.wireApi, baseUrl: endpoint.baseUrl, models,
        fetchedAt: new Date().toISOString(), stale: false, failure: null, failureCode: null, accountVerified: verified, sequence });
    }, true));
    return models;
  } catch (error) {
    const { code, summary } = catalogFailure(error);
    await withLock(catalogLocks(), () => commit(async () => {
      const current = await readDeepseekCatalog(endpoint);
      if (await requestSequence(endpoint, verified) !== sequence) return;
      if (!verified && await requestSequence(endpoint, true) !== null) return;
      // 临时密钥的失败同样不碰已保存连接的权威目录：stale、failure、序号都保持原样（F-01）。
      if (current && current.accountVerified && !verified) return;
      // 没有成功目录可保留时不动盘，只把错误交给调用方。
      if (!current) return;
      // 晚发请求已经写下更新的结果：旧请求的失败不改变它。
      if (current.accountVerified === verified && current.sequence > sequence) return;
      // 失败也占号：晚发的失败留下自己的顺序，早发的成功回来时就不会把它抹掉（F-03）。
      await writeCatalog(endpoint, { ...current, stale: true, failure: summary, failureCode: code, sequence });
    }, false)).catch(() => {}); // 标陈旧失败不改变查询本身的错误结论。
    throw error;
  }
}

// 无默认网络适配器、无后台消费者。未来调度器必须额外满足限频，不能直接作轮询入口。
export async function refreshConsentedDeepseekCatalog(consent: DeepseekCatalogConsent, request: typeof fetch,
  leaseGuard: CatalogCommitGuard = write => write()): Promise<string[]> {
  const expected = { ...consent };
  const endpoint = await withDeepseekCatalogConsent(expected, async saved => saved);
  const guardedRequest: typeof fetch = async (url, init) => {
    // 只在锁内发起，不等待响应；主人关闭授权不会被15秒网络等待阻塞。
    const { pending } = await withDeepseekCatalogConsent(expected, async () => ({
      // 锁释放本身异步；立即接住失败，防止快速网络拒绝在锁释放前成为未处理拒绝。
      pending: request(url, init).then(value => ({ value }), (error: unknown) => ({ error })),
    }));
    const result = await pending;
    if ('error' in result) throw result.error;
    return result.value;
  };
  return refreshDeepseekCatalog(endpoint, '', guardedRequest,
    (write, success) => leaseGuard(() => withDeepseekCatalogConsent(expected, async () => { await write(); }), success));
}
