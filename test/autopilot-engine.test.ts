import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { context, root, until } from './helpers.ts';
import { ensureHome, paths } from '../src/core/paths.ts';
import { addProject } from '../src/core/project.ts';
import { alive } from '../src/core/platform.ts';
import { processSince } from '../src/core/platform.ts';
import { PRESETS, advance, createAutopilot, listAutopilots, readAutopilot, updateAutopilot } from '../src/core/autopilot.ts';
import type { AutopilotRun } from '../src/core/autopilot.ts';
import {
  launchAutopilotEngine, reconcileAutopilot, resumeAutopilot, runAutopilot, startAutopilot, stepAutopilot, stopAutopilot,
} from '../src/core/autopilot-engine.ts';
import type { AutopilotDeps, StartIntent } from '../src/core/autopilot-engine.ts';

// 无人看守的推进器（docs/tasks/TASK-009.md 验收 2、3、4、5）。
// 外部动作一律换成可控替身：替身在"派活"时记下令牌和任务号（这就是崩溃后能认领的现场证据），
// 由测试决定这件活什么时候结束。真实派活链路在 test/plan-dispatch.test.ts 里另有覆盖。

function listTable(rows: string[][]): string {
  return ['# 功能任务清单', '', '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |', '|---|---|---|---|---|---|',
    ...rows.map(cells => `| ${cells.join(' | ')} |`), ''].join('\n');
}
const row = (id: string, title: string, status: string, deps = '无') => [`[${id}](tasks/${id}.md)`, title, status, 'P1', 'Medium', deps];
function specText(status = 'READY'): string {
  return ['# TASK-000：样例', '', `- 状态：\`${status}\``, '- 优先级：`P1`', '- 难度等级：`Medium`', '- 前置任务：无', '',
    '## 业务结果', '', '把事办成。', '', '## 验收标准', '', '1. 第一条验收通过。', ''].join('\n');
}

