import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { nodeCommand } from './node-runtime.ts';
import { backgroundSpawn, alive, processSince } from './platform.ts';
import { withLock } from './fsx.ts';
import { engineEnvironment, engineSnapshot, killEngine } from './wake.ts';
import { hasCode } from './fsx.ts';
import { readJob } from './job.ts';
import type { Job } from './job.ts';
import { paths } from './paths.ts';
import { stop } from './commands.ts';
import { planDispatch } from './plan-dispatch.ts';
import {
  actionLockDir, advance, autopilotDir, canRetry, createAutopilot, dispatchBudget, exceededBudget, isActiveState,
  isEndedState, newToken, readAutopilot, stateNames, updateAutopilot,
} from './autopilot.ts';
import type { AutopilotAction, AutopilotAttempt, AutopilotRun, AutopilotStartOptions, BudgetLimit } from './autopilot.ts';

// 无人看守的确定性推进器（docs/tasks/TASK-009.md）。它是隔离外的后台进程（autopilot-entry.ts），
// 每走一步都是同一个形状：在锁里核对状态与动作令牌 → 记下"要做什么"（意图）→ 再动手做外部工作 → 回来落盘结果。
// 这样任一步崩掉，下一次启动都能从登记文件判断：工作还没开始（安全补一次）、已经在跑（接着等）、已经做完（认领结果）。
//
// 两条不能破的线：
// 1. 同一台执行任何时刻只有一个推进器（launchAutopilotEngine 和 runAutopilot 都先看有没有活着的 pid，登记改写在锁里）。
// 2. 外部动作只从 TASK-006 的权威校验入口发起（planDispatch → readyTask），界面来的内容一律不认。

const POLL_MS = 2000;
// 同一个进程里也只许一个推进器盯同一台执行（生产是一进程一台；这条挡住测试和误用）。
const inProcess = new Set<string>();
// 两次采样之间超过这个间隔就当电脑睡了一觉，扣掉不计入预算（和 runner 的停滞判定同一口径）。
const SLEEP_GAP_MS = 60_000;

export type StartIntent = {
  run: string; token: string; project: string; taskId: string; who: string[]; ro: boolean; node: string; attempt: number;
};
export type AutopilotDeps = {
  // 真正出去干活的那一步。生产是规划派发；测试替身自己记账也自己回话。
  start?: (intent: StartIntent) => Promise<{ jobs: string[] }>;
  // 外部动作留下的证据：崩溃后靠它认领，绝不重复派活。
  find?: (run: AutopilotRun, action: AutopilotAction) => Promise<string[] | null>;
  inspect?: (jobs: string[]) => Promise<'running' | 'done' | 'failed'>;
  usage?: (jobs: string[]) => Promise<{ read: number; cached: number; out: number } | undefined>;
  stopJob?: (job: string) => Promise<void>;
  now?: () => number;
  pollMs?: number;
};

// 生产替身：规划派发会重新读规划、走策略/额度/隔离/并发校验，并把这一枪的令牌写进任务记录。
const startByDispatch: NonNullable<AutopilotDeps['start']> = async intent => {
  const jobs = await planDispatch({
    project: intent.project, taskId: intent.taskId, who: intent.who,
    ...(intent.ro ? { ro: true } : {}),
    autopilot: { run: intent.run, token: intent.token },
  });
  return { jobs: jobs.map(job => job.id) };
};
// 认领证据：任务记录里带着同一个令牌的活，就是这一枪派出去的。
const findInJobs: NonNullable<AutopilotDeps['find']> = async (_run, action) => {
  const names = await readdir(paths().jobs).catch(error => { if (hasCode(error, 'ENOENT')) return []; throw error; });
  const found: string[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const job = await readJob(name);
      if (job.autopilot?.token === action.token) found.push(job.id);
    } catch (error) { if (!hasCode(error, 'ENOENT') && !(error instanceof SyntaxError)) throw error; }
  }
  return found.length ? found.sort() : null;
};
const inspectJobs: NonNullable<AutopilotDeps['inspect']> = async jobs => {
  let failed = false;
  for (const id of jobs) {
    let job: Job;
    try { job = await readJob(id); }
    catch (error) { if (hasCode(error, 'ENOENT')) { failed = true; continue; } throw error; }
    if (job.state === 'queued' || job.state === 'running') return 'running';
    if (job.state !== 'done') failed = true;
  }
  return failed ? 'failed' : 'done';
};
const usageOfJobs: NonNullable<AutopilotDeps['usage']> = async jobs => {
  let total: { read: number; cached: number; out: number } | undefined;
  for (const id of jobs) {
    try {
      const job = await readJob(id);
      if (!job.usage) continue;
      total ??= { read: 0, cached: 0, out: 0 };
      total.read += job.usage.read; total.cached += job.usage.cached; total.out += job.usage.out;
    } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
  }
  return total;
};
const stopByCommand: NonNullable<AutopilotDeps['stopJob']> = async job => { await stop(job); };

