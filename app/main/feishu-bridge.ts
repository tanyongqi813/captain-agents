import { consumeOwnerNotices, NOTICE_TTL_MS, noticeErrors, readOwnerNoticesReadonly, retryPausedOwnerNotices } from '../../src/core/owner-notifications.ts';
import type { FeishuRequest } from '../../src/core/owner-notifications.ts';
import type { FeishuStatus } from '../shared/ipc.ts';
import { feishuCredentialStore } from './feishu-notifications.ts';

// 只在后台持有 store 和网络实现。连接变更、测试和投递共用同一串行队列，
// 断开返回后不会有尚在发送的旧目标请求；失败不会毒化后续操作。
export function feishuActions(store: ReturnType<typeof feishuCredentialStore>, request?: FeishuRequest) {
  let tail = Promise.resolve(), waiting = 0;
  const serial = <T>(run: () => Promise<T>) => {
    if (waiting >= 4) return Promise.reject<T>(new Error('飞书连接正在处理，请稍后重试。'));
    waiting++;
    const result = tail.then(run); tail = result.then(() => {}, () => {}).finally(() => { waiting--; });
    return result;
  };
  const summary = async (): Promise<FeishuStatus> => {
    const connection = await store.status();
    try {
      const rows = await readOwnerNoticesReadonly();
      const pending = rows.filter(e => ['pending', 'paused', 'exhausted'].includes(e.state) && Date.parse(e.at) + NOTICE_TTL_MS > Date.now());
      const successes = [...rows.flatMap(e => e.deliveredAt ? [e.deliveredAt] : []), ...(connection.lastSuccess ? [connection.lastSuccess] : [])].sort();
      const bad = [...pending].sort((a, b) => b.nextAt.localeCompare(a.nextAt)).find(e => e.error || e.state === 'exhausted');
      return { ...connection, pending: pending.length, lastSuccess: successes.at(-1) ?? null,
        deliveryIssue: bad ? bad.state === 'exhausted' ? '有通知已用完自动重试次数，请在工作台查看。' : noticeErrors[bad.error!] : null };
    } catch { return { ...connection, pending: null, lastSuccess: connection.lastSuccess, deliveryIssue: '通知账本暂时无法读取，已有事件会保留。' }; }
  };
  const empty = (args: unknown[]) => { if (args.length) throw new Error('这个飞书操作不接收参数。'); };
  return {
    status(args: unknown[]) { empty(args); return serial(summary); },
    connect(args: unknown[]) {
      if (args.length !== 1) throw new Error('连接飞书只接收一份新凭据。');
      return serial(async () => {
        await store.save(args[0]);
        // 保存已成功就不能误报为“连接失败”；异常队列由脱敏状态展示，事件不丢失。
        await retryPausedOwnerNotices().catch(() => {});
        return summary();
      });
    },
    test(args: unknown[]) { empty(args); return serial(async () => { await store.test(request); return summary(); }); },
    disconnect(args: unknown[]) { empty(args); return serial(async () => { await store.disconnect(); return summary(); }); },
    consume() { return serial(() => consumeOwnerNotices({ credentials: store.read, request })); },
  };
}