async function autopilotProject(t: TestContext) {
  const c = await context(t);
  const keys = ['XAGENTS_HOME', 'XAGENTS_FAKE_WORKER', 'XAGENTS_APPLICATIONS', 'XAGENTS_CAFFEINATE', 'XAGENTS_MAX_RUNNING',
    'XAGENTS_TRASH', 'XAGENTS_SRT', 'CODEX_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
    'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const;
  const saved = keys.map(key => [key, process.env[key]] as const);
  for (const key of keys) { if (c.env[key] === undefined) delete process.env[key]; else process.env[key] = c.env[key]; }
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  await ensureHome();
  for (const [rel, content] of Object.entries({
    'docs/TASK_LIST.md': listTable([row('TASK-002', '实现无人看守', 'READY')]),
    'docs/tasks/TASK-002.md': specText(),
  })) {
    const target = join(c.repo, ...rel.split('/'));
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  }
  await c.git(['add', '.']);
  await c.git(['commit', '-m', '任务规划']);
  await addProject('demo', c.repo, {});
  return c;
}

// 测试里把一台登记收尾：严格校验要求结束状态必须有结束时间和原因。
const retire = (id: string) => updateAutopilot(id, current => {
  current.state = 'stopped';
  current.ended ??= new Date().toISOString();
  current.reason = '测试收尾。';
  delete current.limit; delete current.pid; delete current.pidSince;
});

// 可控的替身世界：start 记下这次令牌和派出去的任务号（现场证据），inspect 由测试决定活的结局。
type World = {
  starts: StartIntent[];
  jobs: Map<string, 'running' | 'done' | 'failed'>;
  evidence: Map<string, string[]>;
  stopped: string[];
  deps: AutopilotDeps;
};
function world(options: { usage?: { read: number; cached: number; out: number }; fail?: string; autoDone?: boolean } = {}): World {
  const starts: StartIntent[] = [], jobs = new Map<string, 'running' | 'done' | 'failed'>(),
    evidence = new Map<string, string[]>(), stopped: string[] = [];
  let n = 0;
  const deps: AutopilotDeps = {
    start: async intent => {
      if (options.fail) throw new Error(options.fail);
      starts.push(intent);
      const id = `job-${++n}`;
      jobs.set(id, options.autoDone ? 'done' : 'running');
      evidence.set(intent.token, [id]);
      return { jobs: [id] };
    },
    find: async (_run, action) => evidence.get(action.token) ?? null,
    inspect: async ids => {
      let running = false, failed = false;
      for (const id of ids) {
        const state = jobs.get(id) ?? 'failed';
        if (state === 'running') running = true;
        else if (state === 'failed') failed = true;
      }
      return running ? 'running' : failed ? 'failed' : 'done';
    },
    usage: async () => options.usage,
    stopJob: async id => { stopped.push(id); jobs.delete(id); },
  };
  return { starts, jobs, evidence, stopped, deps };
}

const start = (t: TestContext) => autopilotProject(t);

test('评审回归：派发尚未写回任务号时，并发恢复不能重复启动同一动作', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  let calls = 0;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const deps: AutopilotDeps = {
    start: async () => { calls++; entered(); await barrier; return { jobs: ['review-job'] }; },
    find: async () => null,
  };
  const first = stepAutopilot(run.id, deps);
  await started;
  const second = stepAutopilot(run.id, deps);
  await sleep(250);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('两个推进器同时动手，只有一个取得动作权：只派一次活', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = world();
  const results = await Promise.all([
    stepAutopilot(run.id, w.deps), stepAutopilot(run.id, w.deps), stepAutopilot(run.id, w.deps),
  ]);
  assert.equal(w.starts.length, 1, '三个推进器抢同一步，只能有一个动手');
  assert.equal(w.starts[0].token.length, 36);
  assert.equal(results.filter(result => result === 'acted').length, 1);
  const after = await readAutopilot(run.id);
  assert.deepEqual(after.action?.jobs, ['job-1']);
  assert.equal(after.attemptCount, 1);
});

test('崩溃窗口一：记下意图、还没动手就崩了——重启后补一次，不重复派活', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  // 模拟崩溃现场：令牌和意图都落盘了，但外部动作一次都没启动（没有任何任务记录带这个令牌）。
  await updateAutopilot(run.id, current => {
    advance(current, { kind: 'intent' });
    current.action = { token: 'token-a', node: 'TASK-002', attempt: 1, at: new Date().toISOString() };
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-a', at: new Date().toISOString() });
  });
  const w = world();
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  assert.equal(w.starts.length, 1);
  assert.equal(w.starts[0].token, 'token-a');            // 用的是原来那个令牌
  assert.deepEqual(w.evidence.get('token-a'), ['job-1']);
  const after = await readAutopilot(run.id);
  assert.equal(after.attemptCount, 1);                   // 没有多记一次尝试
  assert.deepEqual(after.action?.jobs, ['job-1']);
});

test('崩溃窗口二：外面已经派完了、还没落盘就崩了——重启后认领，绝不再派一次', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  // 模拟崩溃现场：意图在，任务记录也已经带着同一个令牌写出去了（外部动作成功），只是登记还没记上任务号。
  const w = world();
  w.evidence.set('token-b', ['job-77']);
  w.jobs.set('job-77', 'running');
  await updateAutopilot(run.id, current => {
    advance(current, { kind: 'intent' });
    current.action = { token: 'token-b', node: 'TASK-002', attempt: 1, at: new Date().toISOString() };
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-b', at: new Date().toISOString() });
  });
  assert.equal(await stepAutopilot(run.id, w.deps), 'waiting');
  assert.equal(w.starts.length, 0, '已经派出去的活不能再派一次');
  const adopted = await readAutopilot(run.id);
  assert.deepEqual(adopted.action?.jobs, ['job-77']);
  // 这件活接着跑完：只记账，然后交给主人（骨架还没接审查验收）。
  w.jobs.set('job-77', 'done');
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  const after = await readAutopilot(run.id);
  assert.equal(w.starts.length, 0);
  assert.equal(after.attempts.length, 1);
  assert.equal(after.attempts[0].outcome, 'done');
  assert.equal(after.state, 'needs_owner');
  assert.match(after.reason!, /还没有自动审查和验收/);
});

