import { readDeepseekCatalogConsent } from './settings.ts';
import type { DeepseekCatalogConsent } from './settings.ts';
import { refreshScheduledDeepseekCatalog } from './deepseek-catalog-refresh.ts';

type Dependencies = {
  consent(): Promise<DeepseekCatalogConsent>;
  refresh(request: typeof fetch): Promise<boolean>;
};

// poll只观察本地授权；真正网络频率由持久化调度入口控制。定时器归桌面生命周期拥有。
export function catalogRefreshController(request: typeof fetch, changed: () => Promise<void>, onError: (summary: string) => void,
  deps: Dependencies = { consent: readDeepseekCatalogConsent, refresh: refreshScheduledDeepseekCatalog }) {
  let stopped = false, checking = false, warned = false;
  let active: { key: string; controller: AbortController } | undefined;
  let flight: Promise<void> | undefined;
  const warn = () => {
    if (warned || stopped) return;
    warned = true;
    try { onError('自动获取模型目录失败，已保留原目录，请检查连接和授权状态。'); } catch { /* 日志失败不重启请求。 */ }
  };
  const poll = async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      const consent = await deps.consent();
      if (stopped) return;
      const key = consent.enabled && consent.binding && consent.grant ? `${consent.binding}:${consent.grant}` : null;
      if (active && active.key !== key) active.controller.abort();
      if (!key || flight) return;
      const current = { key, controller: new AbortController() }; active = current;
      const guarded: typeof fetch = (url, init) => {
        const signal = init?.signal ? AbortSignal.any([init.signal, current.controller.signal]) : current.controller.signal;
        signal.throwIfAborted();
        return request(url, { ...init, signal });
      };
      flight = Promise.resolve().then(() => deps.refresh(guarded)).then(async updated => {
        if (updated && !stopped && !current.controller.signal.aborted) { await changed(); warned = false; }
      }).catch(() => { if (!current.controller.signal.aborted) warn(); }).finally(() => {
        if (active === current) { active = undefined; flight = undefined; }
      });
    } catch { active?.controller.abort(); warn(); }
    finally { checking = false; }
  };
  return {
    poll,
    stop: () => { stopped = true; active?.controller.abort(); },
    settled: () => flight ?? Promise.resolve(),
  };
}
