import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { context, root, until } from './helpers.ts';
import { ensureHome, jobDir, paths } from '../src/core/paths.ts';
import { readJob } from '../src/core/job.ts';
import { addProject } from '../src/core/project.ts';
import { readSettings, writeSettings } from '../src/core/settings.ts';
import { alive } from '../src/core/platform.ts';
import { processSince } from '../src/core/platform.ts';
import { PRESETS, advance, budgetUsed, createAutopilot, listAutopilots, readAutopilot, updateAutopilot } from '../src/core/autopilot.ts';
import type { AutopilotAttempt, AutopilotRun } from '../src/core/autopilot.ts';
import {
  launchAutopilotEngine, reconcileAutopilot, resumeAutopilot, runAutopilot, startAutopilot, stepAutopilot, stopAutopilot,
} from '../src/core/autopilot-engine.ts';
import type { AutopilotDeps, DiagnosisIntent, DiagnosisSettled, StartIntent } from '../src/core/autopilot-engine.ts';
import { DIAGNOSIS_CLOSE, DIAGNOSIS_OPEN, evidenceFingerprint } from '../src/core/autopilot-diagnosis.ts';
import type { DiagnosisEvidence } from '../src/core/autopilot-diagnosis.ts';

// 无人看守的推进器（docs/tasks/TASK-009.md 验收 2、3、4、5；诊断部分见 TASK-010 验收 3、4、5、6）。
// 外部动作一律换成可控替身：替身在"派活"时记下令牌和任务号（这就是崩溃后能认领的现场证据），
// 由测试决定这件活什么时候结束。真实派活链路在 test/plan-dispatch.test.ts 里另有覆盖。
// 负责人 AI 也一律用替身：给它一段写好的报告文字，跑测试不调用任何真实模型。

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
  // 收尾要干净：需要主人的原因码和事件号只属于 needs_owner。
  delete current.ownerCode; delete current.ownerNote; delete current.ownerEvent; delete current.action; delete current.nextPrompt;
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
      // 替身也留一份真正的任务记录：续接要看记录里的轮号，不能只在内存里记。
      await mkdir(jobDir(id), { recursive: true });
      await writeFile(join(jobDir(id), 'job.json'), JSON.stringify({
        id, batch: id, project: intent.project, repo: '', base: '', worktree: '', branch: '',
        who: 'codex', model: 'gpt-5-codex', effort: 'high', mode: 'workspace-write', kind: '实现',
        title: intent.taskId, summary: '', state: 'running', created: new Date().toISOString(),
      }));
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
    changes: async () => 0,
  };
  return { starts, jobs, evidence, stopped, deps };
}

const start = (t: TestContext) => autopilotProject(t);

for (const scene of ['late-change', 'restart-intent', 'missing-source'] as const) {
  test(`第三轮：retry 派发前重新核对来源（${scene}）`, async t => {
    await start(t);
    const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
    const w = diagWorld({ reply: answer({ action: 'retry', reason: '需要重试' }) });
    await failWriter(run.id, w);
    w.finishDiagnosis();
    assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
    if (scene === 'restart-intent') {
      await updateAutopilot(run.id, current => {
        const prior = current.attempts[0];
        delete current.nextPrompt;
        current.state = 'recovering';
        current.attemptCount++;
        current.nodes[0].attempts++;
        const at = new Date().toISOString();
        current.action = { token: 'retry-after-crash', node: prior.node, attempt: 2, at, mode: 'retry', retrySource: prior.jobs };
        current.attempts.push({ token: 'retry-after-crash', node: prior.node, attempt: 2, at });
      });
    }
    w.deps.changes = scene === 'missing-source' ? undefined : async () => 1;
    assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
    const after = await readAutopilot(run.id);
    assert.equal(after.state, 'needs_owner');
    assert.equal(after.ownerCode, scene === 'missing-source' ? 'retry_unverified_changes' : 'retry_refused_changes');
    assert.equal(w.starts.length, 1, '新增改动或来源未知时零次重派');
    assert.ok(after.attempts[0].jobs?.length, '原成果关联保留');
    assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  });
}

for (const scene of ['missing', 'corrupt', 'prepare-error'] as const) {
  test(`第三轮：续接准备失败可靠收尾且恢复不重放（${scene}）`, async t => {
    const { run, id } = await continueReady(t);
    await updateAutopilot(run.id, current => {
      delete current.action;
      current.attempts.pop(); current.attemptCount--; current.nodes[0].attempts--;
      current.nextPrompt = { node: 'TASK-002', mode: 'continue', prompt: '继续原成果' };
    });
    if (scene === 'missing') await rm(join(jobDir(id), 'job.json'));
    if (scene === 'corrupt') await writeFile(join(jobDir(id), 'job.json'), '{');
    let calls = 0;
    const deps: AutopilotDeps = { start: async () => { calls++; throw new Error('准备运行包失败'); } };
    assert.equal(await stepAutopilot(run.id, deps), 'ended');
    const after = await readAutopilot(run.id);
    assert.equal(after.state, 'needs_owner');
    assert.equal(after.ownerCode, 'resume_unverified');
    assert.equal(after.action, undefined);
    assert.equal(calls, scene === 'prepare-error' ? 1 : 0);
    assert.ok(after.attempts[0].jobs?.includes(id));
    assert.equal(await stepAutopilot(run.id, deps), 'ended');
  });
}

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

// ———— 负责人 AI 诊断与有界恢复（docs/tasks/TASK-010.md）————
// 负责人 AI 一律用替身：测试写好它"交回来的报告文字"，由测试决定它成没成。
// 这样就验证了推进器的接线（请诊断、严格校验、按动作推进、有界结束），不碰真实模型。

// 诊断证据样本：同一个 attempt 永远得到同一份证据（指纹稳定），需要时按用例覆盖。
function sample(over: Partial<DiagnosisEvidence> = {}): DiagnosisEvidence {
  return {
    task: { id: 'TASK-002', title: '实现无人看守', goal: '让平台自己盯着往下走。', acceptance: ['能自己停下。'] },
    node: 'TASK-002', attempt: 1, cause: 'stalled', termination: 'stalled', unacceptedChanges: 0,
    activity: 'edit 改了一半', runLog: '第一步\n第二步', stderrLog: '', diffStat: '', report: '没做完。',
    verify: null, history: [],
    budget: { minutesLeft: 20, attemptsLeft: 3, nodesLeft: 2, continuesLeft: 1, retriesLeft: 1, diagnosesLeft: 3 },
    ...over,
  };
}
const answer = (value: unknown) => `${DIAGNOSIS_OPEN}\n${JSON.stringify(value)}\n${DIAGNOSIS_CLOSE}`;