test('一步走完的完整记账：派一次、等结束、节点通过、用量累计，然后交给主人', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'], ro: true });
  const w = world({ usage: { read: 120, cached: 30, out: 40 } });
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  assert.equal(w.starts.length, 1);
  assert.equal(w.starts[0].project, 'demo');
  assert.equal(w.starts[0].taskId, 'TASK-002');
  assert.deepEqual(w.starts[0].who, ['codex:high']);
  assert.equal(w.starts[0].ro, true);
  // 还在跑：等。
  assert.equal(await stepAutopilot(run.id, w.deps), 'waiting');
  w.jobs.set('job-1', 'done');
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.nodes[0].state, 'passed');
  assert.deepEqual(after.usage, { read: 120, cached: 30, out: 40 });
  assert.equal(after.action, undefined);
  assert.equal(after.attempts[0].outcome, 'done');
  // 已经停下：再走一步什么都不做，也不会再派活。
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  assert.equal(w.starts.length, 1);
  assert.deepEqual(PRESETS.standard, after.policy);
});

test('预算用完：替身动作不再被调用，登记转 needs_owner 并写明是哪一项', async t => {
  await start(t);
  const w = world();
  // 时长：标准预设 240 分钟。
  const minutes = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await updateAutopilot(minutes.id, current => { current.elapsedSeconds = 240 * 60; });
  assert.equal(await stepAutopilot(minutes.id, w.deps), 'ended');
  assert.equal(w.starts.length, 0, '预算到线后不许再开新动作');
  const spent = await readAutopilot(minutes.id);
  assert.equal(spent.state, 'needs_owner');
  assert.equal(spent.limit, 'minutes');
  assert.match(spent.reason!, /运行时长预算用完了/);
  assert.match(spent.reason!, /240 分钟/);
  // 尝试：4 次（短任务）。
  await retire(minutes.id);
  const attempts = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'], policy: 'short' });
  await updateAutopilot(attempts.id, current => {
    // 四条尝试记录 + 计数 4，节点也记成失败：登记必须自洽（严格校验会核对）。
    for (let n = 1; n <= 4; n++) current.attempts.push({ node: 'TASK-002', attempt: n, token: `token-${n}`, at: new Date().toISOString(), outcome: 'failed' });
    current.attemptCount = 4;
    current.nodeCount = 1;
    current.nodes[0] = { id: 'TASK-002', depth: 0, state: 'failed', attempts: 4, continues: 0, retries: 1 };
  });
  await stepAutopilot(attempts.id, w.deps);
  const out = await readAutopilot(attempts.id);
  assert.equal(out.state, 'needs_owner');
  assert.equal(out.limit, 'attempts');
  assert.match(out.reason!, /尝试次数预算用完了/);
  // 已经在跑的那件活会被停下，不留着继续占选手。
  await retire(attempts.id);
  const running = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await updateAutopilot(running.id, current => {
    advance(current, { kind: 'intent' });
    current.action = { token: 'token-x', node: 'TASK-002', attempt: 1, at: new Date().toISOString(), jobs: ['job-9'] };
    current.elapsedSeconds = 999999;
  });
  await stepAutopilot(running.id, w.deps);
  assert.deepEqual(w.stopped, ['job-9']);
  assert.equal((await readAutopilot(running.id)).state, 'needs_owner');
});

test('派活本身失败（自检、额度、并发）：不重试，转 needs_owner 写清中文原因', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = world({ fail: '隔离自检没过，不能派活。' });
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.match(after.reason!, /没能派活：隔离自检没过/);
  assert.equal(after.attempts.at(-1)?.outcome, 'blocked');
});

