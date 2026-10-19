import { createHmac } from 'node:crypto';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from './paths.ts';
import { hasCode, readJson, withLock, writeJson } from './fsx.ts';
import { listAutopilots } from './autopilot.ts';
import type { AutopilotRun } from './autopilot.ts';
import { isOwnerCode, ownerReasons } from './autopilot-diagnosis.ts';
import type { OwnerCode } from './autopilot-diagnosis.ts';

// run.json 内的 ownerEvent 是事务性发件箱；这里的逐事件账本只是可重建的投递状态。
// 因此转 needs_owner 后、复制到队列前退出，不会漏事件。绝不保存 AI 原文或网络异常原文。
export type FeishuCredentials = { webhook: string; secret?: string };
export type DeliveryError = 'network' | 'rate_limit' | 'server' | 'response' | 'connection';
export type OwnerNotice = {
  version: 1; id: string; run: string; task: string; project: string; at: string;
  code?: OwnerCode; budget?: 'minutes' | 'attempts' | 'nodes' | 'usage';
  state: 'pending' | 'delivered' | 'handled' | 'expired' | 'paused' | 'exhausted';
  attempts: number; nextAt: string; deliveredAt?: string; error?: DeliveryError;
};
export const noticeErrors: Record<DeliveryError, string> = {
  network: '网络暂时不可用，稍后重试。', rate_limit: '飞书暂时限流，稍后重试。',
  server: '飞书暂时不可用，稍后重试。', response: '飞书未确认送达，稍后重试。',
  connection: '需要检查飞书机器人连接。',
};
export const NOTICE_TTL_MS = 7 * 86_400_000;
export const NOTICE_MAX_ATTEMPTS = 8;
const MAX_PER_TICK = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN = /^\d{4}-\d{4}-auto(?:-\d+)?$/;
const TASK = /^TASK-\d{1,6}$/;
const STATES = ['pending', 'delivered', 'handled', 'expired', 'paused', 'exhausted'];
const KEYS = ['version', 'id', 'run', 'task', 'project', 'at', 'code', 'budget', 'state', 'attempts', 'nextAt', 'deliveredAt', 'error'];
const when = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const safeProject = (name: string) => /^[\p{L}\p{N}_-]{1,40}$/u.test(name) && !/[A-Za-z0-9_-]{24}/.test(name) ? name : '已登记项目';
export const ownerNoticesDir = () => join(paths().home, 'owner-notifications');
const noticeFile = (id: string) => {
  if (!UUID.test(id)) throw new Error('通知事件编号不对。');
  return join(ownerNoticesDir(), `${id}.json`);
};
function parseNotice(value: unknown): OwnerNotice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('通知账本格式不对。');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !KEYS.includes(k)) || r.version !== 1 || typeof r.id !== 'string' || !UUID.test(r.id)
    || typeof r.run !== 'string' || !RUN.test(r.run) || typeof r.task !== 'string' || !TASK.test(r.task)
    || typeof r.project !== 'string' || safeProject(r.project) !== r.project || !when(r.at) || !when(r.nextAt)
    || !STATES.includes(String(r.state)) || !Number.isInteger(r.attempts) || Number(r.attempts) < 0 || Number(r.attempts) > NOTICE_MAX_ATTEMPTS
    || r.code !== undefined && !isOwnerCode(r.code)
    || r.budget !== undefined && !['minutes', 'attempts', 'nodes', 'usage'].includes(String(r.budget))
    || r.deliveredAt !== undefined && !when(r.deliveredAt)
    || r.error !== undefined && !Object.hasOwn(noticeErrors, String(r.error))) throw new Error('通知账本格式不对。');
  return r as OwnerNotice;
}
async function readNotices(): Promise<OwnerNotice[]> {
  let files: string[];
  try { files = await readdir(ownerNoticesDir()); } catch (e) { if (hasCode(e, 'ENOENT')) return []; throw e; }
  const out: OwnerNotice[] = [];
  for (const file of files.sort()) {
    if (!UUID.test(file.slice(0, -5)) || !file.endsWith('.json')) continue;
    const full = join(ownerNoticesDir(), file);
    if ((await stat(full)).size > 16_384) throw new Error('通知账本过大。');
    const item = parseNotice(await readJson(full));
    if (`${item.id}.json` !== file) throw new Error('通知账本编号不一致。');
    out.push(item);
  }
  return out;
}
// 唯一的网络目的地址验证入口。原串也校验，拒绝 URL 自动规范化掉的控制符、点段和编码路径。
export function checkFeishuCredentials(value: unknown): FeishuCredentials {
  const bad = () => { throw new Error('飞书连接参数不对，请填写官方群机器人 Webhook 和可选签名密钥。'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad();
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !['webhook', 'secret'].includes(k)) || typeof r.webhook !== 'string'
    || !/^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{8,128}$/.test(r.webhook)
    || r.secret !== undefined && (typeof r.secret !== 'string' || r.secret.length > 256 || /[\s\x00-\x1f\x7f]/.test(r.secret))) return bad();
  return { webhook: r.webhook, ...(r.secret ? { secret: r.secret as string } : {}) };
}
export function ownerNoticeText(event: OwnerNotice): string {
  const reason = event.code ? ownerReasons[event.code] : event.budget ? '无人看守预算已用完，请主人接手。' : '无人看守已经停止自动处理，请主人查看。';
  return `派活工作台：需要主人处理\n项目：${safeProject(event.project)}\n任务：${event.task}\n执行：${event.run}\n原因：${reason}\n时间：${event.at}\n事件：${event.id.slice(0, 8)}\n请在工作台查看执行记录和证据。`;
}
export function feishuPayload(text: string, credentials: FeishuCredentials, now: number): string {
  checkFeishuCredentials(credentials);
  if (Buffer.byteLength(text) > 4096) throw new Error('通知内容过长。');
  const timestamp = String(Math.floor(now / 1000));
  // 官方协议：以 timestamp + 换行 + secret 为 HMAC key，对空消息签名。
  // https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
  return JSON.stringify({ msg_type: 'text', content: { text }, ...(credentials.secret ? {
    timestamp, sign: createHmac('sha256', `${timestamp}\n${credentials.secret}`).update('').digest('base64'),
  } : {}) });
}
export type FeishuRequest = (url: string, body: string, signal: AbortSignal) => Promise<{ status: number; body: string }>;
// 默认 Node 请求不跟重定向；整个响应有总超时及长度上限，绝不把响应文本写日志。
export const feishuRequest: FeishuRequest = async (url, body, signal) => {
  checkFeishuCredentials({ webhook: url });
  const response = await fetch(url, { method: 'POST', redirect: 'manual', signal,
    headers: { 'content-type': 'application/json' }, body });
  const reader = response.body?.getReader();
  let size = 0; const chunks: Uint8Array[] = [];
  if (reader) try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new Error('响应过大。'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return { status: response.status, body: Buffer.concat(chunks).toString('utf8') };
};
export async function sendFeishu(text: string, credentials: FeishuCredentials, request = feishuRequest, now = Date.now()): Promise<DeliveryError | null> {
  checkFeishuCredentials(credentials);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('超时')); }, 10_000); });
    const response = await Promise.race([request(credentials.webhook, feishuPayload(text, credentials, now), controller.signal), timeout]);
    if (response.status === 429) return 'rate_limit';
    if (response.status >= 500 && response.status <= 599) return 'server';
    if (response.status >= 300 && response.status <= 499) return 'connection';
    if (response.status !== 200 || Buffer.byteLength(response.body) > 16_384) return 'response';
    let result: { code?: unknown; StatusCode?: unknown };
    try { result = JSON.parse(response.body); } catch { return 'response'; }
    if (!result || typeof result !== 'object' || Array.isArray(result)) return 'response';
    if (result.code === 0 || result.code === undefined && result.StatusCode === 0) return null;
    return 'connection';
  } catch { return 'network'; }
  finally { if (timer) clearTimeout(timer); }
}
export type NoticeSource = Pick<AutopilotRun, 'id' | 'state' | 'ownerEvent' | 'ownerCode' | 'limit' | 'taskId' | 'project' | 'ended'>;
export type NoticeDeps = {
  credentials: () => Promise<FeishuCredentials | null>;
  request?: FeishuRequest; now?: () => number;
  source?: () => Promise<NoticeSource[]>;
  persist?: (event: OwnerNotice) => Promise<void>;
};
const sources = async () => {
  const list = await listAutopilots();
  if (list.broken.length) throw new Error('有执行记录无法读取，本轮保留通知队列。');
  return list.runs;
};
async function syncNotices(runs: NoticeSource[], now: number) {
  const events = await readNotices();
  for (const run of runs) {
    if (run.state !== 'needs_owner' || !run.ownerEvent || !UUID.test(run.ownerEvent) || events.some(e => e.id === run.ownerEvent)) continue;
    if (!RUN.test(run.id) || !TASK.test(run.taskId) || !when(run.ended)) continue;
    const event: OwnerNotice = { version: 1, id: run.ownerEvent, run: run.id, task: run.taskId, project: safeProject(run.project), at: run.ended,
      ...(run.ownerCode ? { code: run.ownerCode } : {}), ...(run.limit ? { budget: run.limit } : {}), state: 'pending', attempts: 0, nextAt: run.ended };
    events.push(event); await writeJson(noticeFile(event.id), event);
  }
  for (const event of events) {
    if (!['pending', 'paused', 'exhausted'].includes(event.state)) continue;
    const run = runs.find(r => r.id === event.run);
    // 来源缺失或已处理，不向外发送过期/失去上下文的求助；账本仍永久保留。
    if (!run || run.state !== 'needs_owner' || run.ownerEvent !== event.id) event.state = 'handled';
    else if (now - Date.parse(event.at) >= NOTICE_TTL_MS) event.state = 'expired';
    else continue;
    await writeJson(noticeFile(event.id), event);
  }
  return events;
}
export async function consumeOwnerNotices(deps: NoticeDeps): Promise<OwnerNotice[]> {
  await mkdir(ownerNoticesDir(), { recursive: true });
  return withLock(ownerNoticesDir(), async () => {
    const now = deps.now?.() ?? Date.now();
    const events = await syncNotices(await (deps.source ?? sources)(), now);
    let credentials: FeishuCredentials | null;
    try { credentials = await deps.credentials(); if (credentials) checkFeishuCredentials(credentials); }
    catch { return events; } // 操作系统凭据不可用时保留队列，不泄漏异常。
    if (!credentials) return events;
    const save = deps.persist ?? ((event: OwnerNotice) => writeJson(noticeFile(event.id), event));
    let sent = 0;
    for (const event of events.sort((a, b) => a.at.localeCompare(b.at))) {
      if (sent >= MAX_PER_TICK || event.state !== 'pending' || Date.parse(event.nextAt) > now) continue;
      if (event.attempts >= NOTICE_MAX_ATTEMPTS) { event.state = 'exhausted'; await writeJson(noticeFile(event.id), event); continue; }
      // 先预占一次尝试并退避落盘，再发送：请求中崩溃也不能无限刷新重试预算。
      event.attempts++;
      event.nextAt = new Date(now + Math.min(3_600_000, 30_000 * 2 ** (event.attempts - 1))).toISOString();
      await save(event); sent++;
      // 再核对一次处理状态，避免本轮同步后主人已经处理的事件继续发送。
      const current = (await (deps.source ?? sources)()).find(r => r.id === event.run);
      if (!current || current.state !== 'needs_owner' || current.ownerEvent !== event.id) event.state = 'handled';
      else {
        const error = await sendFeishu(ownerNoticeText(event), credentials, deps.request, now);
        if (error) { event.error = error; if (error === 'connection') event.state = 'paused'; else if (event.attempts >= NOTICE_MAX_ATTEMPTS) event.state = 'exhausted'; }
        else { event.state = 'delivered'; event.deliveredAt = new Date(now).toISOString(); delete event.error; }
      }
      await save(event);
    }
    return events;
  }, 45_000);
}
// 主人确认已经处理/更换连接时的受控入口；不能改原因、正文、事件号或伪造送达。
export async function handleOwnerNotice(id: string): Promise<void> {
  await withLock(ownerNoticesDir(), async () => {
    const event = parseNotice(await readJson(noticeFile(id)));
    if (event.state !== 'delivered') { event.state = 'handled'; await writeJson(noticeFile(id), event); }
  });
}
export async function retryPausedOwnerNotices(): Promise<void> {
  await withLock(ownerNoticesDir(), async () => {
    for (const event of await readNotices()) if (event.state === 'paused') {
      event.state = event.attempts >= NOTICE_MAX_ATTEMPTS ? 'exhausted' : 'pending';
      await writeJson(noticeFile(event.id), event);
    }
  });
}
export const readOwnerNotices = () => withLock(ownerNoticesDir(), readNotices);
// 只读 View 不建目录、不申请会落盘的锁；逐事件文件均由 atomic rename 替换。
export const readOwnerNoticesReadonly = readNotices;
