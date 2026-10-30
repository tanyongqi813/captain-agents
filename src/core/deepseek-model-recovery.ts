import { createHash } from 'node:crypto';
import { mkdir, open, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { paths, jobDir } from './paths.ts';
import { hasCode, readJson, withLock, writeJson } from './fsx.ts';
import { readDeepseekCatalogConsent, readDeepseekRuntimeSettings, withDeepseekCatalogConsent } from './settings.ts';
import type { DeepseekCatalogConsent } from './settings.ts';
import { deepseekCredentialVersion } from './deepseek-credentials.ts';
import { catalogRefreshController } from './deepseek-catalog-loop.ts';
import { refreshScheduledDeepseekCatalog } from './deepseek-catalog-refresh.ts';
import type { Job } from './job.ts';

const summary = '模型或推理强度不受支持，请检查连接、模型及强度设置；目录核对仅在原授权和身份仍有效时尝试一次，不会自动重试推理或切换模型。';
const root = () => join(paths().home, 'model-error-recovery');
type Recovery = { version: 1; id: string; round: number; baseUrl: string; wireApi: string; consent: DeepseekCatalogConsent };
const nameOf = (id: string, round: number) => createHash('sha256').update(JSON.stringify([id, round])).digest('hex') + '.json';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function isDeepseekModelError(line: string): boolean {
  try {
    const row: unknown = JSON.parse(line);
    if (!object(row) || !['error', 'turn.failed'].includes(String(row.type))) return false;
    const error = object(row.error) ? row.error : row.type === 'error' ? row : null;
    return !!error && (error.code === 'model_not_found' || error.code === 'unsupported_parameter'
      && ['reasoning_effort', 'model_reasoning_effort'].includes(String(error.param)));
  } catch { return false; }
}

async function tailHasError(job: Job): Promise<boolean> {
  let file;
  try {
    file = await open(join(jobDir(job.id), 'run.log'), 'r');
    const size = (await file.stat()).size, start = Math.max(0, size - 65_536), buffer = Buffer.alloc(Math.min(size, 65_536));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (start) lines.shift(); // 首行可能从JSON中间截断，宁缺勿猜。
    return lines.some(isDeepseekModelError);
  } catch (error) { if (hasCode(error, 'ENOENT')) return false; throw error; }
  finally { await file?.close(); }
}

// runner只读有限日志并登记非密钥事实；此入口没有网络适配器。
export async function recordDeepseekModelError(job: Job): Promise<string | null> {
  if (!['deepseek', 'deepseek-flash'].includes(job.who) || !await tailHasError(job)) return null;
  try {
    const consent = await readDeepseekCatalogConsent(), saved = await readDeepseekRuntimeSettings(), frozen = job.deepseekConnection;
    if (!consent.enabled || !frozen || frozen.baseUrl !== saved.baseUrl || frozen.wireApi !== saved.wireApi
      || !job.deepseekCredentialVersion || job.deepseekCredentialVersion !== await deepseekCredentialVersion()) return summary;
    const round = job.resume?.round ?? 1;
    if (!Number.isSafeInteger(round) || round < 1) return summary;
    const name = nameOf(job.id, round);
    await withLock(root(), async () => {
      for (const state of ['pending', 'history']) {
        try { await readJson(join(root(), state, name)); return; }
        catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
      }
      await mkdir(join(root(), 'pending'), { recursive: true });
      await writeJson(join(root(), 'pending', name), { version: 1, id: job.id, round, baseUrl: saved.baseUrl, wireApi: saved.wireApi, consent } satisfies Recovery);
    });
  } catch { /* 原始异常不落盘，不阻断报告/费用收尾；固定摘要回交。 */ }
  return summary;
}

function recovery(value: unknown, name: string): Recovery {
  const row = value as Recovery | null;
  if (!row || row.version !== 1 || typeof row.id !== 'string' || !Number.isSafeInteger(row.round) || row.round < 1
    || nameOf(row.id, row.round) !== name || typeof row.baseUrl !== 'string' || !['chat', 'responses'].includes(row.wireApi)
    || row.consent?.enabled !== true || !/^[a-f0-9]{64}$/.test(row.consent.binding ?? '')
    || !/^[a-f0-9-]{36}$/i.test(row.consent.grant ?? '')) throw new Error('模型错误核对登记损坏，未发起查询。');
  return row;
}

// 桌面拥有请求与取消生命周期；认领先移入history，失败/崩溃/冷却都不重放。
export function modelErrorRecoveryController(request: typeof fetch, changed: () => Promise<void>, onError: (summary: string) => void) {
  let stopped = false, checking = false, active: ReturnType<typeof catalogRefreshController> | undefined;
  const warn = () => { if (!stopped) onError('模型错误目录核对未完成，请检查设置；不会自动重试推理。'); };
  const poll = async () => {
    if (stopped) return;
    if (active) { await active.poll(); return; }
    if (checking) return;
    checking = true;
    try {
      const record = await withLock(root(), async () => {
        let names: string[];
        try { names = await readdir(join(root(), 'pending')); } catch (error) { if (hasCode(error, 'ENOENT')) return null; throw error; }
        const name = names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()[0];
        if (!name) return null;
        const source = join(root(), 'pending', name), destination = join(root(), 'history', name);
        const item = recovery(await readJson(source), name);
        // 已消费的同名登记不允许重新请求，也不覆盖历史。
        try { await readJson(destination); return null; } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
        await mkdir(join(root(), 'history'), { recursive: true }); await rename(source, destination); return item;
      });
      if (!record || stopped) return;
      const disabled: DeepseekCatalogConsent = { enabled: false, binding: null, grant: null };
      const consent = async () => {
        const current = await readDeepseekCatalogConsent();
        return current.enabled && current.binding === record.consent.binding && current.grant === record.consent.grant ? current : disabled;
      };
      const guarded: typeof fetch = async (url, init) => {
        const { pending } = await withDeepseekCatalogConsent(record.consent, async saved => {
          if (saved.baseUrl !== record.baseUrl || saved.wireApi !== record.wireApi) throw new Error('原连接已改变。');
          return { pending: request(url, init).then(value => ({ value }), (error: unknown) => ({ error })) };
        });
        const result = await pending; if ('error' in result) throw result.error; return result.value;
      };
      const loop = catalogRefreshController(guarded, changed, warn, { consent, refresh: refreshScheduledDeepseekCatalog });
      active = loop; await loop.poll(); await loop.settled(); loop.stop();
    } catch { warn(); }
    finally { active = undefined; checking = false; }
  };
  return { poll, stop: () => { stopped = true; active?.stop(); } };
}
