import { checkListed, listedProviders } from './listed.ts';
import { backgroundEnvironment, nodeCommand } from './node-runtime.ts';
import { processSince, backgroundSpawn, samePath } from './platform.ts';
import { spawn } from 'node:child_process';
import { open, realpath } from 'node:fs/promises';
import { join, resolve, basename, extname } from 'node:path';
import { paths, jobDir } from './paths.ts';
import { withLock, writeJson, writeAtomic } from './fsx.ts';
import { createJob, updateJob, listJobs, readJob, active, finish } from './job.ts';
import type { Job, Batch } from './job.ts';
import { findProject, projectBudget, worktreePath } from './project.ts';
import { uncommitted } from './project-check.ts';
import { git, addWorktree, setup } from './worktree.ts';
import { reserveJob, reserveBatch } from './ids.ts';
import { prompt, workerPrompt } from './prompt.ts';
import { selection, srtPath, refreshGrokLogin, checkDeepseekLogin, checkCursorLogin } from './workers.ts';
import { prepareRun, usePreparedRun } from './run-package.ts';
import { reconcileSafely } from './runner.ts';
import { installIcons } from './icons.ts';
import { ensurePlatform, ensureSelfcheck } from './selfcheck.ts';
import { ensureQuota, checkQuota } from './quota.ts';
import { readSettings, extraDenyRead } from './settings.ts';
import { checkChoice } from './policy.ts';
import { isolationOf, vendorOf } from './roster.ts';
import { initialRealCheck } from './real.ts';
import { readChat } from './chat.ts';
import { assertDeepseekAvailable } from './deepseek-settings.ts';
import { sharedAutopilotWorktree } from './autopilot-worktree.ts';
import { capsuleFingerprint } from './task-plan.ts';

// team：小队派的队员（docs/design-team.md），记进任务记录，看板据此画进小队卡。
// plan：从项目任务规划派发的追溯元数据（docs/tasks/TASK-006.md），由规划派发入口下发，写进任务记录。
export type RunOptions = { who: string[]; project?: string; base?: string; kind?: string; title?: string; summary?: string; ro?: boolean; force?: boolean; dirtyOk?: boolean; real?: boolean | string; team?: { id: string; role: 'writer' | 'reviewer' }; worktree?: string; chat?: { id: string }; plan?: { taskId: string; spec: string }; autopilot?: { run: string; token: string }; autopilotRole?: 'writer' | 'reviewer';
  capsule?: { rel: string; fingerprint: string; anchors?: string[] } };
