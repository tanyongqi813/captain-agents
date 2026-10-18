import { realpath, readdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { relativeInside, samePath, stillRunning } from './platform.ts';
import { paths, safeName } from './paths.ts';
import { readJson, writeJson, withLock, alive } from './fsx.ts';
import { git } from './worktree.ts';
import type { ProjectCheck } from './project-check.ts';
import type { VerifyStep } from './verify.ts';
import { active, leftBy, listJobs } from './job.ts';
import { listChats } from './chat.ts';
import { writeSettings } from './settings.ts';
import { hasCode } from './fsx.ts';
import { checkBudget, DEFAULT_BUDGET } from './budget.ts';
import type { Budget } from './budget.ts';

// check：最近一次接入体检；baseline：完整体检时在干净副本里跑出的验收底子。
// budget：执行预算（停滞/宽限/单次总上限分钟），缺省 20/5/120；旧登记没有这一字段。
export type Project = { name: string; label?: string; repo: string; worktreeRoot: string; setup: string[]; verify: string[]; denyReadExtra: string[]; rules?: string;
  check?: ProjectCheck; baseline?: { at: string; ok: boolean; steps: VerifyStep[] }; budget?: Budget };
export function relativePath(path: string) {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes('..') || path === '.') throw new Error(`路径必须在仓库内且不能包含 ..：${path}。请填写相对路径。`);
  return path;
}
export async function loadProject(name: string): Promise<Project> {
  const p = await readJson<Pick<Project, 'repo'> & Partial<Project>>(join(paths().projects, `${safeName(name)}.json`));
  return { setup: [], verify: [], denyReadExtra: [], worktreeRoot: '.claude/worktrees', ...p, name };
}
export async function listProjects() {
  return Promise.all((await readdir(paths().projects)).filter(n => n.endsWith('.json')).sort().map(n => loadProject(n.slice(0, -5))));
}
// 这件活实际生效的执行预算：登记里写了就校验着读（不合法抛中文错误，派活前据此拒绝），
// 旧登记没有这一字段按 20/5/120 缺省。预算只能来自这里（项目登记/主人策略），题目、选手报告、环境变量都放宽不了。
export function projectBudget(project: Pick<Project, 'budget'>): Budget {
  return project.budget === undefined ? { ...DEFAULT_BUDGET } : checkBudget(project.budget);
}
// 给主人看的显示名（界面上的字要中文，项目名常是英文代号）：1–20 字，不含控制字符。
export function checkLabel(label: string) {
  const n = [...label.trim()].length;
  if (!n || n > 20 || /[\u0000-\u001f\u007f-\u009f]/u.test(label)) throw new Error('显示名请写 1–20 字，不能含控制字符。');
  return label.trim();
}
// 只改显示名，登记的其他内容（体检结果、验收底子等）原样保留。
export async function setProjectLabel(name: string, label: string) {
  safeName(name); const clean = checkLabel(label);
  return withLock(paths().projects, async () => {
    const file = join(paths().projects, `${name}.json`);
    const current = await readJson<Record<string, unknown>>(file).catch(() => { throw new Error(`没有登记叫 ${name} 的项目，先用 xagents project add 登记。`); });
    await writeJson(file, { ...current, label: clean });
    return clean;
  });
}

