import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogRefreshController } from '../src/core/deepseek-catalog-loop.ts';
const enabled = { enabled: true, binding: 'binding', grant: 'grant' };

test('默认关闭不刷新，授权后单飞并仅成功发布', async () => {
  let consent = { ...enabled, enabled: false }, refreshes = 0, publishes = 0;
  let finish!: (updated: boolean) => void;
  const loop = catalogRefreshController(async () => { throw new Error('不应联网'); }, async () => { publishes++; }, assert.fail, {
    consent: async () => consent,
    refresh: async () => { refreshes++; return new Promise<boolean>(r => { finish = r; }); },
  });
  await loop.poll(); assert.equal(refreshes, 0);
  consent = enabled; await loop.poll(); await loop.poll(); assert.equal(refreshes, 1);
  finish(true); await loop.settled(); assert.equal(publishes, 1); loop.stop();
});

for (const mode of ['revoke', 'identity', 'stop', 'read-error'] as const) test(`${mode}主动取消在途且不发布，保留原超时signal`, async () => {
  let consent = enabled, broken = false, publishes = 0, calls = 0, errors = 0;
  let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
  let signal: AbortSignal | null | undefined;
  const timeout = new AbortController();
  const loop = catalogRefreshController(async (_url, init) => {
    calls++; signal = init?.signal; entered();
    return new Promise<Response>((_yes, no) => signal!.addEventListener('abort', () => no(new Error('fake secret should not be logged')), { once: true }));
  }, async () => { publishes++; }, summary => { errors++; assert.ok(!summary.includes('secret')); }, {
    consent: async () => { if (broken) throw new Error('raw secret'); return consent; },
    refresh: async request => { await request('https://fixture.invalid/models', { signal: timeout.signal }); return true; },
  });
  await loop.poll(); await started; assert.equal(signal?.aborted, false);
  if (mode === 'stop') loop.stop();
  else {
    if (mode === 'revoke') consent = { ...enabled, enabled: false };
    if (mode === 'identity') consent = { ...enabled, grant: 'new-grant' };
    if (mode === 'read-error') broken = true;
    await loop.poll();
  }
  await loop.settled(); assert.equal(signal?.aborted, true); assert.equal(publishes, 0); assert.equal(calls, 1);
  assert.equal(errors, mode === 'read-error' ? 1 : 0); loop.stop(); await loop.poll(); assert.equal(calls, 1);
});

test('原查询超时仍能取消，错误摘要去重，停止后异步授权读取不能启动', async () => {
  let release!: (value: typeof enabled) => void, calls = 0;
  const loop = catalogRefreshController(async () => { throw new Error('不能启动'); }, async () => {}, assert.fail, {
    consent: () => new Promise(r => { release = r; }), refresh: async () => { calls++; return true; },
  });
  const reading = loop.poll(); loop.stop(); release(enabled); await reading; assert.equal(calls, 0);
  const timeout = new AbortController(); let errors = 0;
  const second = catalogRefreshController(async (_url, init) => { timeout.abort(); assert.equal(init?.signal?.aborted, true); throw new Error('raw token'); }, async () => {}, () => { errors++; }, {
    consent: async () => enabled,
    refresh: async request => { await request('https://fixture.invalid/models', { signal: timeout.signal }); return true; },
  });
  await second.poll(); await second.settled(); await second.poll(); await second.settled(); assert.equal(errors, 1); second.stop();
});