type DiagWorld = World & {
  // diagCalls：请诊诊断这件事被发起了几次；diagStarts：真正派出去了几次（额度拒绝、请不起来都不算）。
  diagCalls: DiagnosisIntent[];
  diagStarts: DiagnosisIntent[];
  diag: Map<string, 'running' | DiagnosisSettled>;
  finishDiagnosis: () => void;
};
// 在写手替身之上再套一层负责人 AI 替身：startDiagnosis 记下诊断包，diagnose 由测试决定结局。
function diagWorld(options: {
  reply?: string;
  evidence?: (attempt: AutopilotAttempt) => Partial<DiagnosisEvidence>;
  failure?: 'quota' | 'timeout' | 'crashed';
  refuse?: 'quota' | 'other';
  crash?: boolean;
  changes?: number | null;
} = {}): DiagWorld {
  const w = world();
  const diagCalls: DiagnosisIntent[] = [];
  const diagStarts: DiagnosisIntent[] = [];
  const diag = new Map<string, 'running' | DiagnosisSettled>();
  let d = 0;
  w.deps.evidence = async (_run, attempt) => sample({ node: attempt.node, attempt: attempt.attempt, ...(options.evidence?.(attempt) ?? {}) });
  // 执行重做之前的权威核对：默认"确认干净"，可以按用例改成有改动或确认不了。
  w.deps.changes = async () => (options.changes === undefined ? 0 : options.changes);
  w.deps.startDiagnosis = async intent => {
    diagCalls.push(intent);
    if (options.crash) throw new Error('请诊断的进程没起来');
    if (options.refuse === 'quota') return { refused: { kind: 'quota' as const, note: '额度已到停派线 80%' } };
    if (options.refuse === 'other') return { refused: { kind: 'other' as const, note: '隔离自检没过' } };
    diagStarts.push(intent);
    const id = `diag-${++d}`;
    diag.set(id, 'running');
    return { jobs: [id] };
  };
  w.deps.diagnose = async ids => {
    if (options.failure) return { state: 'failed' as const, kind: options.failure };
    let text = '';
    for (const id of ids) {
      const item = diag.get(id);
      if (!item || item === 'running') return { state: 'running' as const };
      if (item.state === 'failed') return item;
      text += item.text;
    }
    return { state: 'done' as const, text };
  };
  return {
    ...w, diagCalls, diagStarts, diag,
    finishDiagnosis: () => { for (const [id, item] of diag) if (item === 'running') diag.set(id, { state: 'done', text: options.reply ?? '' }); },
  };
}

// 常见的几步：派写手 → 写手失败 → 收尾进诊断 → 请诊断 → 负责人 AI 交回结果 → 按动作推进。
async function failWriter(runId: string, w: DiagWorld) {
  assert.equal(await stepAutopilot(runId, w.deps), 'acted');            // 派写手
  const intent = w.starts[0];
  const job = w.evidence.get(intent.token)![0];
  w.jobs.set(job, 'failed');
  assert.equal(await stepAutopilot(runId, w.deps), 'acted');            // 收尾：转诊断，不自己重试
  assert.equal((await readAutopilot(runId)).state, 'diagnosing');
  // 请只读负责人诊断（这一步本身可能当场有界结束，比如额度检查拒绝或请不起来）。
  const diagnose = await stepAutopilot(runId, w.deps);
  return { job, intent, diagnose };
}

test('失败之后先请只读负责人诊断：诊断说 continue，就叫醒上一轮那件活（副本里的改动保住）', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = diagWorld({ reply: answer({ action: 'continue', reason: '只差一个测试', prompt: '把最后一个测试补上' }) });
  const { job, diagnose } = await failWriter(run.id, w);
  assert.equal(diagnose, 'acted');
  assert.equal(w.starts.length, 1, '失败之后不许自己重派');
  assert.equal(w.diagStarts.length, 1);
  assert.equal(w.diagStarts[0].who, 'codex:high');
  assert.match(w.diagStarts[0].packet, /无人看守诊断包/, '给负责人 AI 的是受控诊断包');
  assert.equal(w.diagStarts[0].fingerprint.length, 16);
  // 诊断还没回来之前什么都不能动：诊断动作挂着令牌，等结果。
  let after = await readAutopilot(run.id);
  assert.equal(after.action?.phase, 'diagnose');
  assert.equal(after.diagnoses?.length, 1);
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');            // 收诊断 → 决定 continue
  after = await readAutopilot(run.id);
  assert.equal(after.state, 'executing');
  assert.equal(after.nodes[0].continues, 1, '节点上的补做次数加一');
  assert.deepEqual(after.nextPrompt, { node: 'TASK-002', mode: 'continue', prompt: '把最后一个测试补上' });
  assert.equal(after.diagnoses?.[0].action, 'continue');
  assert.equal(after.diagnoses?.[0].note, '只差一个测试');
  // 下一步真的去补做：叫醒上一轮那件活，不是从节点重新派一件。
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  const second = w.starts[1];
  assert.equal(second.mode, 'continue');
  assert.equal(second.prompt, '把最后一个测试补上');
  assert.deepEqual(second.previous, [job]);
  after = await readAutopilot(run.id);
  assert.equal(after.action?.mode, 'continue');
  assert.equal(after.action?.prompt, '把最后一个测试补上');
  assert.equal(after.nextPrompt, undefined, '补充题目搬到动作里就清掉，不重复用');
});

test('诊断说 retry：没有没被接受的改动时从头重派一次，重试次数用完就转 needs_owner', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  // 每次尝试的日志都不一样（指纹不同），这样第二轮的 retry 才会走到"次数用完"，而不是被判成循环。
  const w = diagWorld({
    reply: answer({ action: 'retry', reason: '上次没改对', prompt: '注意边界条件' }),
    evidence: attempt => ({ runLog: `第 ${attempt.attempt} 次尝试的输出` }),
  });
  await failWriter(run.id, w);
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  let after = await readAutopilot(run.id);
  assert.equal(after.nodes[0].retries, 1);
  assert.equal(after.state, 'executing');
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  const second = w.starts[1];
  assert.equal(second.mode, 'retry', '新派前仍保留重试语义以复核原副本');
  assert.equal(second.prompt, '注意边界条件');
  assert.equal(second.previous, undefined);
  assert.notEqual(second.token, w.starts[0].token, '重试用新令牌');
  // 第二次也失败，再请一次诊断，这次 retry 已经到上限。
  w.jobs.set(w.evidence.get(second.token)![0], 'failed');
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'recovery_budget');
  assert.equal(w.starts.length, 2, '只重试一次，到上限就不许再派');
});

test('有没被接受的改动时拒绝 retry：不丢代码，转 needs_owner 并留下结构化原因', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = diagWorld({
    reply: answer({ action: 'retry', reason: '从头做更稳' }),
    evidence: () => ({ unacceptedChanges: 2, cause: 'changes', termination: undefined }),
    changes: 2,
  });
  await failWriter(run.id, w);
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'retry_refused_changes');
  assert.match(String(after.reason), /拒绝重做以免丢代码/);
  assert.match(String(after.ownerNote), /2 个文件还没被接受/);
  assert.equal(w.starts.length, 1, '拒绝了就一件活都不派');
  assert.equal(after.diagnoses?.[0].action, undefined, '没执行的动作不记成"执行过"');
});

