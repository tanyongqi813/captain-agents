import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { autopilotActions } from '../app/main/autopilot-bridge.ts';
import type { AutopilotInput } from '../app/shared/ipc.ts';
import { advance, createAutopilot, listAutopilots, updateAutopilot } from '../src/core/autopilot.ts';
import type { AutopilotRun } from '../src/core/autopilot.ts';
import { autopilotView } from '../src/core/autopilot-view.ts';
import { consumeOwnerNotices } from '../src/core/owner-notifications.ts';
import { startAutopilot } from '../src/core/autopilot-engine.ts';
import { context } from './helpers.ts';
import { ensureHome } from '../src/core/paths.ts';
import { addProject } from '../src/core/project.ts';
import { derive } from '../app/renderer/lib/board.ts';
import { buildView } from '../src/core/view.ts';

const input: AutopilotInput = { project: 'demo', taskId: 'TASK-001', writer: 'codex:high', reviewer: 'codex-luna:high',
  policy: 'standard', permission: 'workspace-write', network: false };
async function world(t: TestContext) {
  const c = await context(t); const keys = Object.keys(c.env).filter(k => c.env[k] !== process.env[k]);
  const old = new Map(keys.map(k => [k, process.env[k]])); for (const key of keys) process.env[key] = c.env[key];
  t.after(() => { for (const [k, v] of old) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  await ensureHome(); await mkdir(join(c.repo, 'docs/tasks'), { recursive: true });
  await writeFile(join(c.repo, 'docs/TASK_LIST.md'), '# 任务\n\n| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |\n|---|---|---|---|---|---|\n| [TASK-001](tasks/TASK-001.md) | 实现 | READY | P1 | High | 无 |\n');
  await writeFile(join(c.repo, 'docs/tasks/TASK-001.md'), '# TASK-001\n\n- 状态：`READY`\n- 优先级：`P1`\n- 难度等级：`High`\n- 前置任务：无\n\n## 业务结果\n\n完成代码。\n\n## 验收标准\n\n1. 通过测试。\n');
  await c.git(['add', '.']); await c.git(['commit', '-m', 'spec']); await addProject('demo', c.repo, {});
  return c;
}

test('自治桥先检查数量、字段、角色、权限、网络和预设，额外路径和未知字段在副作用前拒绝', async () => {
  let calls = 0;
  const bridge = autopilotActions(async () => {}, { start: async () => { calls++; return { id: '1019-1200-auto' } as AutopilotRun; }, stop: async () => ({} as AutopilotRun) });
  for (const args of [[], [null], [input, 1], [{ ...input, repo: '/secret' }], [{ ...input, policy: 'unlimited' }],
    [{ ...input, network: 'true' }], [{ ...input, permission: 'read-only' }], [{ ...input, writer: 'codex:highest' }], [{ ...input, reviewer: 'codex:high --danger' }]]) {
    await assert.rejects(bridge.start(args));
  }
  for (const args of [[], ['../bad'], ['1019-1200-auto', true], ['/secret']]) await assert.rejects(bridge.stop(args));
  assert.equal(calls, 0);
});

test('自治桥只返回编号并防并发启动；刷新失败不能把已启动的任务报成启动失败', async () => {
  let release: (r: AutopilotRun) => void = () => {}; let received: unknown;
  const pending = new Promise<AutopilotRun>(r => { release = r; });
  const bridge = autopilotActions(async () => { throw new Error('View failure'); }, { start: async options => { received = options; return pending; }, stop: async () => ({} as AutopilotRun) });
  const first = bridge.start([input]); await assert.rejects(bridge.start([input]), /正在启动/);
  release({ id: '1019-1200-auto', repo: '/private/secret', action: { token: 'private-token' } } as AutopilotRun);
  assert.equal(await first, '1019-1200-auto');
  assert.deepEqual(received, { project: 'demo', taskId: 'TASK-001', who: ['codex:high'], reviewer: 'codex-luna:high', policy: 'standard', ro: false, expectedNetwork: false });
});

test('真实核心仍拒绝未知选手、过期联网确认及同选手自审；合法桥建立闭环且重复任务不新建', async t => {
  await world(t);
  const bridge = autopilotActions(async () => {}, { start: options => startAutopilot(options, { launch: async () => {} }), stop: async () => ({} as AutopilotRun) });
  for (const invalid of [{ ...input, writer: 'not-installed:high' }, { ...input, reviewer: 'codex:high' }, { ...input, network: true }]) await assert.rejects(bridge.start([invalid]));
  assert.equal((await listAutopilots()).runs.length, 0);
  const id = await bridge.start([input]); const runs = (await listAutopilots()).runs;
  assert.equal(runs.length, 1); assert.equal(runs[0].id, id); assert.equal(runs[0].flow?.reviewer, 'codex-luna:high');
  await assert.rejects(bridge.start([input]), /已经有一台/);
});

test('只读自治摘要不建通知目录，不泄露路径、动作令牌、原始命令或密钥；失联阶段可见', async t => {
  const c = await world(t); const before = await readdir(c.home);
  assert.deepEqual((await autopilotView()).autopilots, []); assert.deepEqual(await readdir(c.home), before);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'], reviewer: 'codex-luna:high' });
  const record = await readFile(join(c.home, 'autopilots', run.id, 'run.json'), 'utf8');
  let view = await autopilotView(); assert.equal(view.autopilots[0].state, 'recovering');
  assert.equal(await readFile(join(c.home, 'autopilots', run.id, 'run.json'), 'utf8'), record);
  await updateAutopilot(run.id, r => { advance(r, { kind: 'blocked', note: `错误：${c.repo}/private.log sk-sensitive_token_12345` }); });
  view = await autopilotView(); const json = JSON.stringify(view);
  assert.doesNotMatch(json, /sensitive_token|private\.log|"repo"|"token"|"cmd"/); assert.ok(!json.includes(c.repo));
  assert.equal(view.autopilots[0].notification, 'pending');
});

test('求助通知状态和持久队列一致，网络失败只改通知状态，不改变任务状态', async t => {
  await world(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'] });
  await updateAutopilot(run.id, r => { advance(r, { kind: 'owner', code: 'diagnosis_quota_exhausted' }); });
  await consumeOwnerNotices({ credentials: async () => ({ webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/fixture-only' }), request: async () => { throw new Error('offline'); } });
  const row = (await autopilotView()).autopilots[0];
  assert.equal(row.state, 'needs_owner'); assert.equal(row.notification, 'retry'); assert.match(row.reason!, /额度已经用完/);
  assert.deepEqual(row.reviews, []); assert.equal(row.verification, null);
});

test('自治节点仅从普通看板移除，已结束任务历史仍保留', async t => {
  const c = await world(t); const run = await createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'], reviewer: 'codex-luna:high' });
  await mkdir(join(c.home, 'jobs', 'node'), { recursive: true });
  await writeFile(join(c.home, 'jobs/node/job.json'), JSON.stringify({ id: 'node', batch: '', project: 'demo', who: 'codex', model: 'test', effort: 'high',
    kind: '实现', title: '节点任务', summary: '节点', state: 'done', mode: 'workspace-write', repo: c.repo, base: run.base,
    worktree: c.repo, branch: 'test', created: run.created, started: run.created, ended: run.created, autopilot: { run: run.id, token: 'hidden-token' }, autopilotRole: 'writer' }));
  const view = await buildView(); const columns = derive(view);
  assert.equal(columns.attention.length, 0); assert.equal(columns.history.length, 1);
  assert.deepEqual(view.jobs[0].autopilot, { run: run.id }); assert.doesNotMatch(JSON.stringify(view.jobs[0]), /hidden-token/);
});
