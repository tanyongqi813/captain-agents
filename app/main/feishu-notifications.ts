import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { hasCode, withLock, writeAtomic } from '../../src/core/fsx.ts';
import { checkFeishuCredentials, consumeOwnerNotices } from '../../src/core/owner-notifications.ts';
import type { FeishuCredentials, NoticeDeps } from '../../src/core/owner-notifications.ts';
import { randomUUID } from 'node:crypto';
import { noticeErrors, sendFeishu } from '../../src/core/owner-notifications.ts';
import type { DeliveryError, FeishuRequest } from '../../src/core/owner-notifications.ts';
import type { FeishuStatus } from '../shared/ipc.ts';

type Stored = { version: 1; credentials: FeishuCredentials; test?: { at: string; error: DeliveryError | null }; lastSuccess?: string };

export type SecretStorage = {
  isEncryptionAvailable: () => boolean;
  getSelectedStorageBackend?: () => string;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
};
export function feishuCredentialStore(directory: string, storage: SecretStorage) {
  const folder = join(directory, 'protected-credentials');
  const file = join(folder, 'feishu.enc');
  const available = () => storage.isEncryptionAvailable() && storage.getSelectedStorageBackend?.() !== 'basic_text';
  const lock = <T>(fn: () => Promise<T>) => withLock(folder, fn);
  const read = async (): Promise<Stored | null> => {
    if (!available()) return null;
    let encrypted: Buffer;
    try { encrypted = await readFile(file); } catch (e) { if (hasCode(e, 'ENOENT')) return null; throw new Error('飞书凭据无法读取，请重新连接。'); }
    if (encrypted.length > 16_384) throw new Error('飞书凭据无法读取，请重新连接。');
    try {
      const value = JSON.parse(storage.decryptString(encrypted));
      // TASK-013 已有密文只含凭据；首次保存/测试时才迁移，不明文落盘。
      if (value?.version !== 1) return { version: 1, credentials: checkFeishuCredentials(value) };
      const credentials = checkFeishuCredentials(value.credentials), probe = value.test;
      if (probe !== undefined && (!probe || typeof probe.at !== 'string' || probe.at.length > 40 || !Number.isFinite(Date.parse(probe.at))
        || probe.error !== null && !Object.hasOwn(noticeErrors, probe.error))) throw new Error();
      const lastSuccess = value.lastSuccess ?? (probe?.error === null ? probe.at : undefined);
      if (lastSuccess !== undefined && (typeof lastSuccess !== 'string' || lastSuccess.length > 40 || !Number.isFinite(Date.parse(lastSuccess)))) throw new Error();
      return { version: 1, credentials, ...(probe ? { test: { at: probe.at, error: probe.error } } : {}), ...(lastSuccess ? { lastSuccess } : {}) };
    }
    catch { throw new Error('飞书凭据无法解密，请重新连接。'); }
  };
  const save = async (value: Stored) => {
    if (!available()) throw new Error('系统安全存储不可用，未保存凭据。');
    let encrypted: Buffer;
    try { encrypted = storage.encryptString(JSON.stringify(value)); }
    catch { throw new Error('系统安全存储失败，原连接没有改变。'); }
    try { await mkdir(folder, { recursive: true }); await writeAtomic(file, encrypted); }
    catch { throw new Error('保存飞书连接失败，原连接没有改变。'); }
  };
  return {
    // 仅后台使用；绝不传入 View 或回传窗口。
    read: () => lock(async () => (await read())?.credentials ?? null),
    async status(): Promise<Pick<FeishuStatus, 'connected' | 'protected' | 'target' | 'issue' | 'lastTest' | 'lastSuccess'>> {
      if (!available()) return { connected: false, protected: false, lastSuccess: null, issue: '系统安全存储不可用，未读取或保存凭据。' };
      try { const value = await lock(read); return { connected: value !== null, protected: true, lastSuccess: value?.lastSuccess ?? null, ...(value ? { target: '飞书群机器人', ...(value.test ? { lastTest: { at: value.test.at, ok: !value.test.error, ...(value.test.error ? { error: noticeErrors[value.test.error] } : {}) } } : {}) } : {}) }; }
      catch { return { connected: false, protected: true, lastSuccess: null, issue: '凭据不可用，请重新连接飞书机器人。' }; }
    },
    async save(value: unknown) {
      const credentials = checkFeishuCredentials(value);
      return lock(() => save({ version: 1, credentials }));
    },
    async test(request?: FeishuRequest, now = Date.now()) {
      return lock(async () => {
        const value = await read(); if (!value) throw new Error('请先连接飞书机器人。');
        const error = await sendFeishu(`派活工作台：测试通知\n连接测试，不代表任务需要处理。\n测试事件：${randomUUID()}`, value.credentials, request, now);
        try { await save({ ...value, test: { at: new Date(now).toISOString(), error }, ...(!error ? { lastSuccess: new Date(now).toISOString() } : {}) }); }
        catch { throw new Error(error ? '测试未送达，且测试状态未能保存，请检查连接。' : '测试已送达，但测试状态未能保存，请检查系统安全存储。'); }
      });
    },
    disconnect: () => lock(async () => { try { await rm(file, { force: true }); } catch { throw new Error('断开失败，原连接没有改变。'); } }),
  };
}

// 串行、无重入、每轮有界。定时器只在桌面进程存活时存在；关闭窗口退出时显式停止。
export function feishuNotificationScheduler(deps: NoticeDeps, options: {
  everyMs?: number; onError?: () => void;
  setInterval?: typeof setInterval; clearInterval?: typeof clearInterval;
  run?: () => Promise<unknown>;
} = {}) {
  let stopped = false, running: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const wake = () => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = (options.run ? options.run() : consumeOwnerNotices(deps)).then(() => {}, () => { options.onError?.(); }).finally(() => { running = undefined; });
    return running;
  };
  return {
    wake,
    start() {
      if (timer || stopped) return;
      timer = (options.setInterval ?? setInterval)(() => { void wake(); }, options.everyMs ?? 30_000);
      timer.unref?.(); void wake();
    },
    stop() { stopped = true; if (timer) (options.clearInterval ?? clearInterval)(timer); timer = undefined; },
    settled: () => running ?? Promise.resolve(),
  };
}
