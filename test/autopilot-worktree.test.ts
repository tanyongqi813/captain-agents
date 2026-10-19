import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { context, until } from './helpers.ts';
import { ensureHome } from '../src/core/paths.ts';
import { addProject } from '../src/core/project.ts';
import { aiAttempts, advance, createAutopilot, parseRun, readAutopilot, updateAutopilot } from '../src/core/autopilot.ts';
import { stepAutopilot } from '../src/core/autopilot-engine.ts';
import type { AutopilotDeps } from '../src/core/autopilot-engine.ts';
import { activateFlowSplit } from '../src/core/autopilot-flow.ts';
import { assertAutopilotWorktree, captureAutopilotPatch, patchHash, prepareAutopilotWorktree, readAutopilotPatch, saveAutopilotPatch, sharedAutopilotWorktree } from '../src/core/autopilot-worktree.ts';
import { git } from '../src/core/worktree.ts';
import { finish as finishJob, readJob, updateJob } from '../src/core/job.ts';
import type { SplitNode } from '../src/core/autopilot-diagnosis.ts';
import { clean } from '../src/core/commands.ts';
import { decide } from '../src/core/decide.ts';
import { verify as verifyJob } from '../src/core/verify.ts';

const taskSpec = '# TASK-001：实现\n\n- 状态：`READY`\n- 优先级：`P1`\n- 难度等级：`High`\n- 前置任务：无\n\n## 业务结果\n\n完成代码。\n\n## 验收标准\n\n1. 代码通过。\n';
async function world(t: TestContext, verify = ['node -e "process.exit(0)"']) {
  const c = await context(t);
  const keys = Object.keys(c.env).filter(k => process.env[k] !== c.env[k]);
  const old = new Map(keys.map(k => [k, process.env[k]]));
  for (const k of keys) process.env[k] = c.env[k];
  t.after(() => { for (const [k, v] of old) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  await ensureHome(); await mkdir(join(c.repo, 'docs/tasks'), { recursive: true });
  await writeFile(join(c.repo, '.gitignore'), '.worktrees/\n');
  await writeFile(join(c.repo, 'docs/TASK_LIST.md'), '# 任务\n\n| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |\n|---|---|---|---|---|---|\n| [TASK-001](tasks/TASK-001.md) | 实现 | READY | P1 | High | 无 |\n');
  await writeFile(join(c.repo, 'docs/tasks/TASK-001.md'), taskSpec);
  await c.git(['add', '.']); await c.git(['commit', '-m', 'task']);
  await addProject('demo', c.repo, { worktreeRoot: '.worktrees', verify });
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'], reviewer: 'codex-luna:high', policy: 'long' });
  return { ...c, run };
}
const graph: SplitNode[] = [
  { id: 'beta', title: '第二步', goal: '第二步保留第一步。', acceptance: '两步都在。', deps: ['alpha'] },
  { id: 'alpha', title: '第一步', goal: '先完成第一步。', acceptance: '第一步在。', deps: [] },
];
async function next(id: string, deps: AutopilotDeps = {}) {
  await stepAutopilot(id, deps);
  const run = await readAutopilot(id);
  if (run.action?.jobs?.length) await until(async () => Promise.all(run.action!.jobs!.map(readJob)), jobs => jobs.every(j => !['queued', 'running'].includes(j.state)), 20_000);
  return readAutopilot(id);
}
async function finish(id: string, deps: AutopilotDeps = {}, limit = 24) {
  for (let i = 0; i < limit; i++) {
    const run = await next(id, deps);
    if (['completed', 'needs_owner', 'stopped'].includes(run.state)) return run;
  }
  assert.fail('推进没有有界结束');
}

test('真实替身闭环：两个写节点按依赖串行累积，独立只读审查，最终仅运行登记验收，主工作区不变', async t => {
  const c = await world(t, ['node -e "process.exit(Number(!require(\'fs\').existsSync(\'alpha.txt\') || !require(\'fs\').existsSync(\'beta.txt\')))"']);
  const before = await c.git(['status', '--porcelain']);
  await updateAutopilot(c.run.id, run => { assert.ok(activateFlowSplit(run, run.taskId, graph)); });
  const run = await finish(c.run.id);
  assert.equal(run.state, 'completed', run.reason);
  assert.deepEqual(run.attempts.map(a => a.node), ['alpha', 'beta']);
  assert.deepEqual(run.flow!.reviews.map(r => r.verdict), ['pass', 'pass']);
  assert.equal(aiAttempts(run), 4); assert.equal(run.flow!.verification!.ok, true);
  assert.equal(run.flow!.verification!.steps.length, 1);
  const writer = await assertAutopilotWorktree(run, 'writer');
  const reviewer = await assertAutopilotWorktree(run, 'reviewer');
  assert.notEqual(writer.worktree, reviewer.worktree);
  assert.match(await readFile(join(writer.worktree, 'alpha.txt'), 'utf8'), /alpha/);
  assert.match(await readFile(join(writer.worktree, 'beta.txt'), 'utf8'), /beta/);
  const patch = await readAutopilotPatch(run, run.flow!.accepted);
  assert.match(patch, /alpha.txt/); assert.match(patch, /beta.txt/);
  const jobs = await c.jobs(); assert.equal(new Set(jobs.filter(j => j.autopilotRole === 'writer').map(j => j.worktree)).size, 1);
  assert.ok(jobs.filter(j => j.autopilotRole === 'reviewer').every(j => j.mode === 'read-only'));
  assert.ok(run.attempts.every(a => a.patch));
  assert.equal(await c.git(['status', '--porcelain']), before);
  assert.equal(await readFile(join(c.repo, 'docs/tasks/TASK-001.md'), 'utf8'), taskSpec);
});

test('审查要求修改可以续接一次；仍不过则求助，不能把写手完成当成接受', async t => {
  const c = await world(t);
  const deps: AutopilotDeps = { flow: { review: async jobs => {
    const job = await readJob(jobs[0]);
    return ['queued', 'running'].includes(job.state) ? { running: true } : { running: false, report: '## 结论\n要改\n## 意见\n1. [必须改] base.txt:1 —— 验收未满足' };
  } } };
  const run = await finish(c.run.id, deps);
  assert.equal(run.state, 'needs_owner'); assert.equal(run.ownerCode, 'recovery_budget');
  assert.equal(run.attempts.length, 2); assert.equal(run.flow!.reviews.length, 2);
  assert.equal(run.flow!.accepted, patchHash('')); assert.ok(run.flow!.candidate);
  assert.equal(run.flow!.verification, undefined);
});

test('请求格式不明/通过但有必须改意见时不能跳过审查；预算含审查', async t => {
  const c = await world(t);
  const run = await finish(c.run.id, { flow: { review: async jobs => {
    const job = await readJob(jobs[0]);
    return ['running', 'queued'].includes(job.state) ? { running: true } : { running: false, report: '格式无法识别' };
  } } });
  assert.equal(run.state, 'needs_owner'); assert.equal(aiAttempts(run), 2); assert.equal(run.flow!.accepted, patchHash(''));
});

test('审查动作崩溃后按原令牌认领，不重新派审查；已接受节点不重复执行', async t => {
  const c = await world(t);
  await next(c.run.id); await next(c.run.id); await next(c.run.id);
  const before = await readAutopilot(c.run.id);
  assert.equal(before.action?.phase, 'review');
  await updateAutopilot(c.run.id, run => {
    run.state = 'recovering'; delete run.action!.jobs; delete run.flow!.reviews.at(-1)!.jobs;
  });
  const run = await finish(c.run.id);
  assert.equal(run.state, 'completed', run.reason);
  assert.equal(run.flow!.reviews.length, 1); assert.equal(run.attempts.length, 1);
  assert.equal((await c.jobs()).length, 2);
});

test('已保存候选但尚未预占审查时崩溃，仍从候选恢复，不重跑写手', async t => {
  const c = await world(t); await next(c.run.id); await next(c.run.id);
  await updateAutopilot(c.run.id, run => { run.state = 'recovering'; });
  const run = await finish(c.run.id);
  assert.equal(run.state, 'completed', run.reason); assert.equal(run.attempts.length, 1);
});

test('未登记验收命令不宣告完成；登记验收失败进诊断', async t => {
  const c = await world(t, []);
  const run = await finish(c.run.id);
  assert.equal(run.state, 'needs_owner'); assert.equal(run.flow!.verification, undefined);
});

test('验收失败只能进入诊断；AI 直接转验收不能绕过前序独立审查', async t => {
  const c = await world(t, ['node -e "process.exit(1)"']);
  for (let i = 0; i < 5; i++) await next(c.run.id);
  const run = await readAutopilot(c.run.id);
  assert.equal(run.state, 'diagnosing'); assert.equal(run.flow!.verification?.ok, false);
  const fresh = structuredClone(run); fresh.state = 'completed'; fresh.ended = new Date().toISOString();
  assert.throws(() => parseRun(fresh, fresh.id), /独立审查和最终验收/);
});

test('回滚前核对仓库/分支/HEAD/路径，拒绝伪造共享权限且不动主目录', async t => {
  const c = await world(t);
  const target = await prepareAutopilotWorktree(c.run, 'writer', c.run.flow!.accepted);
  await writeFile(join(target.worktree, 'evidence.txt'), '不能丢');
  await assert.rejects(sharedAutopilotWorktree({ run: c.run.id, token: 'forged' }, 'writer', ['codex:high'], false, 'demo', c.run.base, false), /不符/);
  await git(target.worktree, ['branch', '-m', 'unrelated-test']);
  await assert.rejects(prepareAutopilotWorktree(c.run, 'writer', c.run.flow!.accepted), /不符/);
  assert.equal(await readFile(join(target.worktree, 'evidence.txt'), 'utf8'), '不能丢');
  assert.equal(await c.git(['status', '--porcelain']), '');
});

test('快照损坏/缺失时不先清空副本；工作副本修改任务台账时拒绝接受', async t => {
  const c = await world(t);
  const target = await prepareAutopilotWorktree(c.run, 'writer', c.run.flow!.accepted);
  await writeFile(join(target.worktree, 'evidence.txt'), '原成果');
  const hash = await captureAutopilotPatch(c.run, 'writer');
  await rm(join(c.home, 'autopilots', c.run.id, 'snapshots', `${hash}.patch`));
  await assert.rejects(prepareAutopilotWorktree(c.run, 'writer', hash));
  assert.equal(await readFile(join(target.worktree, 'evidence.txt'), 'utf8'), '原成果');
  await writeFile(join(target.worktree, 'docs/tasks/TASK-001.md'), '偷偷改状态');
  await assert.rejects(captureAutopilotPatch(c.run, 'writer'), /任务台账或 Task Spec/);
});

test('候选之后又被外部修改，不接受过期的审查结论', async t => {
  const c = await world(t); await next(c.run.id); await next(c.run.id); await next(c.run.id);
  const target = await assertAutopilotWorktree(await readAutopilot(c.run.id), 'writer');
  await writeFile(join(target.worktree, 'late.txt'), '后来的改动');
  const run = await finish(c.run.id);
  assert.equal(run.state, 'needs_owner'); assert.equal(run.flow!.accepted, patchHash(''));
});

test('写入孤立快照后重启仍只以登记里已接受 hash 为准，可重建累积改动', async t => {
  const c = await world(t); const target = await prepareAutopilotWorktree(c.run, 'writer', c.run.flow!.accepted);
  await writeFile(join(target.worktree, 'accepted.txt'), '已接受');
  const accepted = await captureAutopilotPatch(c.run, 'writer');
  await updateAutopilot(c.run.id, run => { run.flow!.accepted = accepted; });
  await writeFile(join(target.worktree, 'unaccepted.txt'), '未接受'); await saveAutopilotPatch(c.run, await git(target.worktree, ['diff', c.run.base]));
  const run = await readAutopilot(c.run.id); await prepareAutopilotWorktree(run, 'writer', run.flow!.accepted);
  assert.equal(await readFile(join(target.worktree, 'accepted.txt'), 'utf8'), '已接受');
  await assert.rejects(readFile(join(target.worktree, 'unaccepted.txt')));
});

test('闭环登记拒绝伪造完成、循环依赖、同一写手审自己和深度越界', async t => {
  const c = await world(t);
  for (const mutate of [
    (r: typeof c.run) => { r.flow!.reviewer = 'codex:high'; },
    (r: typeof c.run) => { r.state = 'completed'; r.ended = new Date().toISOString(); },
    (r: typeof c.run) => { activateFlowSplit(r, r.taskId, graph); r.nodes.find(n => n.id === 'alpha')!.task!.deps = ['beta']; },
  ]) { const run = structuredClone(c.run); mutate(run); assert.throws(() => parseRun(run, run.id)); }
  const run = structuredClone(c.run); run.nodes[0].depth = 2; assert.equal(activateFlowSplit(run, run.taskId, graph), false);
});

test('离线整链演练：执行后注入停滞 → 真诊断细拆 → 两节点 → 审查返工 → 登记验收', async t => {
  const c = await world(t, ['node -e "process.exit(Number(!require(\'fs\').existsSync(\'alpha.txt\') || !require(\'fs\').existsSync(\'beta.txt\')))"']);
  const old = process.env.XA_TEST_AUTOPILOT;
  process.env.XA_TEST_AUTOPILOT = JSON.stringify({ diagnosis: `<<<XAGENTS-DIAGNOSIS>>>\n${JSON.stringify({ action: 'split', confidence: 'high', reason: '把停滞步骤拆成两个可验收节点', nodes: graph })}\n<<<XAGENTS-END>>>` });
  t.after(() => { if (old === undefined) delete process.env.XA_TEST_AUTOPILOT; else process.env.XA_TEST_AUTOPILOT = old; });
  let run = await next(c.run.id);
  const first = run.action!.jobs![0];
  await updateJob(first, job => { finishJob(job, 'failed', '离线演练：注入已经被看管进程收尾的停滞结果'); job.termination = 'stalled'; });
  let reviews = 0;
  const deps: AutopilotDeps = { flow: { review: async jobs => {
    const job = await readJob(jobs[0]);
    if (['queued', 'running'].includes(job.state)) return { running: true };
    return { running: false, report: ++reviews === 1 ? '## 结论\n要改\n## 意见\n1. [必须改] alpha.txt:1 —— 补齐第一步验收。' : '## 结论\n通过\n## 意见\n' };
  } } };
  run = await finish(c.run.id, deps, 30);
  assert.equal(run.state, 'completed', run.reason);
  assert.equal(run.diagnoses?.[0].action, 'split');
  assert.equal(run.attempts[0].outcome, 'failed'); assert.ok(run.attempts[0].patch);
  assert.deepEqual(run.attempts.map(a => a.node), ['TASK-001', 'alpha', 'alpha', 'beta']);
  assert.equal(aiAttempts(run), 8); assert.equal(run.flow!.reviews.length, 3);
  assert.equal(run.flow!.verification!.ok, true);
  assert.equal(await c.git(['status', '--porcelain']), '');
});

test('预算最后一次已预占审查可结算并验收，但不再新增 AI 调用', async t => {
  const c = await world(t);
  await updateAutopilot(c.run.id, run => { run.policy = { id: 'short', minutes: 60, attempts: 4, nodes: 3 }; });
  await next(c.run.id); await next(c.run.id); await next(c.run.id);
  await updateAutopilot(c.run.id, run => {
    for (let i = 0; i < 2; i++) run.diagnoses = [...(run.diagnoses ?? []), { node: run.taskId, attempt: 1,
      at: run.created, token: `synthetic-reserved-${i}`, fingerprint: '0000000000000000', action: 'owner' }];
  });
  const run = await finish(c.run.id);
  assert.equal(run.state, 'completed', run.reason); assert.equal(aiAttempts(run), 4);
});

test('验收中断恢复后保守求助，不重复运行可能有副作用的登记命令', async t => {
  const c = await world(t); await next(c.run.id); await next(c.run.id); await next(c.run.id); await next(c.run.id);
  await updateAutopilot(c.run.id, run => { run.flow!.verifyStarted = new Date(Date.now() - 1000).toISOString(); run.state = 'recovering'; });
  let calls = 0;
  const run = await finish(c.run.id, { flow: { verify: async () => { calls++; throw new Error('不能重复运行'); } } });
  assert.equal(run.state, 'needs_owner'); assert.equal(calls, 0); assert.ok(run.elapsedSeconds >= 1);
});

test('推进中不允许单独清理、采用或人工验收节点，避免干扰共用副本和证据', async t => {
  const c = await world(t); const run = await next(c.run.id); const id = run.action!.jobs![0];
  await assert.rejects(clean(id), /无人看守还在推进/);
  await assert.rejects(decide(id, 'adopt', undefined, 'owner'), /无人看守还在推进/);
  await assert.rejects(verifyJob(id), /无人看守还在推进/);
  assert.ok(await assertAutopilotWorktree(run, 'writer'));
});
