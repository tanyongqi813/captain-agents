import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepseekCatalogBridge } from '../app/main/deepseek-catalog-bridge.ts';
const binding = 'a'.repeat(64);

test('不可信来源及非法参数零核心调用，不能用密钥代替保存身份', async () => {
  let reads = 0, writes = 0, changes = 0;
  const bridge = deepseekCatalogBridge((event: boolean) => event, async () => { changes++; }, {
    read: async () => { reads++; return { enabled: false, binding, grant: null }; }, set: async () => { writes++; },
  });
  await assert.rejects(bridge.read(false), /无权/); await assert.rejects(bridge.set(false, true, binding), /无权/);
  await assert.rejects(bridge.read(true, 'extra'), /不接受参数/);
  for (const args of [[], ['yes', binding], [true], [true, 'fake-key'], [false, binding], [true, binding, 'extra']]) {
    await assert.rejects(bridge.set(true, ...args), /参数/);
  }
  assert.equal(reads + writes + changes, 0);
});

test('显式开启/关闭经专门核心，返回保存后状态并通知本地观察', async () => {
  let state = { enabled: false, binding, grant: null as string | null }, changes = 0;
  const writes: unknown[] = [];
  const bridge = deepseekCatalogBridge(() => true, async () => { changes++; }, {
    read: async () => ({ ...state }),
    set: async (on, expected) => { writes.push([on, expected]); assert.ok(!on || expected === binding); state = { ...state, enabled: on, grant: on ? 'new-grant' : null }; },
  });
  assert.equal((await bridge.read(null)).enabled, false);
  assert.equal((await bridge.set(null, true, binding)).enabled, true);
  assert.equal((await bridge.set(null, false, undefined)).enabled, false);
  assert.deepEqual(writes, [[true, binding], [false, undefined]]); assert.equal(changes, 2);
});

test('核心身份冲突保留失败，不通知成功也不读回伪状态', async () => {
  let changes = 0, reads = 0;
  const bridge = deepseekCatalogBridge(() => true, async () => { changes++; }, {
    read: async () => { reads++; return { enabled: false, binding, grant: null }; },
    set: async () => { throw new Error('连接已改变'); },
  });
  await assert.rejects(bridge.set(null, true, binding), /已改变/); assert.equal(changes + reads, 0);
});
