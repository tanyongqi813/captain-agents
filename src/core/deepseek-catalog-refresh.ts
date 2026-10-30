import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { paths } from './paths.ts';
import { hasCode, readJson, withLock, writeJson } from './fsx.ts';
import { readDeepseekCatalogConsent, withDeepseekCatalogConsent } from './settings.ts';
import { refreshConsentedDeepseekCatalog } from './deepseek-models.ts';
import { CatalogRefreshSchedule } from './deepseek-catalog-schedule.ts';

const dir = () => join(paths().home, 'catalog-refresh-control');
const file = () => join(dir(), 'state.json');
async function load() {
  let raw: unknown;
  try { raw = await readJson(file()); }
  catch (error) {
    if (hasCode(error, 'ENOENT')) return { schedule: new CatalogRefreshSchedule(), owner: null as string | null };
    throw new Error('模型刷新调度记录无法读取，已停止自动刷新。');
  }
  const row = raw as { version?: unknown; schedule?: unknown; owner?: unknown } | null;
  if (!row || row.version !== 1 || row.schedule === undefined || !(row.owner === null || (typeof row.owner === 'string' && /^[0-9a-f-]{36}$/i.test(row.owner)))) {
    throw new Error('模型刷新调度记录损坏，已停止自动刷新。');
  }
  const schedule = new CatalogRefreshSchedule(row.schedule);
  if (!!schedule.currentTicket() !== (row.owner !== null)) throw new Error('模型刷新租约不一致，已停止自动刷新。');
  return { schedule, owner: row.owner as string | null };
}
async function save(schedule: CatalogRefreshSchedule, owner: string | null) {
  await writeJson(file(), { version: 1, schedule: schedule.snapshot(), owner });
}

// 一次受控tick，不创建定时器、不提供默认fetch。false表示未授权/冷却/其他进程在途。
export async function refreshScheduledDeepseekCatalog(request: typeof fetch, now: () => number = Date.now): Promise<boolean> {
  const consent = await readDeepseekCatalogConsent();
  if (!consent.enabled) return false;
  const owner = randomUUID();
  const claimed = await withLock(dir(), async () => {
    const record = await load(), schedule = record.schedule;
    schedule.configure(`${consent.binding}:${consent.grant}`);
    const ticket = schedule.take(now());
    await save(schedule, ticket ? owner : schedule.currentTicket() ? record.owner : null);
    return !!ticket;
  });
  if (!claimed) return false;
  try {
    const guarded: typeof fetch = async (url, init) => {
      // 原子替换文件的只读核对不取调度锁，避免请求发起的设置锁→调度锁与提交路径反序。
      const record = await load(), ticket = record.schedule.currentTicket();
      if (record.owner !== owner || !ticket || now() >= ticket.deadline) throw new Error('模型刷新租约已过期，已拒绝请求。');
      // 只读租约核对有await，期间可能撤销授权；实际发起前再锁内核验，不能沿用上层旧检查。
      const { pending } = await withDeepseekCatalogConsent(consent, async () => ({
        pending: request(url, init).then(value => ({ value }), (error: unknown) => ({ error })),
      }));
      const result = await pending; if ('error' in result) throw result.error; return result.value;
    };
    await refreshConsentedDeepseekCatalog(consent, guarded, (write, success) => withLock(dir(), async () => {
      const record = await load(), ticket = record.schedule.currentTicket();
      if (record.owner !== owner || !ticket) throw new Error('模型刷新租约已失效，拒绝旧结果。');
      if (!record.schedule.complete(ticket, success, now())) {
        await save(record.schedule, null); throw new Error('模型刷新结果已超时，拒绝写入目录。');
      }
      await write(); await save(record.schedule, null);
    }));
    return true;
  } catch (error) {
    await withLock(dir(), async () => {
      const record = await load(), ticket = record.schedule.currentTicket();
      if (record.owner !== owner || !ticket) return;
      record.schedule.complete(ticket, false, now()); await save(record.schedule, null);
    });
    throw error;
  }
}