const depsOf = (deps: AutopilotDeps) => ({
  start: deps.start ?? startByDispatch,
  find: deps.find ?? findInJobs,
  inspect: deps.inspect ?? inspectJobs,
  usage: deps.usage ?? usageOfJobs,
  stopJob: deps.stopJob ?? stopByCommand,
});

// 动作锁等多久：这里等的是"另一个推进器正在派活"，正常最多等一次派活的时间，所以给足两分钟。
const ACTION_LOCK_WAIT_MS = 120_000;

// 走一步。返回值：ended 已经停下、waiting 在等外部工作、acted 刚做完一步、idle 没活可干。
//
// 整段"复核 → 查证据 → 动手 → 写回任务号"都在这一台执行的动作锁里做，锁内一律重新读登记：
// 两个推进器（哪怕在两个进程里）不可能同时走进来，后进来的会先看到前一个已经写好的任务号，于是认领而不是重派。
export async function stepAutopilot(id: string, deps: AutopilotDeps = {}): Promise<'ended' | 'waiting' | 'acted' | 'idle'> {
  const first = await readAutopilot(id);
  if (isEndedState(first.state)) return 'ended';
  return withLock(actionLockDir(id), async () => {
    const run = await readAutopilot(id);          // 权威状态：锁内重读，不信锁外看到的
    if (isEndedState(run.state)) return 'ended';  // 停下/预算收尾之后，过期动作一个字都不能再动
    const limit = exceededBudget(run);
    if (limit) return exhaust(id, run, limit, deps);
    return run.action ? recover(id, deps) : takeAction(id, deps);
  }, ACTION_LOCK_WAIT_MS);
}

// 预算用完：先按令牌把可能已经派出去、只是还没记上号的活认领出来停掉，再转 needs_owner。
// 认领放在动作锁里，所以不会和正在派活的那一步打对台。
async function exhaust(id: string, run: AutopilotRun, limit: BudgetLimit, deps: AutopilotDeps): Promise<'ended'> {
  const runner = depsOf(deps);
  const jobs = new Set([...(run.action?.jobs ?? []), ...run.attempts.flatMap(item => item.jobs ?? [])]);
  if (run.action && !run.action.jobs?.length) {
    const found = await runner.find(run, run.action).catch(() => null);
    for (const job of found ?? []) jobs.add(job);
  }
  for (const job of jobs) await runner.stopJob(job).catch(() => {});
  await updateAutopilot(id, current => {
    if (isEndedState(current.state)) return;
    advance(current, { kind: 'budget', limit });
  });
  return 'ended';
}

// 领一个动作令牌并记下意图。锁里只有一个推进器，令牌复核仍然照做：别的进程可能刚把动作顶掉。
async function takeAction(id: string, deps: AutopilotDeps): Promise<'acted' | 'idle' | 'ended'> {
  const holder: { action?: AutopilotAction } = {};
  const written = await updateAutopilot(id, run => {
    if (isEndedState(run.state) || run.action) return;
    const node = run.nodes.find(item => item.state === 'pending' || item.state === 'running' || item.state === 'failed');
    if (!node) {
      // 所有节点都已有结论，却没有新的事能做：交给主人，不许原地空转。
      advance(run, { kind: 'blocked', note: `没有可继续的节点了（${run.nodes.map(item => `${item.id} ${item.state}`).join('、')}），请主人接手。` });
      return;
    }
    const at = new Date().toISOString();
    const action = { token: newToken(), node: node.id, attempt: node.attempts + 1, at };
    run.action = action;
    node.attempts += 1;
    node.state = 'running';
    run.attemptCount += 1;
    run.attempts.push({ node: action.node, attempt: action.attempt, token: action.token, at });
    if (!advance(run, { kind: 'intent' })) throw new Error(`无人看守 ${id} 在 ${run.state} 状态下不能开新动作。`);
    holder.action = action;
  });
  if (!holder.action) return isEndedState(written.state) ? 'ended' : 'idle';
  return startAction(id, holder.action, deps);
}

