import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { hasCode, withLock, writeAtomic } from '../../src/core/fsx.ts';
import { checkFeishuCredentials, consumeOwnerNotices } from '../../src/core/owner-notifications.ts';
import type { FeishuCredentials, NoticeDeps } from '../../src/core/owner-notifications.ts';

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
  const read = async (): Promise<FeishuCredentials | null> => {
    if (!available()) return null;
    let encrypted: Buffer;
    try { encrypted = await readFile(file); } catch (e) { if (hasCode(e, 'ENOENT')) return null; throw new Error('飞书凭据无法读取，请重新连接。'); }
    if (encrypted.length > 16_384) throw new Error('飞书凭据无法读取，请重新连接。');
    try { return checkFeishuCredentials(JSON.parse(storage.decryptString(encrypted))); }
    catch { throw new Error('飞书凭据无法解密，请重新连接。'); }
  };
  return {
    // 仅后台使用；绝不传入 View 或回传窗口。
    read: () => lock(read),
    async status() {
      if (!available()) return { connected: false, protected: false, issue: '系统安全存储不可用，未读取或保存凭据。' };
      try { const value = await lock(read); return { connected: value !== null, protected: true, ...(value ? { target: '飞书群机器人' } : {}) }; }
      catch { return { connected: false, protected: true, issue: '凭据不可用，请重新连接飞书机器人。' }; }
    },
    async save(value: unknown) {
      const credentials = checkFeishuCredentials(value);
      return lock(async () => {
        if (!available()) throw new Error('系统安全存储不可用，未保存凭据。');
        let encrypted: Buffer;
        try { encrypted = storage.encryptString(JSON.stringify(credentials)); }
        catch { throw new Error('系统安全存储失败，原连接没有改变。'); }
        await mkdir(folder, { recursive: true });
        // 只有一个原子替换的加密文件，没有“元数据成功但密钥失败”的半连接状态。
        try { await writeAtomic(file, encrypted); } catch { throw new Error('保存飞书连接失败，原连接没有改变。'); }
      });
    },
    disconnect: () => lock(async () => { await rm(file, { force: true }); }),
  };
}

// 串行、无重入、每轮有界。定时器只在桌面进程存活时存在；关闭窗口退出时显式停止。
export function feishuNotificationScheduler(deps: NoticeDeps, options: {
  everyMs?: number; onError?: () => void;
  setInterval?: typeof setInterval; clearInterval?: typeof clearInterval;
} = {}) {
  let stopped = false, running: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const wake = () => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = consumeOwnerNotices(deps).then(() => {}, () => { options.onError?.(); }).finally(() => { running = undefined; });
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
