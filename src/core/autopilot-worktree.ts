import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { autopilotDir, dispatchBudget, isEndedState, readAutopilot, updateAutopilot } from './autopilot.ts';
import type { AutopilotRun } from './autopilot.ts';
import { hasCode, writeAtomic } from './fsx.ts';
import { findProject, worktreePath } from './project.ts';
import { samePath } from './platform.ts';
import { addWorktree, diff, git } from './worktree.ts';
import { active, listJobs } from './job.ts';
import { verifyCommands } from './verify.ts';
import { readSettings } from './settings.ts';
import { selection } from './workers.ts';
export type AutopilotRole = 'writer' | 'reviewer';
export const patchHash = (text: string) => createHash('sha256').update(text).digest('hex');
const EMPTY = patchHash('');
const PATCH_LIMIT = 16 * 1024 * 1024;
const patchFile = (run: string, hash: string) => {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('补丁快照编号无效。');
  return join(autopilotDir(run), 'snapshots', `${hash}.patch`);
};
export async function saveAutopilotPatch(run: AutopilotRun, patch: string): Promise<string> {
  if (Buffer.byteLength(patch) > PATCH_LIMIT) throw new Error('候选补丁过大，已保留原副本，请主人接手。');
  const hash = patchHash(patch); await mkdir(join(autopilotDir(run.id), 'snapshots'), { recursive: true });
  await writeAtomic(patchFile(run.id, hash), patch); return hash;
}
export async function readAutopilotPatch(run: AutopilotRun, hash: string): Promise<string> {
  if (hash === EMPTY) return '';
  const file = patchFile(run.id, hash), info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > PATCH_LIMIT) throw new Error('补丁快照不可用。');
  const patch = await readFile(file, 'utf8');
  if (patchHash(patch) !== hash) throw new Error('补丁快照校验失败。');
  return patch;
}
async function location(run: AutopilotRun, role: AutopilotRole) {
  if (!run.flow || !['writer', 'reviewer'].includes(role)) throw new Error('没有自动审查闭环登记。');
  const project = await findProject(run.project);
  if (!samePath(project.repo, run.repo)) throw new Error('项目仓库已变化，不能操作旧执行副本。');
  const worktree = await worktreePath(project, `auto-${run.id}-${role}`), branch = `xa/auto-${run.id}-${role}`;
  if (samePath(worktree, run.repo)) throw new Error('自治副本不能是主工作区。');
  return { project, repo: run.repo, base: run.base, worktree, branch };
}
// 破坏性 Git 操作前调用此处：真实目录、仓库公共目录、登记路径、独占分支、HEAD 起点全部要对上。
export async function assertAutopilotWorktree(run: AutopilotRun, role: AutopilotRole) {
  const target = await location(run, role);
  const { worktree, branch, repo } = target;
  const info = await lstat(worktree);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(worktree), worktree)
    || !samePath((await git(worktree, ['rev-parse', '--show-toplevel'])).trim(), worktree)
    || (await git(worktree, ['symbolic-ref', '--short', 'HEAD'])).trim() !== branch
    || (await git(worktree, ['rev-parse', 'HEAD'])).trim() !== run.base
    || !samePath(await realpath(resolve(worktree, (await git(worktree, ['rev-parse', '--git-common-dir'])).trim())),
      await realpath(resolve(repo, (await git(repo, ['rev-parse', '--git-common-dir'])).trim())))) throw new Error('自治副本与登记不符，未执行回滚或派发。');
  const entries = (await git(repo, ['worktree', 'list', '--porcelain', '-z'])).split('\0');
  if (!entries.some(e => e.startsWith('worktree ') && samePath(e.slice(9), worktree))) throw new Error('自治副本不属于登记仓库。');
  return target;
}
async function noActiveWriter(run: AutopilotRun, worktree: string) {
  if ((await listJobs(true)).some(job => active(job) && (samePath(job.worktree, worktree) || job.autopilot?.run === run.id))) {
    throw new Error('这台执行还有选手在动手，不能重建副本。');
  }
}
export async function prepareAutopilotWorktree(run: AutopilotRun, role: AutopilotRole, hash: string) {
  const started = Date.now();
  const current = await readAutopilot(run.id);
  if (isEndedState(current.state) || dispatchBudget(current)) throw new Error('自治执行已经停止或预算已用完。');
  try {
  const target = await location(run, role);
  const patch = await readAutopilotPatch(run, hash); // 先确认快照，不能先删成果再发现快照坏了。
  await noActiveWriter(run, target.worktree);
  let exists = true;
  try { await lstat(target.worktree); } catch (e) { if (hasCode(e, 'ENOENT')) exists = false; else throw e; }
  if (!exists) await addWorktree(target);
  await assertAutopilotWorktree(run, role);
  // 原始候选另存证据后才能回滚；不清理任何主工作区、其他任务副本或分支。
  const previous = await diff(target);
  if (previous) await saveAutopilotPatch(run, previous);
  await git(target.worktree, ['reset', '--hard', run.base]);
  await git(target.worktree, ['clean', '-fdx', '--']);
  if (patch) {
    const file = patchFile(run.id, hash);
    await git(target.worktree, ['apply', '--check', '--', file]);
    await git(target.worktree, ['apply', '--', file]);
  }
  const left = current.policy.minutes - current.elapsedSeconds / 60 - (Date.now() - started) / 60_000;
  if (left <= 0) throw new Error('执行时长预算已用完。');
  const prepared = await verifyCommands(target.project.setup, target.worktree, join(autopilotDir(run.id), `${role}-setup.log`), Math.min(left, target.project.verifyTimeoutMinutes ?? 20));
  if (!prepared.ok || patchHash(await diff(target)) !== hash) throw new Error('自治副本准备失败或准备命令修改了受审文件，请主人处理。');
  return target;
  } finally {
    await updateAutopilot(run.id, current => { current.elapsedSeconds += Math.max(0, (Date.now() - started) / 1000); });
  }
}
export async function captureAutopilotPatch(run: AutopilotRun, role: AutopilotRole) {
  const target = await assertAutopilotWorktree(run, role);
  const names = (await git(target.worktree, ['diff', '--no-renames', '--name-only', '-z', run.base, '--'])).split('\0').filter(Boolean);
  names.push(...(await git(target.worktree, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean));
  if (names.some(name => /^docs\/(?:TASK_LIST\.md$|tasks\/)/i.test(name.replaceAll('\\', '/')))) throw new Error('自治执行不能修改任务台账或 Task Spec，已保留候选成果。');
  return saveAutopilotPatch(run, await diff(target));
}
// dispatch 内只接受角色，不接受路径。来源令牌、选择、起点与权限必须和当前闭环记录完全一致。
export async function sharedAutopilotWorktree(input: { run: string; token: string }, role: AutopilotRole, who: string[], ro: boolean, project: string, base: string, network: boolean) {
  const run = await readAutopilot(input.run);
  if (!run.flow || run.action?.token !== input.token || !['executing', 'reviewing', 'recovering'].includes(run.state)
    || run.project !== project || run.base !== base || network && !run.network || who.length !== 1
    || role === 'reviewer' && (run.action.phase !== 'review' || !ro || who[0] !== run.flow.reviewer)
    || role === 'writer' && (run.action.phase === 'review' || run.action.phase === 'diagnose' || ro || who[0] !== run.who[0])) throw new Error('自治派发与角色、权限或令牌不符。');
  const target = await assertAutopilotWorktree(run, role);
  const chosen = selection(who[0]);
  if (!chosen) throw new Error('自治选手无效。');
  if ((await readSettings()).archivedProjects.includes(project)) throw new Error('项目已归档。');
  return target;
}
