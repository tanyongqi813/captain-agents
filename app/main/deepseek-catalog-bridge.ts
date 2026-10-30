import { readDeepseekCatalogConsent, setDeepseekCatalogConsent } from '../../src/core/settings.ts';
import type { DeepseekCatalogConsent } from '../../src/core/settings.ts';

type Core = { read(): Promise<DeepseekCatalogConsent>; set(on: boolean, binding?: string): Promise<void> };
export function deepseekCatalogBridge<E>(trusted: (event: E) => boolean, changed: () => Promise<void>,
  core: Core = { read: readDeepseekCatalogConsent, set: setDeepseekCatalogConsent }) {
  const guard = (event: E) => { if (!trusted(event)) throw new Error('此窗口无权更改模型目录授权。'); };
  return {
    read: async (event: E, ...args: unknown[]) => {
      guard(event); if (args.length) throw new Error('读取模型目录授权不接受参数。');
      return core.read();
    },
    set: async (event: E, ...args: unknown[]) => {
      guard(event);
      const [on, binding] = args;
      if (args.length < 1 || args.length > 2 || typeof on !== 'boolean'
        || (on ? typeof binding !== 'string' || !/^[0-9a-f]{64}$/i.test(binding) : binding !== undefined)) {
        throw new Error('模型目录授权参数不正确，请重新打开编辑窗口确认保存的连接。');
      }
      await core.set(on, binding as string | undefined);
      await changed(); return core.read();
    },
  };
}
