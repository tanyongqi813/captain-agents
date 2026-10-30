import { nodeCommand, nodeRunner, externalEnvironment } from './node-runtime.ts';
import { readSettings, readDeepseekRuntimeSettings } from './settings.ts';
import { observeMoney, readMoneyStatus } from './money-budget.ts';
import { deepseekBudgetForGroup } from './deepseek-settings.ts';
import { prepareDeepseekCredentials } from './deepseek-credentials.ts';
import { assertDeepseekRuntimeReasoning } from './deepseek-reasoning-runtime.ts';
import { recordDeepseekModelError } from './deepseek-model-recovery.ts';
import { checkChoice } from './policy.ts';
import { spawn } from 'node:child_process';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { jobDir } from './paths.ts';
import { updateJob, finish, listJobs, readJob } from './job.ts';
import type { Job } from './job.ts';

async function runtimeMoney(job: Job) {
  const group = job.deepseekBudgetGroup ?? 'default';
  const money = deepseekBudgetForGroup(await readDeepseekRuntimeSettings(), group);
  if ((!money && job.deepseekConnection?.money?.enabled) || (group !== 'default' && !money?.enabled)) {
    throw new Error('任务所属费用预算组缺失或已关闭，已停止收费调用。');
  }
  return money;
}
import { LiveProgress } from './live.ts';
import { writeAtomic, hasCode, readOptional } from './fsx.ts';
import { saveDiff, worktreeMissing } from './worktree.ts';
import { keepAwake } from './awake.ts';
import { SleepMonitor } from './sleeps.ts';
import { readQuotaCache } from './quota.ts';
import { collectRealSteps } from './real.ts';
import { cursorToken, resumeCommand, selection } from './workers.ts';
import { workerEnv, passEnv } from './env.ts';
import { processSince, assertTreeControl, killTree, treeSpawn, finalTreeCleanup } from './platform.ts';
import { budgetTick, initialBudgetState, DEFAULT_BUDGET } from './budget.ts';
import type { Budget, BudgetState } from './budget.ts';
import { projectBudget, loadProject } from './project.ts';

