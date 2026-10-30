import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { writeSettings } from '../src/core/settings.ts';
import { buildView } from '../src/core/view.ts';
import { refreshDeepseekCatalog, invalidateDeepseekCatalog } from '../src/core/deepseek-models.ts';
import { deepseekHome } from '../src/core/sandbox.ts';

const endpoint = { baseUrl: 'https://relay.example/v1/', wireApi: 'chat' as const,
  proModel: 'saved-pro', flashModel: 'saved-flash', offPeakOnly: false };
const options = { found: async () => true, windows: false };
const response = async () => new Response(JSON.stringify({ data: [{ id: 'saved-pro' }] }));

test('管理模型：陈旧权威目录仍保留下线标记、成功时间和保存 ID，不改历史身份', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await writeSettings({ deepseek: endpoint });
  await mkdir(deepseekHome(), { recursive: true });
  await writeFile(join(deepseekHome(), 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'fake-view-key' }));
  const old = { id: 'historical', batch: '', project: '', repo: c.repo, base: 'old', worktree: c.repo, branch: 'old',
    who: 'deepseek', model: 'historical-model', effort: 'high', mode: 'read-only', kind: '实现', title: '历史任务',
    state: 'done', created: '2026-10-26T01:00:00.000Z', ended: '2026-10-26T01:01:00.000Z' };
  const history = join(c.home, 'jobs', old.id, 'job.json');
  await mkdir(join(c.home, 'jobs', old.id), { recursive: true });
  await writeFile(history, JSON.stringify(old));
  const before = await readFile(history, 'utf8');
  await refreshDeepseekCatalog(endpoint, '', response);
  const fresh = await buildView(options);
  const channel = fresh.models.channels.find(c => c.channel === 'deepseek')!;
  const pro = channel.models.find(m => m.who === 'deepseek')!;
  const flash = channel.models.find(m => m.who === 'deepseek-flash')!;
  assert.equal(pro.model, endpoint.proModel); assert.equal(pro.shown, endpoint.proModel); assert.equal(pro.gone, false);
  assert.equal(flash.model, endpoint.flashModel); assert.equal(flash.shown, endpoint.flashModel); assert.equal(flash.gone, true);
  assert.ok(channel.at); assert.equal(channel.error, null);
  await assert.rejects(refreshDeepseekCatalog(endpoint, '', async () => new Response('', { status: 503 })));
  const stale = await buildView(options);
  const next = stale.models.channels.find(c => c.channel === 'deepseek')!;
  assert.equal(next.at, channel.at); assert.match(next.error!, /目录已过期/);
  assert.equal(next.models.find(m => m.who === 'deepseek')!.gone, false);
  assert.equal(next.models.find(m => m.who === 'deepseek-flash')!.gone, true);
  assert.equal(stale.roster.find(m => m.who === 'deepseek')!.model, endpoint.proModel);
  assert.equal(stale.workers.deepseek.model, endpoint.proModel);
  assert.equal(stale.jobs.find(j => j.id === old.id)!.model, old.model);
  assert.equal(await readFile(history, 'utf8'), before);
});

test('管理模型：临时目录、凭据失效或改变地址不沿用旧权威下线判断', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  await writeSettings({ deepseek: endpoint });
  await refreshDeepseekCatalog(endpoint, 'fake-temporary-key', response);
  const channel = async () => (await buildView(options)).models.channels.find(c => c.channel === 'deepseek')!;
  assert.ok((await channel()).models.every(m => !m.gone), '临时查询不作为派发权威');
  await mkdir(deepseekHome(), { recursive: true });
  await writeFile(join(deepseekHome(), 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'fake-view-key' }));
  await refreshDeepseekCatalog(endpoint, '', response);
  assert.equal((await channel()).models.find(m => m.who === 'deepseek-flash')!.gone, true);
  await invalidateDeepseekCatalog(endpoint);
  assert.ok((await channel()).models.every(m => !m.gone), '失效目录不能继续核验新凭据');
  await refreshDeepseekCatalog(endpoint, '', response);
  await writeSettings({ deepseek: { ...endpoint, baseUrl: 'https://other.example/v1/' } });
  const changed = await channel();
  assert.equal(changed.at, null); assert.ok(changed.models.every(m => !m.gone));
});