test('推进器被杀：只读列表能认出并记成等恢复，再启动就从登记接着走完', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  // 一个真的后台进程当"推进器"，然后把它杀掉。
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  child.unref();
  const pid = child.pid!;
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch {} });
  await updateAutopilot(run.id, current => { current.pid = pid; current.pidSince = processSince(pid); current.state = 'executing'; });
  assert.equal(alive(pid, processSince(pid)), true);
  process.kill(pid, 'SIGKILL');
  await until(async () => !alive(pid, processSince(pid)));
  // 下次只读列表（reconcile）认出来，不永久卡在过渡态。
  const reconciled = await reconcileAutopilot(await readAutopilot(run.id));
  assert.equal(reconciled.state, 'recovering');
  assert.match(reconciled.reason!, /推进进程不在了/);
  // 再启动：从登记接着走，一遍派活、一遍收尾，最后交给主人。
  // 替身派出去的活立刻算做完，推进器就能自己走到收尾。
  const w = world({ autoDone: true });
  await runAutopilot(run.id, { ...w.deps, pollMs: 5 });
  const after = await readAutopilot(run.id);
  assert.equal(w.starts.length, 1);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.attempts.at(-1)?.outcome, 'done');
});

test('停止：先停推进器再停在动的活，之后不留存活进程，登记是 stopped', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  child.unref();
  const pid = child.pid!;
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch {} });
  const w = world();
  await updateAutopilot(run.id, current => {
    current.pid = pid; current.pidSince = processSince(pid); current.state = 'executing';
    advance(current, { kind: 'intent' });
    current.action = { token: 'token-s', node: 'TASK-002', attempt: 1, at: new Date().toISOString(), jobs: ['job-5'] };
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-s', at: new Date().toISOString(), jobs: ['job-5'] });
  });
  const stopped = await stopAutopilot(run.id, w.deps);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.pid, undefined);
  assert.deepEqual(w.stopped, ['job-5']);
  await until(async () => !alive(pid, processSince(pid)));
  assert.equal(alive(pid, processSince(pid)), false, '推进器进程必须真的不在了');
  // 停下之后再走一步什么也不做。
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
});

test('收尾状态下叫推进器不会起进程', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await retire(run.id);
  await launchAutopilotEngine(run.id);
  const after: AutopilotRun = await readAutopilot(run.id);
  assert.equal(after.pid, undefined);
  await sleep(10);
});

test('登记建好但还没叫推进器就崩了：只读列表认成等恢复，不永久卡在准备中', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  assert.equal(run.state, 'planning');
  assert.equal(run.pid, undefined);
  const reconciled = await reconcileAutopilot(await readAutopilot(run.id));
  assert.equal(reconciled.state, 'recovering');
  assert.match(reconciled.reason!, /推进进程不在了/);
  assert.equal(reconciled.pid, undefined);
  // 再走一步：工作从没开始过，会重新领一个令牌派活，不算重复派活。
  const w = world();
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  assert.equal(w.starts.length, 1);
});

test('叫不起来推进器（spawn 失败）：登记记成等恢复，不留"活跃但没有推进器"的半截状态', async t => {
  await start(t);
  await assert.rejects(
    startAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] },
      { launch: async () => { throw new Error('spawn ENOENT：找不到 node'); } }),
    /spawn ENOENT/,
  );
  const { runs } = await listAutopilots();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].state, 'recovering');
  assert.match(runs[0].reason!, /推进进程没能启动/);
  assert.equal(runs[0].pid, undefined);
  // 等恢复的登记能接着走完。
  const w = world({ autoDone: true });
  await runAutopilot(runs[0].id, { ...w.deps, pollMs: 5 });
  assert.equal(w.starts.length, 1);
  assert.equal((await readAutopilot(runs[0].id)).state, 'needs_owner');
});