// 记完意图才动手。动手之前（仍在动作锁里）再复核一遍：已经收了、令牌被顶掉、时长或用量到线，就一件都不派。
// 派活本身失败（自检、额度、并发、登录）不重试，直接转 needs_owner 写清原因。
async function startAction(id: string, action: AutopilotAction, deps: AutopilotDeps): Promise<'acted' | 'ended'> {
  const run = await readAutopilot(id);
  if (isEndedState(run.state)) return 'ended';
  if (run.action?.token !== action.token) return 'acted';      // 这个动作已经被更晚的一步顶掉了
  const late = dispatchBudget(run);
  if (late) return exhaust(id, run, late, deps);
  try {
    const { jobs } = await depsOf(deps).start({
      run: id, token: action.token, project: run.project, taskId: run.taskId, who: run.who, ro: run.ro,
      node: action.node, attempt: action.attempt,
    });
    await updateAutopilot(id, current => {
      if (current.action?.token !== action.token) return;
      current.action.jobs = jobs;
      advance(current, { kind: 'started' });
    });
    return 'acted';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateAutopilot(id, current => {
      if (current.action?.token !== action.token) return;
      const attempt = current.attempts.at(-1);
      if (attempt && attempt.token === action.token) { attempt.outcome = 'blocked'; attempt.note = message; }
      delete current.action;
      advance(current, { kind: 'blocked', note: `没能派活：${message}` });
    });
    return 'ended';
  }
}

// 恢复待确认的动作（锁内重读登记）。两个崩溃窗口都在这里分开处理：
// - "记下意图、还没动手就崩了"：查不到证据 → 用同一个令牌补一次（工作从没开始，不算重复派活）。
// - "外面已经派完了、还没落盘就崩了"：找到带同一令牌的任务记录 → 只认领记账，不再派。
async function recover(id: string, deps: AutopilotDeps): Promise<'ended' | 'waiting' | 'acted' | 'idle'> {
  const runner = depsOf(deps);
  const run = await readAutopilot(id);
  const action = run.action;
  if (!action) return 'idle';                                   // 别人刚刚收完尾
  if (isEndedState(run.state)) return 'ended';                  // 收了：过期的动作再也不许派活
  let jobs = action.jobs?.length ? action.jobs : undefined;
  if (!jobs) {
    const found = await runner.find(run, action);
    if (!found) return startAction(id, action, deps);
    await updateAutopilot(id, current => { if (current.action?.token === action.token) current.action.jobs = found; });
    jobs = found;
  }
  const state = await runner.inspect(jobs);
  if (state === 'running') return 'waiting';
  await settle(id, action, jobs, state === 'failed' ? 'failed' : 'done', deps);
  return 'acted';
}

// 落盘一步的结果：只有令牌还是当前的那个推进器能写。
async function settle(id: string, action: AutopilotAction, jobs: string[], outcome: 'done' | 'failed', deps: AutopilotDeps): Promise<void> {
  const usage = await depsOf(deps).usage(jobs).catch(() => undefined);
  await updateAutopilot(id, run => {
    if (run.action?.token !== action.token) return;
    const attempt: AutopilotAttempt | undefined = run.attempts.find(item => item.token === action.token);
    if (attempt) { attempt.outcome = outcome; attempt.jobs = jobs; }
    const node = run.nodes.find(item => item.id === action.node);
    if (node) node.state = outcome === 'done' ? 'passed' : 'failed';
    if (usage) {
      run.usage ??= { read: 0, cached: 0, out: 0 };
      run.usage.read += usage.read; run.usage.cached += usage.cached; run.usage.out += usage.out;
    }
    delete run.action;
    // 等恢复的登记（推进器中途没了）：先把状态接回"在干"，再把这一次的结果记账，否则转移会被状态机拒掉。
    if (run.state === 'recovering') advance(run, { kind: 'resume' });
    if (outcome === 'done') {
      // 骨架：这一步做完了，但自动审查与验收还没接（TASK-009 范围之外），结果交给主人。
      if (!advance(run, { kind: 'done' })) return;
      advance(run, { kind: 'blocked', note: `无人看守骨架这一版还没有自动审查和验收，${action.node} 的这次执行结果请主人接手看。` });
      return;
    }
    if (!advance(run, { kind: 'failed', note: `${action.node} 这一次没成（第 ${action.attempt} 次尝试）。` })) return;
    if (node && canRetry(run, node.id)) {
      node.retries += 1;
      advance(run, { kind: 'retry' });
      return;
    }
    advance(run, { kind: 'blocked', note: `${action.node} 第 ${action.attempt} 次尝试失败，重试次数或预算已经用完，请主人接手。` });
  });
}

