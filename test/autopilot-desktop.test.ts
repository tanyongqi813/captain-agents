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
import { context, upgradeAutopilotFixture } from './helpers.ts';
import { ensureHome } from '../src/core/paths.ts';
import { addProject } from '../src/core/project.ts';
import { derive } from '../app/renderer/lib/board.ts';
import { buildView } from '../src/core/view.ts';
import { loadHandoffFiles } from '../src/core/task-plan.ts';
import { compileLeadCapsules } from '../src/core/lead-capsule.ts';
import { LEAD_REVIEW_OPEN, LEAD_REVIEW_CLOSE, parseLeadReview } from '../src/core/lead-review.ts';
import type { LeadReviewAction } from '../src/core/lead-review.ts';

async function recordDecision(run: AutopilotRun, action: LeadReviewAction, reason: string) {
  const origin = run.flow!.lead!.origin, candidate = run.flow!.accepted, number = run.flow!.reviews.length + 1,
    token = 'review-probe-' + number, at = new Date().toISOString();
  const body = { schema: 1, action, reason, candidate, capsule: origin.fingerprint,
    ...(action === 'correct' ? { change: { goal: '只修本轮问题', acceptance: ['验证通过'] } } : {}),
    ...(action === 'split' ? { nodes: [
      { id: 'one', title: '第一步', goal: '修正', acceptance: '验证通过', deps: [] },
      { id: 'two', title: '第二步', goal: '复核', acceptance: '验证通过', deps: ['one'] },
    ] } : {}) };
  const replyText = LEAD_REVIEW_OPEN + '\n' + JSON.stringify(body) + '\n' + LEAD_REVIEW_CLOSE;
  const parsed = parseLeadReview(replyText, { candidate, capsule: origin.fingerprint });
  assert.ok(parsed.ok);
  const compilation = action === 'correct' || action === 'split' ? compileLeadCapsules({ files: await loadHandoffFiles(run.repo),
    taskId: run.taskId, currentAttempt: origin.attempt, candidate, replyText, findingIds: ['F-' + String(number).padStart(2, '0')] }) : undefined;
  return updateAutopilot(run.id, current => {
    current.flow!.reviews.push({ token, node: run.taskId, at, candidate, jobs: ['review-probe'],
      verdict: action === 'accept' ? 'pass' : action === 'correct' || action === 'split' ? 'changes' : 'unclear' });
    current.flow!.lead!.decisions.push({ token, node: run.taskId, at, jobs: ['review-probe'], reply: parsed.reply, ...(compilation ? { compilation } : {}) });
    advance(current, { kind: 'owner', code: 'owner_requested', note: '实际暂停说明：增量制品等待主人核对。' });
  });
}

const input: AutopilotInput = { project: 'demo', taskId: 'TASK-001', writer: 'codex:high', reviewer: 'codex-luna:high',
  policy: 'standard', permission: 'workspace-write', network: false };