test('进程号非法、进程已经死了都算推进器丢失；活着且对得上的不受影响；结束状态不动', async t => {
  await start(t);
  const seed = async (patch: Record<string, unknown>) => {
    const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
    await updateAutopilot(run.id, current => { current.state = 'executing'; Object.assign(current, patch); });
    return run.id;
  };
  const dead = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  dead.unref();
  const deadPid = dead.pid!;
  t.after(() => { try { process.kill(deadPid, 'SIGKILL'); } catch {} });
  process.kill(deadPid, 'SIGKILL');
  await until(async () => !alive(deadPid));
  const patches: Array<Record<string, unknown>> = [{ pid: 0 }, { pid: -3 }, { pid: deadPid }];
  // 出生时间只在 Windows 上才有，对不上的那种情况也只能在那边测。
  if (process.platform === 'win32') patches.push({ pid: process.pid, pidSince: 1 });
  for (const patch of patches) {
    const id = await seed(patch);
    const after = await reconcileAutopilot(await readAutopilot(id));
    assert.equal(after.state, 'recovering', JSON.stringify(patch));
    assert.match(after.reason!, /推进进程不在了/);
    assert.equal(after.pid, undefined);
    assert.equal(after.pidSince, undefined);
    await retire(id);
  }
  // 活着、出生时间（如果这台系统记这个）也对得上：保持原状态，进程号一个字都不改。
  const live = await seed({ pid: process.pid, pidSince: processSince(process.pid) });
  const kept = await reconcileAutopilot(await readAutopilot(live));
  assert.equal(kept.state, 'executing');
  assert.equal(kept.pid, process.pid);
  // 结束状态不会被改成等恢复。
  await retire(live);
  assert.equal((await reconcileAutopilot(await readAutopilot(live))).state, 'stopped');
  const spent = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await updateAutopilot(spent.id, current => { advance(current, { kind: 'budget', limit: 'minutes' }); });
  const ended = await reconcileAutopilot(await readAutopilot(spent.id));
  assert.equal(ended.state, 'needs_owner');
  assert.equal(ended.limit, 'minutes');
});

test('等恢复的登记再启动：沿用原动作令牌和已有证据，不重复派活', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = world();
  w.evidence.set('token-r', ['job-42']);       // 任务记录里带着同一个令牌：这一枪确实派出去过
  w.jobs.set('job-42', 'done');
  await updateAutopilot(run.id, current => {
    advance(current, { kind: 'intent' });
    current.action = { token: 'token-r', node: 'TASK-002', attempt: 1, at: new Date().toISOString() };
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-r', at: new Date().toISOString() });
  });
  // 推进器不在了：先记成等恢复，原来那个令牌不许丢。
  const recovered = await reconcileAutopilot(await readAutopilot(run.id));
  assert.equal(recovered.state, 'recovering');
  assert.equal(recovered.action?.token, 'token-r');
  await runAutopilot(run.id, { ...w.deps, pollMs: 5 });
  assert.equal(w.starts.length, 0, '有证据的那一枪不能再派一次');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.deepEqual(after.attempts[0].jobs, ['job-42']);
  assert.equal(after.attempts[0].outcome, 'done');
  assert.equal(after.action, undefined);
  assert.equal(after.pid, undefined, '推进器走完之后登记里不留进程号');
});

test('同一个进程里两个推进器盯同一台执行：只有一个动手', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = world({ autoDone: true });
  await Promise.all([
    runAutopilot(run.id, { ...w.deps, pollMs: 5 }),
    runAutopilot(run.id, { ...w.deps, pollMs: 5 }),
  ]);
  assert.equal(w.starts.length, 1, '同一台执行只许一个推进器动手');
  assert.equal((await readAutopilot(run.id)).state, 'needs_owner');
});

test('已有动作的并发恢复：两个推进器抢同一个动作，只认领一次、一件活都不重派', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = world();
  w.evidence.set('token-c', ['job-c']);
  w.jobs.set('job-c', 'done');
  // 现场：动作已经派出去、任务号也已经写回来了，只是还没收尾。
  await updateAutopilot(run.id, current => {
    advance(current, { kind: 'intent' });
    current.action = { token: 'token-c', node: 'TASK-002', attempt: 1, at: new Date().toISOString(), jobs: ['job-c'] };
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-c', at: new Date().toISOString(), jobs: ['job-c'] });
  });
  const results = await Promise.all([stepAutopilot(run.id, w.deps), stepAutopilot(run.id, w.deps)]);
  assert.equal(w.starts.length, 0, '已经有任务号的动作绝不能再派一次');
  assert.equal(results.length, 2);
  const after = await readAutopilot(run.id);
  assert.equal(after.attempts.length, 1, '同一个动作只记一次');
  assert.equal(after.attempts[0].outcome, 'done');
  assert.equal(after.action, undefined);
  assert.equal(after.state, 'needs_owner');
});