// 推进器主体：单飞轮。已有活着的推进器时这个进程直接退出（同一台执行只有一个推进器）。
export async function runAutopilot(id: string, deps: AutopilotDeps = {}): Promise<void> {
  if (inProcess.has(id)) { console.error('无人看守的推进进程已经在跑，这个进程退出。'); return; }
  inProcess.add(id);
  let stopping = false;
  const onStop = () => { stopping = true; };
  process.on('SIGTERM', onStop); process.on('SIGINT', onStop);
  const clock = deps.now ?? Date.now;
  try {
    // 执行权在登记锁里复核并领取：先读后写会留下"两个进程都看到没有推进器、各写各的 pid"的窗口，
    // 所以"看有没有活的推进器"和"把 pid 写成自己"必须在同一次锁内改写里做完。
    const claim: { ok: boolean; taken: boolean } = { ok: false, taken: false };
    await updateAutopilot(id, run => {
      if (!isActiveState(run.state)) return;
      if (engineAlive(run) && run.pid !== process.pid) { claim.taken = true; return; }
      run.pid = process.pid;
      const since = processSince(process.pid);
      if (since === undefined) delete run.pidSince; else run.pidSince = since;
      claim.ok = true;
    });
    if (!claim.ok) {
      console.error(claim.taken ? '无人看守的推进进程已经在跑，这个进程退出。' : '无人看守已经停下，这个进程退出。');
      return;
    }
    let previous = clock();
    while (!stopping) {
      const result = await stepAutopilot(id, deps);
      if (result === 'ended') return;
      const now = clock();
      // 运行时长按秒累计，扣掉电脑休眠（两次采样间隔超过一分钟就当睡过）。
      const gapMs = now - previous;
      await updateAutopilot(id, run => {
        if (!isActiveState(run.state)) return;
        if (gapMs > SLEEP_GAP_MS) run.sleeps += gapMs / 1000;
        else run.elapsedSeconds += Math.max(0, gapMs) / 1000;
      });
      previous = now;
      // 等外部工作、或者没活可干，都歇一轮再走，绝不热循环。
      if (result === 'waiting' || result === 'idle') {
        try { await sleep(deps.pollMs ?? POLL_MS); } catch { return; }
        continue;
      }
      // 刚做完一步：立刻再走一步（多半是"活干完了转交主人"这种收尾），但先让出一次事件循环。
      await sleep(0);
    }
  } finally {
    process.off('SIGTERM', onStop); process.off('SIGINT', onStop);
    inProcess.delete(id);
    // 自己走完了就把进程号清掉：登记里不留一个已经不在的 pid。别人的 pid 一个字都不碰。
    await updateAutopilot(id, run => {
      if (run.pid === process.pid && isEndedState(run.state)) { delete run.pid; delete run.pidSince; }
    }).catch(() => {});
  }
}

// 受控启动：登记建好后才叫推进器。登记建不成（不可执行任务、非法预算、非法选手）在这里就失败，不留进程。
// 叫不起来（spawn 出错）也不留"活跃但没有推进器"的半截状态：记成等恢复，下一次启动接着走。
export async function startAutopilot(
  options: AutopilotStartOptions, deps: { launch?: (id: string) => Promise<void> } = {},
): Promise<AutopilotRun> {
  const run = await createAutopilot(options);
  try { await (deps.launch ?? launchAutopilotEngine)(run.id); }
  catch (error) {
    await markLost(run.id, '推进进程没能启动，用 autopilot resume 接着起来。').catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`推进器没能启动（${message}）。登记 ${run.id} 已经留好，用 xagents autopilot resume ${run.id} 接着起来。`);
  }
  return readAutopilot(run.id);
}

// 受控恢复：只接编号，别的什么都不接。原任务、选手、权限、联网快照、预算和动作令牌一个字都不改，
// 只是把推进器重新叫起来接着走（不会建新登记，也就不会另起一台）。
// 结束的、读不出来的登记一律拒绝；已经有活着的推进器也拒绝，不重复启动。
export async function resumeAutopilot(
  id: string, deps: { launch?: (id: string) => Promise<boolean> } = {},
): Promise<AutopilotRun> {
  const run = await readAutopilot(id);
  if (isEndedState(run.state)) {
    throw new Error(`无人看守 ${id} 已经停在「${stateNames[run.state]}」，不用恢复；要重来请用 xagents autopilot start 另开一台。`);
  }
  const launched = await (deps.launch ?? launchAutopilotEngine)(id);
  const now = await readAutopilot(id);
  if (!launched) {
    if (isEndedState(now.state)) throw new Error(`无人看守 ${id} 已经停在「${stateNames[now.state]}」，不用恢复。`);
    throw new Error(`无人看守 ${id} 的推进器已经在跑（进程号 ${String(now.pid)}），不用恢复；用 xagents autopilot status ${id} 看进展。`);
  }
  return now;
}