test('诊断说 verify：进"等验收"，自动验收还没接，下一步有界结束为 needs_owner', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = diagWorld({ reply: answer({ action: 'verify', reason: '看起来完整了' }) });
  await failWriter(run.id, w);
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  let after = await readAutopilot(run.id);
  assert.equal(after.state, 'verifying', 'verify 动作进 verifying');
  assert.equal(after.diagnoses?.[0].action, 'verify');
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'verify_pending');
  assert.equal(w.starts.length, 1, '转验收的路上不再派写手');
});

test('诊断说 split：只把候选图存进登记，一个节点都不执行', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = diagWorld({
    reply: answer({
      action: 'split', reason: '这一件事太大',
      nodes: [
        { id: 'part-a', title: '先做一半', goal: '把第一半做完', acceptance: '第一半的测试通过', deps: [] },
        { id: 'part-b', title: '再做一半', goal: '把第二半做完', acceptance: '第二半的测试通过', deps: ['part-a'] },
      ],
    }),
  });
  await failWriter(run.id, w);
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'split_pending');
  assert.deepEqual(after.split?.nodes.map(node => node.id), ['part-a', 'part-b']);
  assert.equal(after.split?.nodes[1].deps[0], 'part-a');
  assert.equal(w.starts.length, 1, '这一版不执行候选图（留给 TASK-011）');
});

test('诊断说 owner：原因码和它的理由都记下来，给主人的仍是固定模板加一句说明', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = diagWorld({ reply: answer({ action: 'owner', reason: '需要登录', owner_reason: '要读主人的登录文件才能继续' }) });
  await failWriter(run.id, w);
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'owner_requested');
  assert.match(String(after.reason), /自动故障诊断判断这件事不能自动处理/);
  assert.match(String(after.reason), /要读主人的登录文件才能继续/);
  assert.equal(after.ownerNote, '要读主人的登录文件才能继续');
});

test('循环：同一份证据又得到同样的恢复方案，第二次判为循环并转 needs_owner', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const fingerprint = evidenceFingerprint(sample({ node: 'TASK-002', attempt: 1 }));
  const at = new Date().toISOString();
  // 现场：上一次诊断对同一份证据已经给过 continue。
  await updateAutopilot(run.id, current => {
    current.state = 'diagnosing';
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-old', at, jobs: ['job-old'], outcome: 'failed' });
    current.nodes[0].attempts = 1; current.nodes[0].state = 'failed';
    current.diagnoses = [{ node: 'TASK-002', attempt: 1, at, token: 'diag-old', fingerprint, action: 'continue' }];
  });
  const w = diagWorld({ reply: answer({ action: 'continue', reason: '再补一步', prompt: '补测试' }) });
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');            // 请诊断
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');            // 同样的方案 = 循环
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'diagnosis_loop');
  assert.equal(w.starts.length, 0, '循环的时候一件活都不派');
  assert.equal(after.diagnoses?.length, 2, '两次诊断都留着当证据');
  assert.equal(after.diagnoses?.[1].code, 'diagnosis_loop');
});

test('诊断超时、崩溃、输出不合法：各落一个固定原因码，有界结束，不反复调用 AI', async t => {
  await start(t);
  const cases: { name: string; options: Parameters<typeof diagWorld>[0]; code: string; stops: boolean }[] = [
    { name: '诊断超时', options: { failure: 'timeout' }, code: 'diagnosis_timeout', stops: true },
    { name: '诊断进程崩了', options: { failure: 'crashed' }, code: 'diagnosis_crashed', stops: true },
    { name: '请诊断时抛错', options: { crash: true }, code: 'diagnosis_crashed', stops: false },
    { name: '输出不合法', options: { reply: '我觉得应该再试一次，但没有按格式给。' }, code: 'diagnosis_invalid', stops: false },
  ];
  for (const item of cases) {
    const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
    const w = diagWorld(item.options);
    const { diagnose } = await failWriter(run.id, w);
    if (item.options.crash) {
      assert.equal(diagnose, 'ended', `${item.name} 请不起来就该当场收尾`);
    } else {
      assert.equal(diagnose, 'acted', `${item.name} 先要把诊断派出去`);
      w.finishDiagnosis();
      assert.equal(await stepAutopilot(run.id, w.deps), 'ended', `${item.name} 应该当场收尾`);
    }
    const after = await readAutopilot(run.id);
    assert.equal(after.state, 'needs_owner', `${item.name} 要转 needs_owner`);
    assert.equal(after.ownerCode, item.code, `${item.name} 的原因码不对`);
    assert.equal(w.diagCalls.length, 1, `${item.name} 只许请一次诊断，不许反复调用 AI`);
    assert.equal(w.starts.length, 1, `${item.name} 之后不许再派写手`);
    if (item.stops) for (const id of w.diag.keys()) assert.equal(w.jobs.has(id), false, '诊断留下的进程要清干净');
    // 收尾之后再来一步也什么都不做。
    assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
    assert.equal(w.starts.length, 1);
    assert.equal(w.diagCalls.length, 1);
  }
});

test('额度：派发前被额度检查拒绝是 diagnosis_quota_rejected，运行时厂家报额度用完是 diagnosis_quota_exhausted', async t => {
  await start(t);
  // 一、请诊断之前额度检查就拒绝：一次都不派，也不用再去猜派活的报错文字。
  {
    const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
    const w = diagWorld({ refuse: 'quota' });
    assert.equal(await stepAutopilot(run.id, w.deps), 'acted');        // 派写手
    w.jobs.set(w.evidence.get(w.starts[0].token)![0], 'failed');
    assert.equal(await stepAutopilot(run.id, w.deps), 'acted');        // 收尾转诊断
    assert.equal(await stepAutopilot(run.id, w.deps), 'ended');        // 额度检查当场拒绝
    assert.equal(w.diagStarts.length, 0, '额度拒绝了就一次诊断都不派');
    const after = await readAutopilot(run.id);
    assert.equal(after.state, 'needs_owner');
    assert.equal(after.ownerCode, 'diagnosis_quota_rejected');
    assert.match(String(after.reason), /额度检查拒绝了这次派发/);
  }
  // 二、派出去之后厂家报告额度用完：原因码要和"派发前拒绝"分得开。
  {
    const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
    const w = diagWorld({ failure: 'quota' });
    await failWriter(run.id, w);
    w.finishDiagnosis();
    assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
    const after = await readAutopilot(run.id);
    assert.equal(after.ownerCode, 'diagnosis_quota_exhausted');
    assert.match(String(after.reason), /厂家报告额度已经用完/);
  }
});

test('请诊断被别的检查拦下（不是额度）：照样有界结束，写明拦下的原因', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = diagWorld({ refuse: 'other' });
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  w.jobs.set(w.evidence.get(w.starts[0].token)![0], 'failed');
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.match(String(after.reason), /没能派出只读故障诊断：隔离自检没过/);
  assert.equal(w.diagStarts.length, 0);
});