// 桌面“设置 → 项目”编辑登记（docs/tasks/TASK-003.md）：只改提交的字段，体检（check）、验收底子（baseline）
// 和将来新增的未知字段原样保留。rules 传 null 表示清除；窗口交不进这个字段，只能由主进程用文件选择器
// 挑好的真实路径经一次性令牌带进来（见 app/main/project-bridge.ts）。
export type ProjectUpdate = { label?: string; worktreeRoot?: string; setup?: string[]; verify?: string[]; denyReadExtra?: string[]; rules?: string | null };
const stringList = (what: string, value: string[]) => {
  if (!Array.isArray(value)) throw new Error(`${what}必须是列表。`);
  for (const item of value) if (typeof item !== 'string' || !item.trim()) throw new Error(`${what}每一项都必须是文字，不能有空项。`);
  return value;
};
export async function updateProject(name: string, patch: ProjectUpdate): Promise<Project> {
  safeName(name);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('修改内容格式不对。');
  // 先在锁外把要写的值全部校验完（rules 要 realpath），锁里只做读-改-写。
  const next: Record<string, unknown> = {};
  if (patch.label !== undefined) next.label = checkLabel(patch.label);
  if (patch.worktreeRoot !== undefined) next.worktreeRoot = relativePath(patch.worktreeRoot);
  if (patch.setup !== undefined) next.setup = stringList('装依赖命令', patch.setup);
  if (patch.verify !== undefined) next.verify = stringList('验收命令', patch.verify);
  if (patch.denyReadExtra !== undefined) next.denyReadExtra = stringList('禁读路径', patch.denyReadExtra).map(relativePath);
  if (patch.rules !== undefined) {
    if (patch.rules === null) next.rules = null;
    else {
      try { next.rules = await realpath(resolve(patch.rules)); }
      catch { throw new Error(`找不到规则文件：${patch.rules}。请确认文件存在。`); }
    }
  }
  return withLock(paths().projects, async () => {
    const file = join(paths().projects, `${name}.json`);
    const current = await readJson<Record<string, unknown>>(file).catch((e) => { if (hasCode(e, 'ENOENT')) throw new Error(`没有登记叫 ${name} 的项目。`); throw e; });
    for (const [key, value] of Object.entries(next)) {
      if (value === null) delete current[key];
      else current[key] = value;
    }
    await writeJson(file, current);
    return { setup: [], verify: [], denyReadExtra: [], worktreeRoot: '.claude/worktrees', ...current, name } as unknown as Project;
  });
}

