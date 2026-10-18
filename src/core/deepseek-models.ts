import { join } from 'node:path';
import { readOptional } from './fsx.ts';
import { deepseekHome } from './sandbox.ts';
import { deepseekEndpoint } from './deepseek-settings.ts';
import type { DeepseekEndpoint } from './deepseek-settings.ts';

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._+\-/:]{0,159}$/;

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
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 2_000_000) throw new Error('中转站返回的模型列表过大。');
    return parseDeepseekModels(await response.json());
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('获取模型超时，请检查中转站地址。');
    throw error;
  } finally { clearTimeout(timer); }
}