test('诊断也有上限：同一个节点请过几次诊断之后不再派，直接转 needs_owner', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const at = new Date().toISOString();
  await updateAutopilot(run.id, current => {
    current.state = 'diagnosing';
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-old', at, jobs: ['job-old'], outcome: 'failed' });
    current.nodes[0].attempts = 1; current.nodes[0].state = 'failed';
    current.diagnoses = [1, 2, 3].map(n => ({
      node: 'TASK-002', attempt: 1, at, token: `diag-old-${n}`, fingerprint: `${String(n).repeat(16)}`, code: 'diagnosis_invalid' as const,
    }));
  });
  const w = diagWorld({ reply: answer({ action: 'continue', reason: '再补一步', prompt: '补测试' }) });
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.ownerCode, 'recovery_budget');
  assert.equal(w.diagStarts.length, 0, '诊断次数用完就不许再请');
});

test('诊断的崩溃窗口：记了诊断动作还没派出去，重启后同一个令牌补一次；派出去了就只认领不重派', async t => {
  await start(t);
  const at = new Date().toISOString();
  const seed = async (id: string) => updateAutopilot(id, current => {
    current.state = 'diagnosing';
    current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'token-old', at, jobs: ['job-old'], outcome: 'failed' });
    current.nodes[0].attempts = 1; current.nodes[0].state = 'failed';
    current.action = { token: 'tok-d', node: 'TASK-002', attempt: 1, at, phase: 'diagnose' };
    current.diagnoses = [{ node: 'TASK-002', attempt: 1, at, token: 'tok-d', fingerprint: 'abcdef0123456789', changes: 0 }];
  });
  // 一、还没派出去：同一个令牌补一次诊断。
  {
    const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
    await seed(run.id);
    const w = diagWorld({ reply: answer({ action: 'verify', reason: '看过了' }) });
    assert.equal(await stepAutopilot(run.id, w.deps), 'acted');
    assert.equal(w.diagStarts.length, 1);
    assert.equal(w.diagStarts[0].token, 'tok-d', '补派用的是原来那个令牌');
    assert.deepEqual((await readAutopilot(run.id)).action?.jobs, ['diag-1']);
    // 崩溃重放不重复计数：还是那一次诊断、还是那一次外部 AI 尝试。
    const replayed = await readAutopilot(run.id);
    assert.equal(replayed.diagnoses?.length, 1, '同一个令牌只算一次诊断');
    assert.equal(budgetUsed(replayed).attempts, 2, '写手 1 次 + 这次诊断 1 次，重放不再加');
    await stopAutopilot(run.id, w.deps);
  }
  // 二、已经派出去了（任务记录带着同一个令牌）：只认领，绝不再派一次。
  {
    const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
    await seed(run.id);
    const w = diagWorld();
    w.evidence.set('tok-d', ['diag-x']);
    w.diag.set('diag-x', 'running');
    assert.equal(await stepAutopilot(run.id, w.deps), 'waiting');
    assert.equal(w.diagStarts.length, 0, '已经派出去的诊断不能再派一次');
    assert.deepEqual((await readAutopilot(run.id)).action?.jobs, ['diag-x']);
  }
});

test('诊断期间主人收手：诊断进程也一起停掉，登记是 stopped，之后不再派', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = diagWorld({ reply: answer({ action: 'retry', reason: '再来一次' }) });
  await failWriter(run.id, w);
  const after = await stopAutopilot(run.id, w.deps);
  assert.equal(after.state, 'stopped');
  assert.deepEqual([...new Set(w.stopped)].sort(), ['diag-1', 'job-1'], '写手和诊断留下的活都要停');
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  assert.equal(w.diagStarts.length, 1);
  assert.equal(w.starts.length, 1);
});

// ---------------------------------------------------------------------------------------------------
// 2026-10-18 评审回归（docs/tasks/TASK-010.md 的「评审记录」）：每条对应一个被指出来的问题。
// 这里补的三类断言：① 生产适配层（真派活、真证据、真用量），② 崩溃窗口按轮次对账，③ 闸门和预算的统一口径。
// ---------------------------------------------------------------------------------------------------

// 派活前的额度检查读这份快照（和 test/plan-dispatch.test.ts 一样）：测试不联网查额度。
async function quotaCache(home: string, used = 10) {
  const at = new Date().toISOString();
  await mkdir(join(home, 'cache'), { recursive: true });
  await writeFile(join(home, 'cache/quota.json'), JSON.stringify({ queriedAt: at, providers: [
    { name: 'Codex', icon: 'codex', plan: 'pro', at, bars: [{ label: '周额度', used, reset: null, windowMinutes: 10080 }] },
    { name: 'Grok', icon: 'grok', plan: null, at, bars: [] },
    { name: 'Cursor', icon: 'cursor', plan: null, at, bars: [] },
  ] }));
}
// 只给这一条用例设的环境变量，跑完还原。
function ambient(values: Record<string, string>) {
  const saved = Object.entries(values).map(([key]) => [key, process.env[key]] as const);
  Object.assign(process.env, values);
  return () => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}
// 等到一件活真的结束（替身选手跑完由看管进程收尾）。
const settleJob = (id: string) => until(async () => readFile(join(jobDir(id), 'job.json'), 'utf8').then(text => JSON.parse(text) as Job),
  job => job.state !== 'queued' && job.state !== 'running');
const jobFiles = () => readdir(paths().jobs).catch(() => [] as string[]);

async function continueReady(t: TestContext, jobOver: Partial<Job> = {}, entries?: { job: string; round: number }[]) {
  const c = await autopilotProject(t);
  await quotaCache(c.home);
  const id = 'review-job';
  await mkdir(jobDir(id), { recursive: true });
  await writeFile(join(jobDir(id), 'job.json'), JSON.stringify({
    id, batch: id, project: 'demo', repo: c.repo, base: '', worktree: c.repo, branch: '',
    who: 'codex', model: 'gpt-5-codex', effort: 'high', mode: 'workspace-write', kind: '实现',
    title: 'TASK-002', summary: '', state: 'failed', created: new Date().toISOString(), ...jobOver,
  }));
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const at = new Date().toISOString();
  await updateAutopilot(run.id, current => {
    current.state = 'executing';
    current.attemptCount = 2;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'writer-token', at, jobs: [id], outcome: 'failed' });
    current.attempts.push({ node: 'TASK-002', attempt: 2, token: 'continue-token', at });
    current.nodes[0].attempts = 2; current.nodes[0].state = 'failed'; current.nodes[0].continues = 1;
    current.action = {
      token: 'continue-token', node: 'TASK-002', attempt: 2, at, mode: 'continue', prompt: '接着做',
      // 传空数组表示"上一版留下来的登记"：没有轮次信息。
      ...(entries?.length === 0 ? {} : { resume: entries ?? [{ job: id, round: 2 }] }),
    };
  });
  return { c, run, id };
}