// 停掉选手（或准备命令）带出来的所有进程。since 是起它的时间，只有 Windows 用得上（见 platform.ts）。
export function killGroup(pid: number | undefined, signal: 'SIGTERM' | 'SIGKILL', since?: number, exitedAt?: number, bornBy?: number) {
  killTree(pid, signal, since, exitedAt, bornBy);
}
export async function reconcileSafely() {
  try { await listJobs(true); }
  catch (e) { console.error(`修正任务状态失败：${(e as Error).message}。请运行 xagents status --all 重试。`); }
}
// onStop：任务记录里出现“请求停止”时调用。onBudget：停滞或总超时命中时调用（先记终止原因再走正常停止收尾）。
// budget/now 都注入：生产用真实时钟，测试可以快进。日志元数据（run.log/stderr.log 的大小和修改时间）读不到就只少一个信号，
// 看管进程不崩，最后由单次总时限兜底。
async function watch(id: string, progress: LiveProgress, signal: AbortSignal, budget: Budget, startedAt: number, now: () => number, onStop: () => void, onBudget: (event: 'stalled' | 'timed-out') => void) {
  const sleeps = new SleepMonitor(id, now);
  const dir = jobDir(id);
  let state: BudgetState = initialBudgetState();
  let logChangedAt: number | null = null;
  let logBytes = 0;
  // 每个日志文件上一次看到的大小和修改时间；变大了或更新过就算一次信号（选手还在往外写）。
  const seen = new Map<string, { size: number; mtimeMs: number }>();
  while (!signal.aborted) {
    try { await sleep(2000, undefined, { signal }); }
    catch (e) { if (signal.aborted) return; throw e; }
    if (signal.aborted) return;
    try {
      const at = now();
      const slept = await sleeps.sample();
      await progress.sample();
      let activityAt: number | null = null;
      try {
        const raw = progress.parser.result().lastActivityAt;
        const parsed = raw ? Date.parse(raw) : NaN;
        activityAt = Number.isFinite(parsed) ? parsed : null;
      } catch { activityAt = null; }
      // 日志信号：单个文件读失败只跳过它，不影响这一轮判定，更不能把看管进程弄崩。
      for (const name of ['run.log', 'stderr.log']) {
        try {
          const info = await stat(join(dir, name));
          const before = seen.get(name);
          if (before && (info.size > before.size || info.mtimeMs > before.mtimeMs)) logChangedAt = at;
          seen.set(name, { size: info.size, mtimeMs: info.mtimeMs });
          logBytes = 0;
          for (const size of seen.values()) logBytes += size.size;
        } catch { /* 元数据读不到：少一个信号，总时限兜底。 */ }
      }
      const job = await readJob(id);
      if (job.who === 'deepseek' || job.who === 'deepseek-flash') {
        try {
          const money = await runtimeMoney(job);
          const reason = await observeMoney(id, money, progress.parser.result().usage);
          if (reason) {
            const group = job.deepseekBudgetGroup ?? 'default';
            try {
              const evidence = join(dir, 'money-stop-' + (job.resume?.round ?? 1) + '.json');
              if (!await readOptional(evidence)) await writeAtomic(evidence, JSON.stringify({
                at: new Date().toISOString(), reason, group, hard: money?.hard ?? null, soft: money?.soft ?? null,
                status: await readMoneyStatus(Date.now(), money, group),
              }, null, 2) + '\n');
            } catch { console.error('费用停止证据未能保存；仍停止任务，请核对账本。'); }
            await updateJob(id, j => { j.stopRequested = true; j.error = reason; });
            onStop();
          }
        } catch {
          await updateJob(id, j => { j.stopRequested = true; j.error = '费用看管无法核对账本，已停止任务。'; });
          onStop();
        }
      }
      const tick = budgetTick(budget, state, { now: at, startedAt, sleeps: job.sleeps ?? [], lastActivityAt: activityAt, logChangedAt });
      state = tick.state;
      if (tick.event === 'stall-warning') {
        const signalAt = state.warnedSignalAt;
        await updateJob(id, j => { j.stallWarning = { at: new Date(at).toISOString(), signalAt: new Date(signalAt).toISOString(), logBytes }; });
      } else if (tick.cleared) {
        await updateJob(id, j => { delete j.stallWarning; });
      } else if (tick.event === 'stalled' || tick.event === 'timed-out') {
        onBudget(tick.event);
      }
      if (await progress.persist() || slept) await reconcileSafely();
      if (job.stopRequested) onStop();
    } catch (e) { console.error(`读取任务进度失败：${(e as Error).message}，下次采集重试。`); }
  }
}
export async function runWorker(id: string, options?: { now?: () => number }) {
  const now = options?.now ?? Date.now;
  let stopping = false, workerPid: number | undefined, workerSince: number | undefined, workerExitedAt: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let job: Job | undefined, progress: LiveProgress | undefined, code: number | null = null, failure: string | undefined;
  let fatalFailure: string | undefined;
  // 这件活生效的执行预算：起选手后从项目登记读（缺省 20/5/120）；读不到或登记坏了按缺省，总时限兜底，不能放宽。
  let budget: Budget = { ...DEFAULT_BUDGET };
  // 停滞/总超时命中时记下结构化终止原因和给人看的说明；手动停止保持 undefined（收尾时记 manual）。
  let termination: Job['termination'] | undefined, budgetNote: string | undefined;
  let releaseDeepseekCredentials: (() => Promise<void>) | undefined;
  const message = (error: unknown) => {
    try { return String(error instanceof Error ? error.message : error).slice(0, 2000); }
    catch { return '未知异常'; }
  };
  const addFailure = (text: string) => { failure = failure ? `${failure} ${text}` : text; };
  const finalizeWorkerTree = finalTreeCleanup();
  const killWorker = () => {
    try { finalizeWorkerTree(workerPid, workerSince, workerExitedAt); }
    catch (error) { addFailure(`停止选手进程组失败：${message(error)}`); }
  };
  let wakeFatal!: () => void;
  const fatalSignal = new Promise<void>(resolve => { wakeFatal = resolve; });
  // 事件处理器必须同步杀组，并接住自身的清理错误，不能再产生未处理拒绝。
  const fatal = (kind: string, error: unknown) => {
    fatalFailure ??= `看管进程${kind}：${message(error)}`;
    process.exitCode = 1;
    killWorker();
    wakeFatal();
  };
  const uncaught = (error: Error) => fatal('未捕获异常', error);
  const unhandled = (error: unknown) => fatal('未处理拒绝', error);
  const stop = () => {
    stopping = true;
    if (fatalFailure) { killWorker(); return; }
    // 已经在收尾就不重复（Windows 上每次都要读一遍进程列表）。
    if (timer) return;
    try { killGroup(workerPid, 'SIGTERM', workerSince, workerExitedAt); }
    catch (error) { addFailure(`停止选手进程组失败：${message(error)}`); }
    // 某些选手不响应 SIGTERM，宽限后仍必须收尾整个组。
    timer = setTimeout(killWorker, 1000);
  };
  // 执行预算命中：先记终止原因，再走和手动停止一样的进程树收尾，证据（预警快照、日志、报告、diff）照常收集。
  const onBudget = (event: 'stalled' | 'timed-out') => {
    termination = event === 'stalled' ? 'stalled' : 'timed_out';
    budgetNote = event === 'stalled'
      ? `停滞超过 ${budget.stallMinutes} 分钟（宽限 ${budget.graceMinutes} 分钟）没有新活动或日志增长，平台已自动停止；请查看日志后决定续跑或重派。`
      : `超过单次总时限 ${budget.maxMinutes} 分钟，平台已自动停止；请检查是否把过大的活拆小再派。`;
    stop();
  };
  process.on('uncaughtException', uncaught);
  process.on('unhandledRejection', unhandled);
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    const claimed = await updateJob(id, j => {
      if (j.state !== 'queued') return;
      if (j.stopRequested) { j.termination = 'manual'; finish(j, 'stopped'); return; }
      j.pidSince = processSince(process.pid); j.pid = process.pid; j.started = new Date().toISOString(); j.state = 'running';
    });
    if (claimed.state !== 'running' || claimed.pid !== process.pid) return;
    job = claimed;
    if (job.who === 'deepseek' || job.who === 'deepseek-flash') {
      const money = await runtimeMoney(job);
      if (job.resume && money?.enabled) throw new Error('每日费用预算开启时请重新派活，不续接已结算的会话。');
      const reason = await observeMoney(id, money, undefined);
      if (reason) throw new Error(reason);
    }
    checkChoice((await readSettings()).workers, selection(`${job.who}:${job.effort}${job.fast ? ':fast' : ''}`));
    await reconcileSafely();
    if (!job.command) throw new Error('没有保存选手命令，请重新派发。');
    try { budget = projectBudget(await loadProject(job.project)); }
    catch { console.error('读取项目执行预算失败，按缺省 20/5/120 分钟执行。'); }
    // 第 2 轮起：command 已由共用准备函数按本轮平台重建，这里只做既有的续接变形。
    const cmd = job.resume ? resumeCommand(job) : job.command, dir = jobDir(id);
    assertDeepseekRuntimeReasoning(job, cmd);
    const handles = [];
    const controller = new AbortController();
    let polling: Promise<void> | undefined;
    let releaseAwake: (() => Promise<void>) | undefined;
    try {
      const output = await open(join(dir, 'run.log'), 'w', 0o600); handles.push(output);
      const errors = await open(join(dir, 'stderr.log'), 'w', 0o600); handles.push(errors);
      const input = cmd.stdin === 'prompt' ? await open(join(dir, job.resume?.prompt ?? 'prompt.md'), 'r') : undefined;
      if (input) handles.push(input);
      if (!stopping && !fatalFailure) {
        // 名字带密钥字样的环境变量不交给选手（规则在 env.ts）；平台设的照给，这件活点名不要的再去掉。
        // 点名放行的变量（主人的 Codex 配置里放钥匙的那一个）：过滤之后再补回，只给选手的主程序；值不进任务记录。
        const env = passEnv(externalEnvironment(workerEnv(process.env, cmd.env, cmd.unset)), cmd.pass, process.env, [...Object.keys(cmd.env), ...(cmd.unset ?? [])]);
        if ((job.who === 'deepseek' || job.who === 'deepseek-flash') && !process.env.XAGENTS_FAKE_WORKER) {
          if (!job.deepseekConnection) throw new Error('旧任务缺少 DeepSeek 连接快照，请重新派活。');
          const credentials = await prepareDeepseekCredentials(job.id, job.deepseekConnection, job.deepseekCredentialVersion);
          releaseDeepseekCredentials = credentials.release;
          env.CODEX_HOME = credentials.home;
        }
        // Cursor 的登录在隔离外现取，只放进这次进程的环境，不进任务记录（见 workers.ts 的 cursorToken）。
        // 必须放在上面那步过滤之后：它的名字带 TOKEN，先加再过滤就会被去掉，Cursor 就成了没登录。
        // 替身模式下没指定假的 security 就不取，测试不碰真钥匙串。
        if (cmd.login === 'cursor' && (!process.env.XAGENTS_FAKE_WORKER || process.env.XAGENTS_SECURITY)) {
          const token = await cursorToken();
          env.CURSOR_API_KEY = token; // 新版 Cursor CLI 公布的变量名。
          env.CURSOR_AUTH_TOKEN = token; // 兼容旧版 CLI。
        }
        if (stopping || fatalFailure) return;
        // srt 和测试替身用平台 Node；外部选手直接启动，不带 Electron 开关。
        const launch = cmd.file === nodeRunner().file ? nodeCommand(cmd.args, env) : { ...cmd, env };
        assertTreeControl();
        workerSince = Date.now();
        const child = spawn(launch.file, launch.args, { cwd: job.worktree, ...treeSpawn(), env: launch.env, stdio: [input?.fd ?? 'ignore', output.fd, errors.fd] });
        const spawned = new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        workerPid = child.pid;
        const finished = new Promise<number | null>((resolve, reject) => {
          child.on('error', reject);
          child.once('exit', () => { workerExitedAt = Date.now(); });
          child.on('close', resolve);
        });
        // 马上接上拒绝处理，避免登记过程中 spawn 失败产生未处理拒绝。
        finished.catch(() => {});
        await spawned;
        // 起选手之前就有人请求停止的（那时还没有选手进程可停），登记完马上停。
        if ((await updateJob(id, j => { j.workerPid = workerPid; j.workerSince = workerSince; })).stopRequested) stop();
        releaseAwake = await keepAwake();
        progress = new LiveProgress(job);
        if (input) progress.setPromptBytes((await input.stat()).size);
        polling = watch(id, progress, controller.signal, budget, Date.parse(job.started!), now, stop, onBudget);
        // 在主流程等选手退出期间也及时接住采集任务的拒绝。
        polling.catch(unhandled);
        if (stopping) stop();
        code = await Promise.race([finished, fatalSignal.then(() => null)]);
      }
    } finally {
      // 清理最先停止选手；后续日志、采集或防休眠出错也不能遗留后台选手。
      if (timer) clearTimeout(timer);
      killWorker();
      controller.abort();
      const cleanups = [Promise.race([polling, fatalSignal]), Promise.resolve().then(() => releaseAwake?.()), ...handles.map(fd => fd.close())];
      for (const result of await Promise.allSettled(cleanups)) {
        if (result.status === 'rejected') addFailure(`看管收尾失败：${message(result.reason)}`);
      }
    }
  } catch (error) {
    addFailure(`${message(error)} 请查看任务目录中的日志。`);
  } finally {
    if (timer) clearTimeout(timer);
    killWorker();
    let quotaAfter: Awaited<ReturnType<typeof readQuotaCache>> = null;
    try {
      quotaAfter = job ? await readQuotaCache() : null;
      if (job) {
        progress ??= new LiveProgress(job);
        // 停止、失败也收集已经留下的输出，结束状态最后一次性写入。
        try { await progress.sample(true); }
        catch (e) { console.error(`收尾读取进度失败：${(e as Error).message}`); }
        const dir = jobDir(id);
        const parsed = progress.parser.result(await readOptional(join(dir, 'final.md')));
        try { const diagnostic = await recordDeepseekModelError(job); if (diagnostic) addFailure(diagnostic); }
        catch { addFailure('模型错误诊断未能保存，请检查任务日志。'); }
        if (job.deepseekConnection?.money?.enabled) {
          try {
            const money = await runtimeMoney(job);
            await observeMoney(id, money, parsed.usage);
            await observeMoney(id, money, !stopping && code === 0 ? parsed.usage : undefined, true);
          } catch {
            // 财务异常必须记录为失败，但不能阻断报告和补丁的独立保存。
            addFailure('费用结算失败，账本待核对；任务报告和改动仍会保存。');
            console.error('费用结算失败，账本待核对。');
          }
        }
        await writeAtomic(join(dir, 'report.md'), parsed.report ? parsed.report + '\n' : '');
        if (await worktreeMissing(job)) console.error('副本已不在，没法保存改动。');
        else try { await saveDiff(job); }
        catch (e) { console.error(`保存改动失败：${(e as Error).message}。请运行 collect 重试。`); }
        await updateJob(id, j => {
          Object.assign(j, { quota_after: quotaAfter });
          collectRealSteps(j, parsed.report);
          progress!.apply(j); j.exit = code;
          if (fatalFailure) { j.termination = 'process_error'; finish(j, 'failed', [fatalFailure, failure].filter(Boolean).join(' ')); }
          else if (stopping || j.stopRequested) { j.termination = termination ?? 'manual'; finish(j, 'stopped', termination ? budgetNote : j.error); }
          else finish(j, !failure && code === 0 && parsed.report ? 'done' : 'failed', failure || (code !== 0 ? `选手退出码为 ${code}，请查看 stderr.log 和原始输出。` : !parsed.report ? '选手没有留下报告，请查看原始输出后运行 xagents collect。' : undefined));
        });
      }
    } catch (e) {
      await updateJob(id, j => {
        if (j.state === 'running') {
          Object.assign(j, { quota_after: quotaAfter });
          progress?.apply(j); j.exit = code;
          if (fatalFailure) { j.termination = 'process_error'; finish(j, 'failed', [fatalFailure, failure, message(e)].filter(Boolean).join(' ')); }
          else { j.termination = termination ?? (stopping ? 'manual' : undefined); finish(j, stopping ? 'stopped' : 'failed', stopping ? budgetNote : [failure, `${message(e)} 请查看任务目录中的日志。`].filter(Boolean).join(' ')); }
        }
      });
    } finally {
      if (timer) clearTimeout(timer);
      try {
        await reconcileSafely();
        // 连收尾阶段出现的致命错误也必须覆盖已写入的成功/停止状态。
        if (job && fatalFailure) await updateJob(id, j => {
          j.termination = 'process_error';
          finish(j, 'failed', [fatalFailure, failure].filter(Boolean).join(' '));
        });
      } finally {
        try { await releaseDeepseekCredentials?.(); }
        catch { console.error('DeepSeek 临时认证文件未能清理，请检查私有凭据目录权限。'); }
        process.off('SIGTERM', stop); process.off('SIGINT', stop);
        process.off('uncaughtException', uncaught); process.off('unhandledRejection', unhandled);
      }
    }
  }
}