// 叫起推进器。返回值：true 表示这次真的起了新进程，false 表示已经有推进器在跑或者登记已经结束。
// "有没有活的推进器"和"把 pid 记成新进程"在同一个登记锁里复核，不会两边各起一台。
export async function launchAutopilotEngine(id: string): Promise<boolean> {
  const entry = await engineSnapshot(autopilotDir(id), 'autopilot-entry.ts');
  const fd = await open(join(autopilotDir(id), 'engine.log'), 'a', 0o600);
  const launched = { ok: false };
  try {
    await updateAutopilot(id, async run => {
      if (!isActiveState(run.state)) return;
      if (engineAlive(run)) return;
      const node = nodeCommand([entry, id], engineEnvironment());
      const child = spawn(node.file, node.args, { ...backgroundSpawn(), stdio: ['ignore', fd.fd, fd.fd], env: node.env });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      const since = processSince(child.pid);
      if (since === undefined) delete run.pidSince; else run.pidSince = since;
      run.pid = child.pid;
      launched.ok = true;
    });
  } finally { await fd.close(); }
  return launched.ok;
}

// 受控停止：先停推进器，再停它派出去的活，最后落盘 stopped。停下之后不留推进器进程。
export async function stopAutopilot(id: string, deps: AutopilotDeps = {}): Promise<AutopilotRun> {
  const runner = depsOf(deps);
  const before = await readAutopilot(id);
  if (isEndedState(before.state)) return before;
  // 先拿这台执行的动作锁：正在派活的那一步要么先把任务号写回来（我们随后把它停掉），
  // 要么已经发现"收了"而根本不派。停下之后再进来的一步，只会在锁里读到 stopped 然后什么都不做。
  return withLock(actionLockDir(id), async () => {
    const run = await readAutopilot(id);
    if (isEndedState(run.state)) return run;
    await killEngine(run.pid, run.pidSince);
    const jobs = new Set([...(run.action?.jobs ?? []), ...run.attempts.flatMap(item => item.jobs ?? [])]);
    if (run.action && !run.action.jobs?.length) {
      const found = await runner.find(run, run.action).catch(() => null);
      for (const job of found ?? []) jobs.add(job);
    }
    for (const job of jobs) await runner.stopJob(job).catch(() => {});
    return updateAutopilot(id, current => {
      if (isEndedState(current.state)) return;
      advance(current, { kind: 'stop', note: '主人收手了：推进器和在动的活都停下了。' });
      delete current.pid; delete current.pidSince;
    });
  }, ACTION_LOCK_WAIT_MS);
}

// 推进器还在不在：只有进程号合法、进程真的还在、启动时间也对得上，才算它自己的推进器。
// pid 为 0、负数、或者 pidSince 对不上（进程号被别人复用了），一律当"不是它"。
export function engineAlive(run: { pid?: number; pidSince?: number }): boolean {
  if (!Number.isInteger(run.pid) || (run.pid as number) <= 0) return false;
  if (run.pidSince !== undefined) {
    let since: number | undefined;
    // Windows 读不到出生时间就说明进程已经不在；macOS 那边一律拿不到，只按进程号判。
    try { since = processSince(run.pid); } catch { return false; }
    if (since !== undefined && since !== run.pidSince) return false;   // 进程号被别人复用了
  }
  return alive(run.pid, run.pidSince);
}

// 推进器丢了：原子地把活跃登记转成 recovering 并清掉无效的进程号，写明原因。
// 只在锁里再确认一次——可能刚好有推进器接手，那就一个字都不改。
async function markLost(id: string, note = `推进进程不在了，用 xagents autopilot resume ${id} 接着走。`): Promise<AutopilotRun> {
  return updateAutopilot(id, current => {
    if (!isActiveState(current.state) || engineAlive(current)) return;
    if (current.state === 'recovering') { current.reason = note; }
    else advance(current, { kind: 'lost', note });
    delete current.pid; delete current.pidSince;
  });
}

// 只读列表和启动命令用：活跃登记却没有推进器（新建没叫起来、进程号非法、进程已经死了）都记成等恢复，
// 不让它永久卡在 planning/executing。结束状态（已归档、等主人、已停止）一个字都不动。
export async function reconcileAutopilot(run: AutopilotRun): Promise<AutopilotRun> {
  if (!isActiveState(run.state) || engineAlive(run)) return run;
  try { return await markLost(run.id); }
  catch (error) {
    if (hasCode(error, 'ENOENT')) return run;
    throw error;
  }
}