// ① 续接不能绕过共用闸门：主人关掉选手、额度触顶、并发满、项目归档，都要在叫醒之前拦下，
// 并且不能换令牌、不能叫醒、不能留下"已经开始"的痕迹。
async function gateCase(t: TestContext, prepare: (c: Awaited<ReturnType<typeof context>>) => Promise<void>, note: RegExp, name: string) {
  const { c, run, id } = await continueReady(t);
  await prepare(c);
  const step = await stepAutopilot(run.id);
  const after = await readAutopilot(run.id);
  assert.equal(step, 'ended', `${name}：这一台执行应当当场收尾`);
  assert.equal(after.state, 'needs_owner', `${name}：要交给主人`);
  assert.match(String(after.reason), note, `${name}：原因要写清楚（${after.reason}）`);
  assert.match(String(after.reason), /续接被拦下/, `${name}：要说明是续接这一步被拦下`);
  const job = JSON.parse(await readFile(join(jobDir(id), 'job.json'), 'utf8')) as Job;
  assert.equal(job.resume, undefined, `${name}：不许叫醒上一轮`);
  assert.equal(job.autopilot, undefined, `${name}：不许换令牌`);
  assert.equal((await jobFiles()).filter(name => name === id).length, 1, `${name}：不许额外派活`);
  assert.equal(after.attempts.at(-1)?.outcome, 'blocked', `${name}：这一次尝试要记成被拦下`);
}

test('评审回归：续接前过闸门——主人关掉了这位选手', async t => {
  await gateCase(t, async () => {
    const settings = await readSettings();
    await writeSettings({ workers: { ...settings.workers, codex: { ...settings.workers.codex, enabled: false } } });
  }, /关掉了 Codex/, '禁用');
});

test('评审回归：续接前过闸门——额度到了停派线', async t => {
  await gateCase(t, async c => { await quotaCache(c.home, 95); }, /额度/, '额度');
});

test('评审回归：续接前过闸门——并发满了', async t => {
  await gateCase(t, async () => {
    await mkdir(jobDir('busy-job'), { recursive: true });
    // 一件正在排队的活（queuedBy 是本进程，所以不会被判成"派发进程已经退出"）。
    const now = new Date().toISOString();
    await writeFile(join(jobDir('busy-job'), 'job.json'), JSON.stringify({
      id: 'busy-job', who: 'grok', state: 'queued', created: now, started: now, queuedBy: process.pid, queuedSince: Date.now(),
    }));
    process.env.XAGENTS_MAX_RUNNING = '1';
  }, /同时最多跑 1 件/, '并发');
});

test('评审回归：续接前过闸门——项目已归档', async t => {
  await gateCase(t, async () => { await writeSettings({ archivedProjects: ['demo'] }); }, /已经归档|已归档/, '归档');
});

// ② 尝试次数正好用尽：最后一次已经预占的动作要走完，"不许再开新的"是下一步的事。
test('评审回归：尝试预算用尽时，已预占的动作照样走完，下一步才收尾', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'], policy: 'short' });
  const at = new Date().toISOString();
  await mkdir(jobDir('last-job'), { recursive: true });
  await writeFile(join(jobDir('last-job'), 'job.json'), JSON.stringify({ id: 'last-job', state: 'failed', created: at }));
  await updateAutopilot(run.id, current => {
    current.state = 'executing';
    current.attemptCount = 4;                              // short 预设正好 4 次尝试，全部用尽
    for (let n = 1; n <= 4; n++) {
      current.attempts.push({ node: 'TASK-002', attempt: n, token: n === 4 ? 'last-token' : `earlier-${n}`, at });
    }
    current.attempts[3].jobs = ['last-job'];
    current.nodes[0].attempts = 4; current.nodes[0].state = 'running';
    current.action = { token: 'last-token', node: 'TASK-002', attempt: 4, at, jobs: ['last-job'] };
  });
  const deps: AutopilotDeps = { inspect: async () => 'failed', find: async () => ['last-job'], stopJob: async () => {} };
  assert.equal(await stepAutopilot(run.id, deps), 'acted', '已预占的动作要收尾，不能当成"预算用完"直接收场');
  let after = await readAutopilot(run.id);
  assert.equal(after.attempts.at(-1)?.outcome, 'failed', '最后一次尝试的结果要记上');
  assert.equal(after.state, 'diagnosing');
  assert.equal(await stepAutopilot(run.id, deps), 'ended', '再想开新的（请诊断、派写手）就不许了');
  after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.limit, 'attempts');
  assert.equal(after.diagnoses?.length ?? 0, 0, '预算用尽之后一次诊断都不许再请');
});

// ③ 诊断也是外部 AI 尝试：统一预算要把它算进去。
test('评审回归：诊断算一次外部 AI 尝试，统一预算和诊断包的余量都按它算', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'], policy: 'short' });
  const w = diagWorld({ reply: answer({ action: 'continue', reason: '再补一点', prompt: '接着做' }) });
  const at = new Date().toISOString();
  await updateAutopilot(run.id, current => {
    current.state = 'diagnosing';
    current.attemptCount = 3;
    for (let n = 1; n <= 3; n++) current.attempts.push({ node: 'TASK-002', attempt: n, token: n === 3 ? 'writer-token' : `earlier-${n}`, at });
    current.attempts[2].jobs = ['job-1'];
    current.attempts[2].outcome = 'failed';
    current.nodes[0].attempts = 3; current.nodes[0].state = 'failed';
  });
  assert.equal(await stepAutopilot(run.id, w.deps), 'acted');       // 请诊断
  const after = await readAutopilot(run.id);
  assert.equal(after.attemptCount, 3, '写手序号单独保存');
  assert.equal(after.policy.attempts, 4, 'short 预设 4 次外部 AI 尝试');
  assert.equal(budgetUsed(after).attempts, 4, '写手 3 次 + 诊断 1 次 = 已用 4 次，正好用尽');
  // 预算用尽之后：诊断可以收，但"继续做"这种要动外部 AI 的动作一律不许。
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  const done = await readAutopilot(run.id);
  assert.equal(done.state, 'needs_owner');
  assert.equal(done.ownerCode, 'recovery_budget');
  assert.match(String(done.ownerNote), /预算已经用完/);
  assert.equal(w.starts.length, 0, '预算用尽之后一件新活都不许派');
  assert.equal(w.diagCalls.length, 1);
});

// ④ 续接的用量按"当前这一轮"加，不再拿上一轮去减（真用量适配层）。
async function usageRun(name: string, record: Partial<Job>) {
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const at = new Date().toISOString();
  const id = `${name}-job`;
  await mkdir(jobDir(id), { recursive: true });
  await writeFile(join(jobDir(id), 'job.json'), JSON.stringify({
    id, batch: id, project: 'demo', repo: '', base: '', worktree: '', branch: '', who: 'codex', model: 'gpt-5-codex',
    effort: 'high', mode: 'workspace-write', kind: '实现', title: 'TASK-002', summary: '', state: 'done', created: at, ...record,
  }));
  await updateAutopilot(run.id, current => {
    current.state = 'executing';
    current.attemptCount = 2;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'first-token', at, jobs: [id], outcome: 'failed', usage: { read: 100, cached: 0, out: 0 } });
    current.attempts.push({ node: 'TASK-002', attempt: 2, token: 'continue-token', at, jobs: [id] });
    current.usage = { read: 100, cached: 0, out: 0 };
    current.nodes[0].attempts = 2; current.nodes[0].state = 'failed'; current.nodes[0].continues = 1;
    current.action = {
      token: 'continue-token', node: 'TASK-002', attempt: 2, at, mode: 'continue', prompt: '接着做', jobs: [id],
      resume: [{ job: id, round: 2 }],
    };
  });
  // 只换结局判定，用量本身走生产适配层（usageOfJobs）。
  const deps: AutopilotDeps = { inspect: async () => 'done', find: async () => [id], stopJob: async () => {} };
  assert.equal(await stepAutopilot(run.id, deps), 'acted');
  return readAutopilot(run.id);
}