test('停止与派发撞在一起：停止等动作锁，刚派出去的那件活照样被停掉，之后旧令牌不许再派', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = world();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow: AutopilotDeps = {
    ...w.deps,
    start: async intent => { w.starts.push(intent); entered(); await gate; return { jobs: ['job-z'] }; },
  };
  const stepping = stepAutopilot(run.id, slow);
  await started;
  const stopping = stopAutopilot(run.id, w.deps);   // 必须在动作锁外等这一步
  await sleep(200);
  assert.equal((await readAutopilot(run.id)).state !== 'stopped', true, '派活还没落盘时停止不能先收尾');
  release();
  await stepping;
  const stopped = await stopping;
  assert.equal(stopped.state, 'stopped');
  assert.deepEqual([...new Set(w.stopped)], ['job-z'], '刚派出去的活必须被停掉');
  // 停下之后，握着旧令牌的那一步什么都不许做。
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  assert.equal(w.starts.length, 1);
});

test('受控恢复：只接编号，任务、选手、权限、预算和动作令牌一个字都不改，也不另建一台', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['grok:high'], policy: 'short', ro: true });
  await updateAutopilot(run.id, current => {
    advance(current, { kind: 'intent' });
    current.action = { token: 'token-keep', node: 'TASK-002', attempt: 1, at: new Date().toISOString() };
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-keep', at: new Date().toISOString() });
  });
  await reconcileAutopilot(await readAutopilot(run.id));      // 推进器掉了：等恢复
  const launched: string[] = [];
  const back = await resumeAutopilot(run.id, { launch: async id => { launched.push(id); return true; } });
  assert.deepEqual(launched, [run.id]);
  assert.equal(back.id, run.id);
  assert.equal(back.taskId, 'TASK-002');
  assert.deepEqual(back.who, ['grok:high']);
  assert.equal(back.ro, true);
  assert.deepEqual(back.policy, PRESETS.short);
  assert.equal(back.state, 'recovering');
  assert.equal(back.action?.token, 'token-keep');
  assert.equal(back.attemptCount, 1);
  assert.equal(back.created, run.created);
  const { runs } = await listAutopilots();
  assert.equal(runs.length, 1, '恢复不能另建一台');
  // 恢复之后接着走：动作令牌还是原来那个，证据也在，于是只认领不重派。
  const w = world({ autoDone: true });
  w.evidence.set('token-keep', ['job-keep']);
  w.jobs.set('job-keep', 'done');
  await runAutopilot(run.id, { ...w.deps, pollMs: 5 });
  assert.equal(w.starts.length, 0);
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.deepEqual(after.attempts[0].jobs, ['job-keep']);
});

test('受控恢复拒绝：结束的、找不到的、坏的、推进器还活着的都不许起', async t => {
  await start(t);
  const ended = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await retire(ended.id);
  await assert.rejects(resumeAutopilot(ended.id), /已经停在「已停止」，不用恢复/);
  await assert.rejects(resumeAutopilot('没有这台'), /找不到无人看守 没有这台/);
  // 读不出来的记录：失败关闭，不按半份登记恢复。
  const broken = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await writeFile(join(paths().home, 'autopilots', broken.id, 'run.json'), '{"version":1,');
  await assert.rejects(resumeAutopilot(broken.id), /登记文件不是完整 JSON/);
  // 推进器还活着：不能再起一台（这里用自己的进程号冒充活着的推进器）。
  const live = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await updateAutopilot(live.id, current => { current.pid = process.pid; current.pidSince = processSince(process.pid); });
  await assert.rejects(resumeAutopilot(live.id), /推进器已经在跑/);
  assert.equal((await readAutopilot(live.id)).pid, process.pid);
});

