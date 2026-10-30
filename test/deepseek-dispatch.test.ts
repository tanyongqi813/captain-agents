import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context } from './helpers.ts';
import { dispatch } from '../src/core/dispatch.ts';
import { refreshDeepseekCatalog, readDeepseekCatalog } from '../src/core/deepseek-models.ts';
import { writeSettings, readSettings } from '../src/core/settings.ts';
import { deepseekHome } from '../src/core/sandbox.ts';

test('权威目录确认下线：Pro/Flash 新鲜及刷新失败后的陈旧目录都在零注册时拒绝', async t => {
  const c = await context(t, false); process.env.XAGENTS_HOME = c.home;
  const endpoint = { baseUrl: 'https://relay.example/v1/', wireApi: 'chat' as const,
    proModel: 'removed-pro', flashModel: 'removed-flash', offPeakOnly: false };
  await writeSettings({ deepseek: endpoint });
  await mkdir(deepseekHome(), { recursive: true });
  await writeFile(join(deepseekHome(), 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'fake-saved-key' }));
  await refreshDeepseekCatalog(endpoint, '', async () => new Response(JSON.stringify({ data: [{ id: 'other-model' }] })));
  const before = await readDeepseekCatalog(endpoint);
  let started = 0;
  const rejectBoth = async () => {
    for (const who of ['deepseek:high', 'deepseek-flash:high']) {
      await assert.rejects(dispatch(c.task, { who: [who], summary: '拒绝下线模型' }, async () => { started++; }), /当前目录没有模型/);
      assert.equal(started, 0);
      assert.deepEqual(await readdir(join(c.home, 'jobs')).catch(() => []), []);
      assert.deepEqual(await readdir(join(c.repo, '.worktrees')).catch(() => []), []);
    }
  };
  await rejectBoth();
  await assert.rejects(refreshDeepseekCatalog(endpoint, '', async () => new Response('', { status: 503 })));
  const stale = await readDeepseekCatalog(endpoint);
  assert.equal(stale?.stale, true);
  assert.equal(stale?.accountVerified, true);
  assert.deepEqual(stale?.models, before?.models);
  assert.equal(stale?.fetchedAt, before?.fetchedAt);
  await rejectBoth();
  assert.deepEqual((await readSettings()).deepseek, endpoint, '没有静默换模型或改连接');
});