test('评审回归：续接那一轮的用量按当前轮加，不重复累加也不漏记', async t => {
  await start(t);
  // 续轮开始时 resumeMember 会清空 job.usage，所以 job.usage 只是第 2 轮的 60。
  const added = await usageRun('round-usage', { resume: { round: 2, prompt: 'prompt-r2.md' }, usage: { read: 60, cached: 0, out: 0 } });
  assert.equal(added.usage?.read, 160, '100（第 1 轮）+ 60（第 2 轮）要留在 160');
  assert.equal(added.attempts.at(-1)?.usage?.read, 60, '这一次尝试只记这一轮实际用掉的');
  assert.equal(added.attempts[0].usage?.read, 100, '上一轮的用量不动');

  // 已经归档过的轮（foldRounds 把用量放进 rounds，job.usage 没了）：取那一轮的记录。
  const finished = new Date().toISOString();
  const folded = await usageRun('folded-usage', {
    resume: { round: 2, prompt: 'prompt-r2.md' },
    rounds: [
      { n: 1, started: finished, ended: finished, seconds: 1, exit: 0, state: 'failed', usage: { read: 100, cached: 0, out: 0 } },
      { n: 2, started: finished, ended: finished, seconds: 1, exit: 0, state: 'done', usage: { read: 60, cached: 0, out: 0 } },
    ],
  });
  assert.equal(folded.usage?.read, 160, '归档过的第 2 轮同样只加 60');

  // 一点用量都没留下：不记，也不许编一个数出来。
  const missing = await usageRun('missing-usage', { resume: { round: 2, prompt: 'prompt-r2.md' } });
  assert.equal(missing.usage?.read, 100, '没有用量就保持原样');
  assert.equal(missing.attempts.at(-1)?.usage, undefined, '没有用量就不记这一次的用量');
});

// ⑤ 重做之前要按原副本当前的 Git 状态权威核对，不能拿过期快照和"读不到"当成干净。
test('评审回归：快照说没有改动，但原副本现在有改动时拒绝 retry', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = diagWorld({
    reply: answer({ action: 'retry', reason: '从头做更稳' }),
    evidence: () => ({ unacceptedChanges: 0 }),   // 诊断那一刻的快照是干净的
    changes: 2,                                   // 真动手之前再核对：副本里有 2 个文件
  });
  await failWriter(run.id, w);
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.ownerCode, 'retry_refused_changes');
  assert.match(String(after.ownerNote), /2 个文件还没被接受/);
  assert.equal(w.starts.length, 1, '一件新活都不许派');
  assert.equal(after.diagnoses?.[0].changes, 2, '登记里记下的是权威核对的结果');
});

test('评审回归：确认不了改动时只求助，绝不重做', async t => {
  await start(t);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const w = diagWorld({ reply: answer({ action: 'retry', reason: '再试一次' }), changes: null });
  await failWriter(run.id, w);
  w.finishDiagnosis();
  assert.equal(await stepAutopilot(run.id, w.deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'retry_unverified_changes');
  assert.match(String(after.reason), /没法确认/);
  assert.equal(w.starts.length, 1, '确认不了就一件新活都不派');
});

test('生产证据：改动数按原副本当前的 Git 状态算，记录过期也照实报', async t => {
  const c = await start(t);
  await quotaCache(c.home);
  // 写手任务记录里存的是"0 个改动"，但副本里已经多了一个文件（记录过期了）。
  await writeFile(join(c.repo, 'not-accepted.txt'), '还没被接受的改动\n');
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const at = new Date().toISOString();
  await mkdir(jobDir('stale-job'), { recursive: true });
  await writeFile(join(jobDir('stale-job'), 'job.json'), JSON.stringify({
    id: 'stale-job', batch: 'stale-job', project: 'demo', repo: c.repo, base: '', worktree: c.repo, branch: '',
    who: 'codex', model: 'gpt-5-codex', effort: 'high', mode: 'workspace-write', kind: '实现', title: 'TASK-002',
    summary: '', state: 'failed', created: at, changedFiles: 0,
  }));
  await updateAutopilot(run.id, current => {
    current.state = 'diagnosing'; current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'writer-token', at, jobs: ['stale-job'], outcome: 'failed' });
    current.nodes[0].attempts = 1; current.nodes[0].state = 'failed';
  });
  const deps: AutopilotDeps = { startDiagnosis: async () => ({ jobs: ['diag-job'] }), changes: undefined };
  assert.equal(await stepAutopilot(run.id, deps), 'acted');
  const after = await readAutopilot(run.id);
  assert.equal(after.diagnoses?.[0].changes, 1, '记录里的 0 不可信，要按 Git 现状算');
});

test('生产证据：任务记录读不到时写成"确认不了"，不许当成没有改动', async t => {
  const c = await start(t);
  await quotaCache(c.home);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const at = new Date().toISOString();
  await updateAutopilot(run.id, current => {
    current.state = 'diagnosing'; current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'writer-token', at, jobs: ['gone-job'], outcome: 'failed' });
    current.nodes[0].attempts = 1; current.nodes[0].state = 'failed';
  });
  const deps: AutopilotDeps = { startDiagnosis: async () => ({ jobs: ['diag-job'] }) };
  assert.equal(await stepAutopilot(run.id, deps), 'acted');
  const after = await readAutopilot(run.id);
  assert.equal(after.diagnoses?.[0].changes, undefined, '确认不了就不写（写成 0 会被当成干净）');
});

// ⑥ 续接的崩溃窗口：令牌先后不能当证据，要按登记里的轮次和任务记录里的轮号对账。
test('评审回归：续接只记了意图、还没叫醒时，崩溃恢复用同一个动作补一次', async t => {
  const { run } = await continueReady(t);
  const starts: StartIntent[] = [];
  const deps: AutopilotDeps = {
    start: async intent => { starts.push(intent); return { jobs: ['round-two'] }; },
    // 令牌认领这条路一步都不许走：任务记录里还挂着上一轮的结果。
    find: async () => { throw new Error('续接的动作不能靠令牌认领'); },
    inspect: async () => 'running',
    stopJob: async () => {},
  };
  assert.equal(await stepAutopilot(run.id, deps), 'acted');
  assert.equal(starts.length, 1);
  assert.equal(starts[0].mode, 'continue');
  assert.equal(starts[0].token, 'continue-token', '同一个动作令牌，不另起一枪');
  assert.deepEqual(starts[0].rounds, [{ job: 'review-job', round: 2 }], '叫醒到第 2 轮');
  assert.deepEqual(starts[0].previous, ['review-job']);
  const after = await readAutopilot(run.id);
  assert.deepEqual(after.action?.jobs, ['round-two']);
  assert.equal(after.state, 'executing');
});