// 只移除工作台登记：删除 ~/.xagents/projects/<name>.json，不碰仓库、工作副本、任务和历史。
// 排队/运行中的活、残留的准备或选手进程、开放的群聊都拒绝；已结束的活和已关闭的群聊只是历史，不阻止。
// 检查和删除在项目登记锁内重新确认，不能只信界面传来的快照（docs/tasks/TASK-003.md）。
export async function removeProject(name: string) {
  safeName(name);
  return withLock(paths().projects, async () => {
    const file = join(paths().projects, `${name}.json`);
    await readJson(file).catch((e) => { if (hasCode(e, 'ENOENT')) throw new Error(`没有登记叫 ${name} 的项目。`); throw e; });
    const jobs = await listJobs().catch((e) => { if (hasCode(e, 'ENOENT')) return []; throw e; });
    const mine = jobs.filter(job => job.project === name);
    const live = mine.filter(job => active(job));
    if (live.length) throw new Error(`这个项目还有 ${live.length} 件排队或运行中的活（${live.map(j => j.id).join('、')}），先等它们结束或停下，再移除登记。`);
    for (const job of mine) {
      const until = leftBy(job);
      if (stillRunning(job.setupPid, job.setupSince, until)) throw new Error(`任务 ${job.id} 还留着准备进程，先运行 xagents stop ${job.id} 收尾，再移除登记。`);
      if (stillRunning(job.workerPid, job.workerSince, until)) throw new Error(`任务 ${job.id} 还留着选手进程，先运行 xagents stop ${job.id} 收尾，再移除登记。`);
      if (alive(job.pid, job.pidSince) || (!job.started && alive(job.queuedBy, job.queuedSince)))
        throw new Error(`任务 ${job.id} 的派发进程还在，先等它退出，再移除登记。`);
    }
    const open = (await listChats()).filter(chat => chat.project === name && chat.state === 'open');
    if (open.length) throw new Error(`这个项目还有 ${open.length} 个开放的群聊（${open.map(c => c.title || c.id).join('、')}），先关闭群聊，再移除登记。`);
    await rm(file);
    return { name };
  });
}
export async function addProject(name: string, repo: string, options: Partial<Project> & { createOnly?: boolean }) {
  safeName(name);
  const root = await realpath((await git(resolve(repo), ['rev-parse', '--show-toplevel'])).trim());
  const worktreeRoot = relativePath(options.worktreeRoot || '.claude/worktrees');
  for (const path of options.denyReadExtra || []) relativePath(path);
  const p: Project = { name, repo: root, worktreeRoot, setup: options.setup || [], verify: options.verify || [], denyReadExtra: options.denyReadExtra || [] };
  if (options.rules) p.rules = await realpath(resolve(options.rules));
  if (options.label !== undefined) p.label = checkLabel(options.label);
  if (options.budget !== undefined) p.budget = checkBudget(options.budget);
  const file = join(paths().projects, `${name}.json`);
  await withLock(paths().projects, async () => {
    // 桌面登记用 createOnly：同名项目不能被悄悄覆盖（命令行仍保持原来的覆盖行为）。
    if (options.createOnly) {
      const exists = await stat(file).then(() => true).catch(error => { if (hasCode(error, 'ENOENT')) return false; throw error; });
      if (exists) throw new Error(`已经登记过叫 ${name} 的项目，不能覆盖，请换一个名字。`);
    }
    await writeJson(file, p);
  });
  return p;
}
export async function findProject(name?: string, cwd = process.cwd()) {
  if (name) return loadProject(name);
  const root = await realpath((await git(cwd, ['rev-parse', '--show-toplevel'])).trim());
  const common = await realpath((await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
  const matches: Project[] = [];
  for (const p of await listProjects()) {
    try {
      if (samePath(await realpath(p.repo), root)) matches.push(p);
      else {
        const other = await realpath((await git(p.repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
        if (samePath(other, common)) matches.push(p);
      }
    } catch {
      // 已登记的仓库可能已删除或不再是 Git 仓库，不影响其他项目的识别。
      continue;
    }
  }
  if (matches.length !== 1) throw new Error(matches.length ? '同一个仓库登记了多个项目，请用 --project 指定名字。' : '当前仓库还没登记，请先运行 xagents project add <名字> <仓库路径>。');
  return matches[0];
}
export async function worktreePath(project: Project, id: string) {
  relativePath(project.worktreeRoot);
  for (const extra of project.denyReadExtra) relativePath(extra);
  const target = resolve(project.repo, project.worktreeRoot, `xa-${id}`);
  const rel = relativeInside(project.repo, target);
  if (rel === undefined) throw new Error('副本目录必须在仓库内，请修改 --worktree-root。');
  // 对已有父目录做 realpath，拒绝借符号链接把副本开到仓库外。
  let current = project.repo;
  for (const segment of rel.split(sep).slice(0, -1)) {
    current = join(current, segment);
    const resolved = await realpath(current).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return current; throw e; });
    if (relativeInside(project.repo, resolved) === undefined) throw new Error('副本目录通过符号链接指向了仓库外，请修改 --worktree-root。');
  }
  return target;
}

// 归档或取消归档一个项目：什么都不删，只记进设置的 archivedProjects。
// 项目不必登记过，任务里出现过的也行；名单里没有的名字用人话报错。重复归档、重复取消结果一样，不报错。
export async function setArchived(name: string, archived: boolean): Promise<boolean> {
  safeName(name);
  const jobs = await listJobs().catch(error => { if (hasCode(error, 'ENOENT')) return []; throw error; });
  const known = new Set([...(await listProjects()).map(p => p.name), ...jobs.map(job => job.project).filter(Boolean)]);
  if (!known.has(name)) throw new Error(`没有叫 ${name} 的项目。用 xagents project list 看登记过的项目。`);
  // 在设置的锁里读当前名单再改，两个项目同时归档也不会丢。
  await writeSettings(current => ({ archivedProjects: archived ? [...current.archivedProjects, name] : current.archivedProjects.filter(n => n !== name) }));
  return archived;
}
