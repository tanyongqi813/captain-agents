import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, exec } from './helpers.ts';
import { defaultDeepseekEndpoint } from '../src/core/deepseek-settings.ts';
import { writeSettings, readDeepseekCatalogConsent, setDeepseekCatalogConsent } from '../src/core/settings.ts';
import { refreshScheduledDeepseekCatalog } from '../src/core/deepseek-catalog-refresh.ts';
import { readDeepseekCatalog } from '../src/core/deepseek-models.ts';
import { CatalogRefreshSchedule } from '../src/core/deepseek-catalog-schedule.ts';
const moduleUrl = new URL('../src/core/deepseek-catalog-refresh.ts', import.meta.url).href;
const response = () => new Response('{"data":[{"id":"relay/test"}]}');
async function setup(t: TestContext) {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await writeSettings({ deepseek: defaultDeepseekEndpoint }); await mkdir(join(c.home, 'deepseek'));
  await writeFile(join(c.home, 'deepseek/auth.json'), '{"OPENAI_API_KEY":"fake-saved-key"}');
  await setDeepseekCatalogConsent(true, (await readDeepseekCatalogConsent()).binding!); return c;
}

test('双进程仅一个请求，冷读保留冷却，60秒后才可再刷新', async t => {
  const c = await setup(t), marker = join(c.temp, 'requests');
  const source = `import {appendFile} from 'node:fs/promises'; import {refreshScheduledDeepseekCatalog} from ${JSON.stringify(moduleUrl)};
    console.log(await refreshScheduledDeepseekCatalog(async()=>{await appendFile(${JSON.stringify(marker)},'request\\n'); return new Response('{"data":[{"id":"relay/test"}]}');},()=>1000));`;
  const results = await Promise.all([1, 2].map(() => exec(process.execPath, ['--input-type=module', '-e', source], c.repo, c.env)));
  for (const r of results) assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(results.map(r => r.stdout.trim()).sort(), ['false', 'true']);
  assert.equal(await readFile(marker, 'utf8'), 'request\n');
  const cold = await exec(process.execPath, ['--input-type=module', '-e', source], c.repo, c.env);
  assert.equal(cold.code, 0, cold.stderr); assert.equal(cold.stdout.trim(), 'false');
  assert.equal(await refreshScheduledDeepseekCatalog(async () => response(), () => 61_000), true);
});

test('失败退避持久化，冷进程不能重置；未授权不调用适配器', async t => {
  const c = await setup(t); let calls = 0;
  const fail: typeof fetch = async () => { calls++; throw new Error('fake network'); };
  await assert.rejects(refreshScheduledDeepseekCatalog(fail, () => 0));
  await assert.rejects(refreshScheduledDeepseekCatalog(fail, () => 60_000));
  const cold = await exec(process.execPath, ['--input-type=module', '-e',
    `import {refreshScheduledDeepseekCatalog} from ${JSON.stringify(moduleUrl)};
     console.log(await refreshScheduledDeepseekCatalog(async()=>{throw new Error('不应请求');},()=>179999));`], c.repo, c.env);
  assert.equal(cold.code, 0, cold.stderr); assert.equal(cold.stdout.trim(), 'false');
  assert.equal(await refreshScheduledDeepseekCatalog(async () => response(), () => 180_000), true);
  await setDeepseekCatalogConsent(false);
  assert.equal(await refreshScheduledDeepseekCatalog(fail, () => 240_000), false); assert.equal(calls, 2);
});

test('过期在途保留至超时并退避，迟到成功不能发布或清除冷却', async t => {
  await setup(t); let at = 0;
  let enter!: () => void, finish!: (value: Response) => void;
  const entered = new Promise<void>(r => { enter = r; });
  const first = refreshScheduledDeepseekCatalog(() => { enter(); return new Promise<Response>(r => { finish = r; }); }, () => at);
  const outcome = first.then(() => false, () => true); await entered;
  at = 15_000;
  assert.equal(await refreshScheduledDeepseekCatalog(async () => { throw new Error('不能立刻重试'); }, () => at), false);
  finish(response()); assert.equal(await outcome, true);
  assert.equal(await readDeepseekCatalog(defaultDeepseekEndpoint), null);
  at = 74_999; assert.equal(await refreshScheduledDeepseekCatalog(async () => response(), () => at), false);
  at = 75_000; assert.equal(await refreshScheduledDeepseekCatalog(async () => response(), () => at), true);
});

test('坏调度记录拒绝且不覆盖，纯状态恢复拒绝非法字段', async t => {
  const c = await setup(t); const dir = join(c.home, 'catalog-refresh-control'), file = join(dir, 'state.json');
  await mkdir(dir); await writeFile(file, '{broken');
  await assert.rejects(refreshScheduledDeepseekCatalog(async () => response(), () => 0), /调度记录/);
  assert.equal(await readFile(file, 'utf8'), '{broken');
  const s = new CatalogRefreshSchedule(); s.configure('A'); s.take(0);
  const restored = new CatalogRefreshSchedule(s.snapshot()); assert.equal(restored.take(100), null);
  for (const patch of [{ failures: 6 }, { nextAt: -1 }, { serial: 9 }, { extra: true }]) {
    assert.throws(() => new CatalogRefreshSchedule({ ...s.snapshot(), ...patch }), /损坏/);
  }
});