test('评审回归：上一轮的令牌留在记录里，也不能把它未完成的一轮认成新一轮', async t => {
  // 旧写法在叫醒之前就先换了令牌：记录里因此带着这一次的令牌，活却还停在上一轮。
  const { run } = await continueReady(t, { autopilot: { run: 'x', token: 'continue-token' } });
  const starts: StartIntent[] = [];
  const deps: AutopilotDeps = {
    start: async intent => { starts.push(intent); return { jobs: ['round-two'] }; },
    find: async () => ['review-job'],     // 旧写法会认领这件活，把上一轮的失败当成这一轮的
    inspect: async () => 'failed',
    stopJob: async () => {},
  };
  assert.equal(await stepAutopilot(run.id, deps), 'acted');
  const after = await readAutopilot(run.id);
  assert.equal(starts.length, 1, '没叫醒就照样叫醒，不能把旧的失败记成这一次的结果');
  assert.equal(after.attempts.at(-1)?.outcome, undefined, '这一次尝试还没有结论');
  assert.equal(after.state, 'executing');
});

test('评审回归：续接真的叫醒了、只是没记上任务号时，认领这一轮的结果', async t => {
  const { run } = await continueReady(t, { resume: { round: 2, prompt: 'prompt-r2.md' } });
  const deps: AutopilotDeps = {
    start: async () => { throw new Error('已经叫醒了，不许再叫一次'); },
    find: async () => { throw new Error('续接的动作不能靠令牌认领'); },
    inspect: async () => 'failed',
    stopJob: async () => {},
  };
  assert.equal(await stepAutopilot(run.id, deps), 'acted');
  const after = await readAutopilot(run.id);
  assert.equal(after.attempts.at(-1)?.outcome, 'failed', '这一轮的结果记在这一次尝试上');
  assert.deepEqual(after.attempts.at(-1)?.jobs, ['review-job']);
  assert.equal(after.state, 'diagnosing', '失败了照样进诊断');
});