test('两个真实进程抢同一台执行：锁在跨进程上生效，只派一次活', async t => {
  const c = await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  // 现场：动作令牌已经落盘，但任务号还没写回来（另一个推进器刚走进去、还没回来）。
  await updateAutopilot(run.id, current => {
    advance(current, { kind: 'intent' });
    current.action = { token: 'token-x', node: 'TASK-002', attempt: 1, at: new Date().toISOString() };
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-x', at: new Date().toISOString() });
  });
  const log = join(c.temp, 'dispatched.log');
  const script = join(c.temp, 'step-child.mjs');
  await writeFile(script, `
import { stepAutopilot } from ${JSON.stringify(pathToFileURL(join(root, 'src/core/autopilot-engine.ts')).href)};
import { appendFileSync } from 'node:fs';
const [id, log] = process.argv.slice(2);
const deps = {
  start: async intent => {
    appendFileSync(log, intent.token + '\\n');
    await new Promise(resolve => setTimeout(resolve, 200));
    return { jobs: ['job-child'] };
  },
  find: async () => null,
  inspect: async () => 'running',
  usage: async () => undefined,
  stopJob: async () => {},
};
await stepAutopilot(id, deps);
`);
  const children = [0, 1].map(() => spawn(process.execPath, [script, run.id, log], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }));
  const codes = await Promise.all(children.map(child => new Promise<{ code: number | null; err: string }>(resolve => {
    let err = '';
    child.stderr.on('data', chunk => { err += String(chunk); });
    child.on('exit', code => resolve({ code, err }));
  })));
  for (const item of codes) assert.equal(item.code, 0, item.err);
  const lines = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean);
  assert.deepEqual(lines, ['token-x'], '两个进程只有一个能派出去，另一个只许认领');
  const after = await readAutopilot(run.id);
  assert.deepEqual(after.action?.jobs, ['job-child']);
  assert.equal(after.attemptCount, 1);
});

test('跨进程领执行权：两个真进程同时起来，只有一个拿到这台执行，另一个当场退出', async t => {
  const c = await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const script = join(c.temp, 'run-child.mjs');
  await writeFile(script, `
import { runAutopilot } from ${JSON.stringify(pathToFileURL(join(root, 'src/core/autopilot-engine.ts')).href)};
const deps = {
  start: async () => { await new Promise(resolve => setTimeout(resolve, 5000)); return { jobs: ['job-live'] }; },
  find: async () => null,
  inspect: async () => 'running',
  usage: async () => undefined,
  stopJob: async () => {},
};
await runAutopilot(process.argv[2], { ...deps, pollMs: 20 });
`);
  const children = [0, 1].map(() => spawn(process.execPath, [script, run.id], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }));
  const seen = children.map(child => ({
    child, code: null as number | null, err: '',
  }));
  for (const item of seen) item.child.stderr.on('data', chunk => { item.err += String(chunk); });
  t.after(() => { for (const item of seen) if (item.child.exitCode === null) item.child.kill('SIGKILL'); });
  // 一个进程拿执行权后一直在派活，另一个必须当场认出"已经有推进器"并退出。
  const loser = await until(async () => seen.find(item => item.child.exitCode !== null) ?? null, item => item !== null, 15000);
  const winner = seen.find(item => item !== loser)!;
  assert.equal(loser.code ?? loser.child.exitCode, 0);
  assert.match(loser.err, /无人看守的推进进程已经在跑/);
  const held = await readAutopilot(run.id);
  assert.equal(held.pid, winner.child.pid, '登记里的推进器进程号必须是真正拿到执行权的那个');
  winner.child.kill('SIGKILL');
});

test('预算到线时，按令牌把已经派出去但还没记号的活认领出来停掉，一件新的都不派', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = world();
  // 现场：动作发出去了、任务号还没写回登记，时长预算这一刻到线。
  w.evidence.set('token-b', ['job-out']);
  w.jobs.set('job-out', 'running');
  await updateAutopilot(run.id, current => {
    advance(current, { kind: 'intent' });
    current.action = { token: 'token-b', node: 'TASK-002', attempt: 1, at: new Date().toISOString() };
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-b', at: new Date().toISOString() });
    current.elapsedSeconds = current.policy.minutes * 60;
  });
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  assert.equal(w.starts.length, 0, '预算到线不许再派');
  assert.deepEqual([...new Set(w.stopped)], ['job-out'], '外面那件活必须被停掉');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.limit, 'minutes');
});