async function world(t: TestContext) {
  const c = await context(t); const keys = Object.keys(c.env).filter(k => c.env[k] !== process.env[k]);
  const old = new Map(keys.map(k => [k, process.env[k]])); for (const key of keys) process.env[key] = c.env[key];
  t.after(() => { for (const [k, v] of old) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  await ensureHome(); await mkdir(join(c.repo, 'docs/tasks'), { recursive: true });
  await writeFile(join(c.repo, 'docs/TASK_LIST.md'), '# 任务\n\n| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |\n|---|---|---|---|---|---|\n| [TASK-001](tasks/TASK-001.md) | 实现 | READY | P1 | High | 无 |\n');
  await writeFile(join(c.repo, 'docs/tasks/TASK-001.md'), '# TASK-001\n\n- 状态：`READY`\n- 优先级：`P1`\n- 难度等级：`High`\n- 前置任务：无\n\n## 业务结果\n\n完成代码。\n\n## 验收标准\n\n1. 通过测试。\n');
  await upgradeAutopilotFixture(c.repo);
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

test('负责人桌面开关只接受布尔值，非受信通道与未知字段在启动前拒绝', async () => {
  let calls = 0; let received: unknown;
  const bridge = autopilotActions(async () => {}, { start: async options => { calls++; received = options; return { id: '1019-1200-auto' } as AutopilotRun; }, stop: async () => ({} as AutopilotRun) });
  for (const leadReview of ['true', 1, null, undefined, {}]) await assert.rejects(bridge.start([{ ...input, leadReview }]));
  await assert.rejects(bridge.start([{ ...input, leadReview: true, reviewer: 'deepseek:high' }]), /受信/);
  await assert.rejects(bridge.start([{ ...input, leadReview: true, prompt: '越权' }]));
  assert.equal(calls, 0);
  await bridge.start([{ ...input, leadReview: true }]);
  assert.equal(calls, 1); assert.equal((received as { leadReview: boolean }).leadReview, true);
  await bridge.start([{ ...input, leadReview: false }]);
  assert.equal((received as { leadReview: boolean }).leadReview, false);
});

test('桌面新模式由真实核心绑定负责人及当前胶囊，不静默升级旧模式', async t => {
  await world(t);
  const bridge = autopilotActions(async () => {}, { start: options => startAutopilot(options, { launch: async () => {} }), stop: async () => ({} as AutopilotRun) });
  await assert.rejects(bridge.start([{ ...input, leadReview: true, reviewer: input.writer }]));
  assert.equal((await listAutopilots()).runs.length, 0);
  const id = await bridge.start([{ ...input, leadReview: true }]);
  const run = (await listAutopilots()).runs.find(r => r.id === id)!;
  assert.equal(run.flow?.version, 2);
  assert.equal(run.flow?.lead?.authority, input.reviewer);
  assert.equal(run.flow?.lead?.origin.taskId, input.taskId);
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

for (const action of ['accept', 'correct', 'handoff', 'split', 'owner'] as const) test(`只读负责人摘要：${action} 只输出脱敏决定和数量，读取不改登记或通知`, async t => {
  const c = await world(t), run = await createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'],
    reviewer: 'codex-luna:high', leadReview: true });
  await recordDecision(run, action, '请复核 <img src=x onerror=alert(1)>，' + c.repo + '/private.log；/private/alien dir/secret.txt；C:\\alien dir\\secret.txt；sk-review-secret-123456789。');
  const file = join(c.home, 'autopilots', run.id, 'run.json'), before = await readFile(file, 'utf8'), dirs = await readdir(c.home);
  const result = await autopilotView(), row = result.autopilots.find(r => r.id === run.id)!;
  assert.equal(row.leadReview!.decision!.action, action);
  assert.equal(row.leadReview!.decision!.capsuleCount, action === 'correct' ? 1 : action === 'split' ? 2 : 0);
  assert.match(row.reason!, /实际暂停说明/);
  const summary = JSON.stringify(row.leadReview);
  assert.doesNotMatch(summary, /private\.log|alien|secret\.txt|sk-review-secret|"token"|"origin"|"compilation"|"fingerprint"/);
  assert.ok(!summary.includes(c.repo)); assert.ok(row.leadReview!.decision!.reason.length <= 360);
  assert.equal(await readFile(file, 'utf8'), before); assert.deepEqual(await readdir(c.home), dirs);
});

test('负责人摘要：暂无决定不假装通过，旧记录保持空摘要，损坏记录不展示决定', async t => {
  const c = await world(t), run = await createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'],
    reviewer: 'codex-luna:high', leadReview: true });
  assert.deepEqual((await autopilotView()).autopilots[0].leadReview, { decision: null });
  await recordDecision(run, 'owner', '请主人复核。');
  const file = join(c.home, 'autopilots', run.id, 'run.json'), raw = JSON.parse(await readFile(file, 'utf8'));
  raw.flow.lead.decisions[0].reply.binding.candidate = 'b'.repeat(64);
  await writeFile(file, JSON.stringify(raw));
  const broken = await autopilotView(); assert.equal(broken.autopilots.length, 0); assert.match(broken.autopilotProblem!, /无法读取/);
  await writeFile(file, JSON.stringify({ ...raw, flow: undefined }));
  // 旧登记没有新协议时沿用旧语义，不凭残留原因码创造负责人决定。
  const legacy = await autopilotView(); assert.equal(legacy.autopilots[0].leadReview, null);
});

test('负责人摘要脱敏替换后仍有长度上限，不因大量短路径膨胀', async t => {
  await world(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'], reviewer: 'codex-luna:high', leadReview: true });
  await recordDecision(run, 'owner', '/，'.repeat(190));
  const summary = (await autopilotView()).autopilots[0].leadReview!.decision!;
  assert.ok(summary.reason.length <= 360); assert.ok(summary.reason.includes('路径已隐去'));
});

test('负责人摘要取最后一份已验证决定，不把历史通过当成最新结论', async t => {
  await world(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'], reviewer: 'codex-luna:high', leadReview: true });
  const first = await recordDecision(run, 'accept', '历史通过。');
  await recordDecision(first, 'owner', '最新仍需主人处理。');
  const summary = (await autopilotView()).autopilots[0].leadReview!.decision!;
  assert.equal(summary.action, 'owner'); assert.equal(summary.reason, '最新仍需主人处理。');
});