test('评审回归：续跑准备好了却没真正启动时，明确求助，不猜、不重复叫醒', async t => {
  const { run, id } = await continueReady(t, { state: 'queued', resume: { round: 2, prompt: 'prompt-r2.md' } });
  const stopped: string[] = [];
  const deps: AutopilotDeps = {
    start: async () => { throw new Error('不许再叫一次'); },
    inspect: async () => { throw new Error('没起来就没有结果可查'); },
    stopJob: async job => { stopped.push(job); },
  };
  assert.equal(await stepAutopilot(run.id, deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'resume_pending');
  assert.match(String(after.reason), /没真正启动/);
  assert.deepEqual(stopped, [id], '准备好没起来的要收干净');
});

test('评审回归：只叫醒了一部分时，停掉已叫醒的并交给主人', async t => {
  const { run } = await continueReady(t, {}, [{ job: 'review-job', round: 2 }, { job: 'second-job', round: 2 }]);
  const now = new Date().toISOString();
  await mkdir(jobDir('second-job'), { recursive: true });
  // 第二件还停在上一轮：两件活对不上号，不能当成"都叫醒了"。
  await writeFile(join(jobDir('second-job'), 'job.json'), JSON.stringify({ id: 'second-job', state: 'failed', created: now }));
  await updateAutopilot(run.id, current => {
    current.attempts[0].jobs = ['review-job', 'second-job'];
  });
  // 第一件真的起来了（看管进程已经在跑；这里给一个不存在的进程号，测试进程不能被收尾逻辑当成它的看管进程）。
  const resumeFirst = JSON.parse(await readFile(join(jobDir('review-job'), 'job.json'), 'utf8')) as Job;
  await writeFile(join(jobDir('review-job'), 'job.json'), JSON.stringify({
    ...resumeFirst, state: 'running', pid: 999_999, resume: { round: 2, prompt: 'prompt-r2.md' },
  }));
  const stopped: string[] = [];
  const deps: AutopilotDeps = {
    start: async () => { throw new Error('对不上号时不许再派'); },
    inspect: async () => { throw new Error('对不上号时不许查结果'); },
    stopJob: async job => { stopped.push(job); },
  };
  assert.equal(await stepAutopilot(run.id, deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'resume_unverified');
  assert.match(String(after.reason), /只叫醒了 1 \/ 2 件/);
  assert.deepEqual(stopped, ['review-job'], '已经叫醒的要停掉，不留没人认领的活');
});

test('评审回归：旧登记里没有轮次信息时只求助，不按令牌猜', async t => {
  const { run } = await continueReady(t, { autopilot: { run: 'x', token: 'continue-token' } }, []);
  const deps: AutopilotDeps = {
    start: async () => { throw new Error('没有轮次信息时不许再派'); },
    find: async () => ['review-job'],
    stopJob: async () => {},
  };
  assert.equal(await stepAutopilot(run.id, deps), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'resume_unverified');
  assert.match(String(after.reason), /轮次信息/);
  assert.equal(after.action, undefined, '不能挂着猜不透的动作');
});

// ⑦ 生产适配层整条链路：真的规划派发 → 真的只读诊断派发 → 真的读回报告 → 真的续接上一轮。
// 只把选手换成仓库里那个替身（test/fixtures/worker.ts），派发入口、证据、用量、续接一个都不换。
test('生产适配层：写手失败 → 真的派诊断 → 真的按协议续接上一轮，用量和预算按统一口径记', async t => {
  const c = await start(t);
  await quotaCache(c.home);
  const restore = ambient({
    XA_TEST_MODE: 'fail',
    XA_TEST_AUTOPILOT: JSON.stringify({
      diagnosis: answer({ action: 'continue', reason: '只差一个测试', prompt: '把最后一个测试补上' }),
    }),
  });
  t.after(restore);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  assert.equal(await stepAutopilot(run.id), 'acted');                 // 真的走 planDispatch 派出去
  assert.equal((await jobFiles()).length, 1);
  const writerId = (await jobFiles())[0];
  const writer = await settleJob(writerId);
  assert.equal(writer.state, 'failed', '替身选手这一轮故意失败');
  assert.equal(await stepAutopilot(run.id), 'acted');                 // 收尾 → 等诊断
  assert.equal((await readAutopilot(run.id)).state, 'diagnosing');
  assert.equal(await stepAutopilot(run.id), 'acted');                 // 真的派只读诊断
  const diagId = (await jobFiles()).find(id => id !== writerId)!;
  const diag = await settleJob(diagId);
  assert.equal(diag.state, 'done');
  assert.equal(diag.kind, '审查');
  assert.equal(diag.mode, 'read-only', '诊断必须是只读的');
  assert.equal(await stepAutopilot(run.id), 'acted');                 // 读回报告 → 按协议继续
  let after = await readAutopilot(run.id);
  assert.equal(after.state, 'executing');
  assert.equal(after.diagnoses?.[0].action, 'continue');
  assert.equal(after.diagnoses?.[0].changes, 0, '证据的改动数是权威核对的 Git 状态');
  assert.equal(budgetUsed(after).attempts, 2, '写手 1 次 + 诊断 1 次，都是外部 AI 尝试');
  assert.equal(await stepAutopilot(run.id), 'acted');                 // 真的续接上一轮
  const second = await readJob(writerId);
  assert.equal(second.resume?.round, 2, '叫醒的是上一轮那件活的第 2 轮');
  assert.equal(second.autopilot?.token, after.action?.token ?? (await readAutopilot(run.id)).action?.token);
  after = await readAutopilot(run.id);
  assert.deepEqual(after.action?.resume, [{ job: writerId, round: 2 }], '续接意图先落盘再动手');
  await settleJob(writerId);
  assert.equal(await stepAutopilot(run.id), 'acted');                 // 第 2 轮收尾
  const settled = await readAutopilot(run.id);
  assert.equal(settled.usage?.read, 300, '三轮外部 AI 各算一次：写手 100 + 诊断 100 + 续跑 100');
  assert.equal(settled.attempts[0].usage?.read, 100);
  assert.equal(settled.attempts[1].usage?.read, 100, '续跑那一轮只记自己的 100');
  assert.equal(settled.diagnoses?.[0].usage?.read, 100);
  assert.equal(budgetUsed(settled).attempts, 3);
});

test('评审回归：诊断等待期间副本又有改动时，重做前照样拦下', async t => {
  const c = await start(t);
  await quotaCache(c.home);
  const at = new Date().toISOString();
  await mkdir(jobDir('wait-job'), { recursive: true });
  await writeFile(join(jobDir('wait-job'), 'job.json'), JSON.stringify({
    id: 'wait-job', batch: 'wait-job', project: 'demo', repo: c.repo, base: '', worktree: c.repo, branch: '',
    who: 'codex', model: 'gpt-5-codex', effort: 'high', mode: 'workspace-write', kind: '实现', title: 'TASK-002',
    summary: '', state: 'failed', created: at,
  }));
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await updateAutopilot(run.id, current => {
    current.state = 'diagnosing'; current.attemptCount = 1;
    current.attempts.push({ node: 'TASK-002', attempt: 1, token: 'writer-token', at, jobs: ['wait-job'], outcome: 'failed' });
    current.nodes[0].attempts = 1; current.nodes[0].state = 'failed';
  });
  // 只换诊断的"派出去"和"读回来"：证据和改动核对都用生产适配层。
  let started = 0;
  const deps: AutopilotDeps = {
    startDiagnosis: async () => { started++; return { jobs: ['diag-wait'] }; },
    diagnose: async () => ({ state: 'done', text: answer({ action: 'retry', reason: '从头做更稳' }) }),
  };
  assert.equal(await stepAutopilot(run.id, deps), 'acted');           // 证据说 0 个改动，派诊断
  assert.equal(started, 1);
  assert.equal((await readAutopilot(run.id)).diagnoses?.[0].changes, 0);
  // 诊断还在跑的时候，副本里多了一个文件（上游合并、外部脚本都可能这样）。
  await writeFile(join(c.repo, 'appeared-later.txt'), '诊断期间冒出来的改动\n');
  assert.equal(await stepAutopilot(run.id, deps), 'ended');           // 重做前再核对 → 拦下
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.ownerCode, 'retry_refused_changes');
  assert.match(String(after.ownerNote), /1 个文件还没被接受/);
});

// ⑧ 多成员补做：先把每一件活的闸门都过一遍，被拦下时一件都还没叫醒；叫不醒的那一件也不会留下没人认领的活。
async function twoMembers(t: TestContext) {
  const c = await start(t);
  await quotaCache(c.home);
  const restore = ambient({
    XA_TEST_MODE: 'fail',
    XA_TEST_AUTOPILOT: JSON.stringify({ diagnosis: answer({ action: 'continue', reason: '都差一点', prompt: '接着做' }) }),
  });
  t.after(restore);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high', 'grok:high'] });
  assert.equal(await stepAutopilot(run.id), 'acted');                 // 两位成员各一件活
  const writerJobs = await jobFiles();
  assert.equal(writerJobs.length, 2);
  for (const id of writerJobs) await settleJob(id);
  assert.equal(await stepAutopilot(run.id), 'acted');                 // 收尾 → 诊断
  assert.equal(await stepAutopilot(run.id), 'acted');                 // 诊断由另一位选手来做
  const diagId = (await jobFiles()).find(id => !writerJobs.includes(id))!;
  await settleJob(diagId);
  assert.equal(await stepAutopilot(run.id), 'acted');                 // 按协议：两件一起补做
  const records: Job[] = [];
  for (const id of writerJobs) records.push(JSON.parse(await readFile(join(jobDir(id), 'job.json'), 'utf8')) as Job);
  return { run, records };
}

test('生产适配层：多成员补做的闸门在叫醒之前统一过，拦下时一件都不动', async t => {
  const { run, records } = await twoMembers(t);
  // 就在叫醒之前，主人关掉了其中一位选手。
  const settings = await readSettings();
  await writeSettings({ workers: { ...settings.workers, grok: { ...settings.workers.grok, enabled: false } } });
  assert.equal(await stepAutopilot(run.id), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.match(String(after.reason), /续接被拦下：主人在设置里关掉了 Grok/);
  const before = new Map(records.map(job => [job.id, job.autopilot?.token]));
  for (const id of after.attempts[0].jobs ?? []) {
    const job = JSON.parse(await readFile(join(jobDir(id), 'job.json'), 'utf8')) as Job;
    assert.equal(job.resume, undefined, `${id} 一件都不许叫醒`);
    assert.equal(job.autopilot?.token, before.get(id), `${id} 令牌也不许换`);
    assert.equal(job.state, 'failed', `${id} 还停在上一轮的状态`);
  }
  assert.equal(records.length, 2);
  assert.equal((await jobFiles()).length, 3, '不许额外派活');
});

test('生产适配层：多成员补做中途叫不醒时，已经叫醒的当场停掉', async t => {
  const { run, records } = await twoMembers(t);
  // 排在后面的那位上一轮的日志被清掉了：拿不到会话号就没法续接。
  const broken = records.find(job => job.who === 'grok')!;
  await rm(join(jobDir(broken.id), 'run.log'));
  assert.equal(await stepAutopilot(run.id), 'ended');
  const after = await readAutopilot(run.id);
  assert.equal(after.state, 'needs_owner');
  assert.match(String(after.reason), /找不(到|会)会话号|找到会话号，没法续接/);
  const woken = JSON.parse(await readFile(join(jobDir(records.find(job => job.who === 'codex')!.id), 'job.json'), 'utf8')) as Job;
  assert.equal(woken.resume?.round, 2, '排在前面的那位真的被叫醒了');
  assert.equal(woken.state, 'stopped', '叫醒之后出了岔子，要当场停掉，不能留没人认领的活');
  const untouched = JSON.parse(await readFile(join(jobDir(broken.id), 'job.json'), 'utf8')) as Job;
  assert.equal(untouched.resume, undefined, '叫不醒的那件一步都没动');
  assert.equal(untouched.state, 'failed');
});