// 规划派发要求起点自带这一轮的 Execution Capsule 原文：主工作区没提交的规划文件不会进入新副本，
// 起点里没有或和工作区这一份对不上就在注册任务、开副本、启动选手之前拒绝，并把两边的提交说清楚。
// 起点还得有 Capsule 明列的每一个源码锚点文件：缺哪个就报哪个，不猜替代文件、不降级成警告。
export async function assertCapsuleInStart(repo: string, base: string, capsule: { rel: string; fingerprint: string; anchors?: string[] }): Promise<void> {
  const short = (sha: string) => (sha ? sha.slice(0, 7) : '未知');
  const head = (await git(repo, ['rev-parse', 'HEAD'])).trim();
  let text: string;
  try {
    text = await git(repo, ['show', `${base}:${capsule.rel}`]);
  } catch {
    throw new Error(`所选起点 ${short(base)} 里没有 ${capsule.rel}：主工作区（HEAD ${short(head)}）这份执行说明还没提交，选手的副本看不到它。先把它提交（或用 --base 指向包含它的提交）再派活。`);
  }
  if (capsuleFingerprint(text) !== capsule.fingerprint) {
    throw new Error(`所选起点 ${short(base)} 里的 ${capsule.rel} 和主工作区（HEAD ${short(head)}）这一份内容对不上：起点不是同一版执行说明。把当前这份提交到起点分支，或用 --base 指向包含它的提交，再派活。`);
  }
  const missing: string[] = [];
  for (const anchor of capsule.anchors ?? []) {
    // 必须是起点里的普通文件（blob）：目录、符号链接目标缺失或根本没有都算缺。
    try {
      if ((await git(repo, ['cat-file', '-t', `${base}:${anchor}`])).trim() !== 'blob') missing.push(anchor);
    } catch { missing.push(anchor); }
  }
  if (missing.length) {
    throw new Error(`所选起点 ${short(base)} 里缺这一轮执行说明列出的源码锚点：${missing.join('、')}。主工作区（HEAD ${short(head)}）有这些文件，选手的副本看不到：先把它们提交到起点，或用 --base 指向包含它们的提交，再派活。`);
  }
}
export async function launch(job: Job, cli: string) {
  const fd = await open(join(jobDir(job.id), 'supervisor.log'), 'a', 0o600);
  try {
    await updateJob(job.id, async current => {
      if (current.state !== 'queued') return;
      const node = nodeCommand([cli, job.id], backgroundEnvironment());
      const child = spawn(node.file, node.args, { ...backgroundSpawn(), stdio: ['ignore', fd.fd, fd.fd], env: node.env });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      current.pidSince = processSince(child.pid); current.pid = child.pid;
    });
  } finally { await fd.close(); }
}
export async function dispatch(file: string, options: RunOptions, start: typeof launch = launch): Promise<Job[]> {
  const realCheck = initialRealCheck(options.real);
  const summary = typeof options.summary === 'string' ? options.summary.trim() : '';
  if (!summary) throw new Error('请用 --summary 写一两句给主人看的‘要做什么’，用大白话，不写文件名和技术细节。');
  if ([...summary].length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(options.summary!)) throw new Error('--summary 请写 1–200 字，不能含控制字符。');
  if (!options.who.length) throw new Error('还没选择选手，请加上 --who codex:xhigh（可以重复）。');
  const { workers, archivedProjects, limits, networkAllowed, deepseek } = await readSettings();
  const chosen = options.who.map(selection);
  checkListed(await listedProviders(), chosen);
  for (const choice of chosen) checkChoice(workers, choice);
  assertDeepseekAvailable(deepseek, chosen.some(choice => vendorOf(choice.who) === 'deepseek'));
  const kind = options.kind || '实现';
  if (!['修复', '实现', '审查', '调研', '测量'].includes(kind)) throw new Error('--kind 只允许修复、实现、审查、调研、测量，请修改后重试。');
  const temporaryMax = Number(process.env.XAGENTS_MAX_RUNNING ?? limits.maxRunning);
  if (!Number.isInteger(temporaryMax) || temporaryMax < 1) throw new Error('XAGENTS_MAX_RUNNING 必须是正整数，请修正环境变量。');
  const max = Math.min(limits.maxRunning, temporaryMax);
  // 额外禁读名单和主人设置一起在开头读好，后面开隔离一路带下去；读不出来就不派。
  const project = { ...await findProject(options.project), denyReadHome: await extraDenyRead() };
  if (archivedProjects.includes(project.name)) throw new Error(`项目 ${project.name} 已归档。要派活先取消归档：xagents project unarchive ${project.name}`);
  projectBudget(project); // 执行预算（停滞/宽限/单次总上限）在派活前把关：缺省 20/5/120，登记里写了不合法的直接拒绝。
  const network = networkAllowed;
  await worktreePath(project, 'check'); // 先做副本目录的安全检查（比如拒绝借符号链接开到仓库外），别被下面的提示盖住
  // 主目录有没提交的改动时先拦下：选手的副本看不到它们，常见于负责人自己写了一半的骨架还没提交。
  const dirty = await uncommitted(project);
  if (dirty.length && !options.dirtyOk) {
    const shown = dirty.slice(0, 5).join('、') + (dirty.length > 5 ? ` 等 ${dirty.length} 个` : '');
    throw new Error(`主目录有 ${dirty.length} 个文件没提交（${shown}），选手的副本看不到这些改动。先把要给选手的东西提交（比如骨架和共同约定，提交到分支并用 --base 指向它）；确认这些改动和这件活无关，再加 --dirty-ok 派活。`);
  }
  const base = (await git(project.repo, ['rev-parse', '--verify', '--end-of-options', `${options.base || 'main'}^{commit}`])).trim();
  if (options.capsule) await assertCapsuleInStart(project.repo, base, options.capsule);
  // 现成副本只能借用已登记的群副本，不能借这个入口扩大可写路径。
  const chat = options.chat ? await readChat(options.chat.id) : undefined;
  if (!!options.worktree !== !!chat) throw new Error('使用群副本时必须同时指定 worktree 和 chat。');
  if (options.autopilotRole && (!options.autopilot || chat || options.worktree || options.team)) throw new Error('自治副本不能与其他共享副本混用。');
  const shared = options.autopilotRole && options.autopilot
    ? await sharedAutopilotWorktree(options.autopilot, options.autopilotRole, options.who, options.ro === true, project.name, base, network) : undefined;
  if (chat) {
    if (chosen.length !== 1) throw new Error('群共用副本一次只能派一位成员。');
    const expected = await worktreePath(project, `chat-${chat.id}`);
    // 路径一律用 samePath 比：Windows 上 git 报的是正斜杠，登记里是反斜杠，盘符大小写也可能不同。
    if (chat.state !== 'open' || chat.project !== project.name || !samePath(chat.repo, project.repo) || chat.base !== base
      || chat.branch !== `xa/chat-${chat.id}` || !samePath(chat.worktree, expected) || !samePath(options.worktree!, expected)
      || !samePath(await realpath(expected), expected)
      || !samePath((await git(expected, ['rev-parse', '--show-toplevel'])).trim(), expected)
      || (await git(expected, ['symbolic-ref', '--short', 'HEAD'])).trim() !== chat.branch) {
      throw new Error('群副本与登记不符或群已收起，不能派活。');
    }
    for (const choice of chosen) {
      const member = chat.members.find(m => m.who === choice.who);
      if (!member || member.readOnly && !options.ro) throw new Error('只能派本群成员，只读成员必须使用只读隔离。');
    }
  }
  const baseText = await prompt(project, resolve(file), network);
  const title = options.title || basename(file, extname(file));
  const quota = await ensureQuota();
  checkQuota(quota, chosen, options.force, limits.quotaStop);
  if (chosen.some(s => isolationOf(s.who) !== 'codex') && !process.env.XAGENTS_FAKE_WORKER) await srtPath();
  // 替身不会启动任何真实选手，不把测试结果写成隔离通过。
  if (!process.env.XAGENTS_FAKE_WORKER) { const used = chosen.map(s => isolationOf(s.who)); ensurePlatform(used); await ensureSelfcheck(used); }
  await installIcons();
  const jobs: Job[] = [];
  await withLock(join(paths().cache, 'dispatch'), async () => {
    const running = (await listJobs(true)).filter(active);
    if (shared && running.some(j => j.autopilot?.run === options.autopilot?.run || samePath(j.worktree, shared.worktree))) throw new Error('自治执行还有选手在动手，请等待本轮结束。');
    if (chat && running.some(j => j.chat?.id === chat.id)) throw new Error('群里还有成员在动手，请等这一轮结束。');
    if (running.length + chosen.length > max) throw new Error(`同时最多跑 ${max} 件（设置 → 选手与模型 → 派活限制），现在已有 ${running.length} 件在跑或排队，本次要派 ${chosen.length} 件。${temporaryMax < limits.maxRunning ? '环境变量 XAGENTS_MAX_RUNNING 临时收紧了上限。' : ''}请等待结束、停止任务或在设置里调整上限；环境变量只能收紧。`);
    const now = new Date(), batch = await reserveBatch(file, now);
    try {
      for (const spec of chosen) {
        const id = await reserveJob(spec.who, file, now);
        const job: Job = { id, batch, ...spec, project: project.name, repo: project.repo, base,
          worktree: shared?.worktree ?? chat?.worktree ?? await worktreePath(project, id), branch: shared?.branch ?? chat?.branch ?? `xa/${id}`, mode: options.ro ? 'read-only' : 'workspace-write',
          ...(realCheck ? { realCheck: structuredClone(realCheck) } : {}),
          ...(network ? { network: true as const } : {}),
          ...(options.team ? { team: { ...options.team } } : {}),
          ...(options.chat ? { chat: { ...options.chat } } : {}),
          ...(options.plan ? { plan: { ...options.plan } } : {}),
          ...(options.autopilot ? { autopilot: { ...options.autopilot } } : {}),
          ...(options.autopilotRole ? { autopilotRole: options.autopilotRole } : {}),
          kind, title, summary, state: 'queued', created: now.toISOString(), queuedBy: process.pid, queuedSince: processSince(process.pid) };
        await createJob(Object.assign(job, { quota_before: quota })); jobs.push(job);
      }
    } catch (e) {
      for (const j of jobs) await updateJob(j.id, current => finish(current, 'failed', `登记失败：${(e as Error).message}`));
      throw e;
    } finally {
      const record: Batch = { id: batch, kind, title, summary, started: now.toISOString(), base, jobs: jobs.map(j => j.id) };
      await writeJson(join(paths().batches, `${batch}.json`), record);
    }
  });
  await reconcileSafely();
  for (const job of jobs) {
    try {
      if ((await readJob(job.id)).state !== 'queued') continue;
      // 先刷新 Grok 登录，没成功就不开副本、不派。
      if (isolationOf(job.who) === 'grok' && !process.env.XAGENTS_FAKE_WORKER) await refreshGrokLogin();
      // DeepSeek 没登录就不开副本、不派。
      if (vendorOf(job.who) === 'deepseek' && !process.env.XAGENTS_FAKE_WORKER) await checkDeepseekLogin();
      // Cursor 的登录在钥匙串里、选手读不到，由看管进程启动前现取；没登录或快过期就不派。
      if (isolationOf(job.who) === 'cursor' && !process.env.XAGENTS_FAKE_WORKER) await checkCursorLogin();
      if (!chat && !shared) {
        await addWorktree(job);
        await setup(job, project.setup, join(jobDir(job.id), 'setup.log'));
      }
      if ((await readJob(job.id)).state !== 'queued') continue;
      const text = workerPrompt(baseText, job.who);
      await writeAtomic(join(jobDir(job.id), 'prompt.md'), text);
      let cli: string | undefined;
      await updateJob(job.id, async current => {
        if (current.state !== 'queued') return;
        const prepared = await prepareRun(current, text, project);
        usePreparedRun(current, prepared);
        cli = prepared.entry;
      });
      if (cli) await start(await readJob(job.id), cli);
    } catch (error) {
      await updateJob(job.id, j => { if (j.state === 'queued') finish(j, 'failed', (error as Error).message); });
    }
    await reconcileSafely();
  }
  return Promise.all(jobs.map(j => readJob(j.id)));
}
