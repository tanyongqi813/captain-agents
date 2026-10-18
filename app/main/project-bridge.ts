import { randomBytes } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { safeName } from '../../src/core/paths.ts';
import { hasCode } from '../../src/core/fsx.ts';
import { checkLabel } from '../../src/core/project.ts';
import type { Project, ProjectUpdate } from '../../src/core/project.ts';
import type { ProjectCheck } from '../../src/core/project-check.ts';
import type { ProjectChoice, ProjectRegisterInput, ProjectRegistration } from '../shared/ipc.ts';

// 一次选择的令牌只在后台内存里放 10 分钟；不写盘、不交给窗口，也没有定时器（用到时才清过期的）。
export const PROJECT_SELECTION_TTL_MS = 10 * 60_000;
export const PROJECT_NAME_MAX = 64;
const INVALID_SELECTION = '这次选择已失效，请重新选择文件夹。';
const NOT_GIT = '这个文件夹不是 Git 仓库，请选择 Git 仓库所在的文件夹。';

type Selection = {
  repo: string;
  name: string | null;
  label: string | null;
  sender: number;      // 浏览器窗口的 webContents id：只让当初选择的那个窗口登记
  expires: number;
};

// 令牌库：伪造、过期、别的窗口、重复使用都在这里拒绝。取一次就删，不看窗口交来的任何路径。
export function projectSelections(options: { now?: () => number; ttlMs?: number; randomId?: () => string } = {}) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? PROJECT_SELECTION_TTL_MS;
  const randomId = options.randomId ?? (() => randomBytes(32).toString('hex'));
  const items = new Map<string, Selection>();
  // 没有后台定时器：每次新增时顺手清掉过期的，令牌数量只和这 10 分钟里的选择次数有关。
  const sweep = () => { for (const [id, selection] of items) if (selection.expires <= now()) items.delete(id); };
  return {
    add(input: Omit<Selection, 'expires'>): string {
      sweep();
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = randomId();
        if (typeof id !== 'string' || !id || items.has(id)) continue;
        items.set(id, { ...input, expires: now() + ttlMs });
        return id;
      }
      throw new Error('生成选择令牌失败，请重新选择文件夹。');
    },
    take(id: unknown, sender: number): Selection {
      if (typeof id !== 'string' || !id || id.length > 200) throw new Error(INVALID_SELECTION);
      const selection = items.get(id);
      if (!selection) throw new Error(INVALID_SELECTION);
      if (selection.expires <= now()) { items.delete(id); throw new Error(INVALID_SELECTION); }
      // 别的窗口来试不消费令牌，免得把当前窗口的选择弄没。
      if (selection.sender !== sender) throw new Error(INVALID_SELECTION);
      items.delete(id);
      return selection;
    },
    forget(sender: number) { for (const [id, selection] of items) if (selection.sender === sender) items.delete(id); },
    clear() { items.clear(); },
    get size() { return items.size; },
  };
}
export type ProjectSelections = ReturnType<typeof projectSelections>;

// 仓库文件夹名转成项目标识：只留合法字符（字母、汉字、数字、下划线、连字符），其余折成连字符。
// 生成不了（空、太长）就返回 null，让界面要求主人自己填，不猜一个可能不安全的名字。
export function suggestedProjectName(folder: string): string | null {
  const name = [...folder].map(char => /^[\p{L}\p{N}_-]$/u.test(char) ? char : '-').join('')
    .replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!name || [...name].length > PROJECT_NAME_MAX) return null;
  try { return safeName(name); } catch { return null; }
}
// 显示名缺省用文件夹名，按核心 checkLabel 的规则（1–20 字、不含控制字符）；不合格返回 null。
export function suggestedProjectLabel(folder: string): string | null {
  try { return checkLabel(folder); } catch { return null; }
}

// 白名单只认 name 和可选 label。路径、命令、规则这些字段一律不认，不能因为界面暂时不用就提前暴露能力。
const INPUT_KEYS = ['name', 'label'] as const;

// 登记内容的白名单和运行时校验：形状、类型、名字规则都先在这里挡住。
export function projectInput(value: unknown): ProjectRegisterInput {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('登记内容格式不对。');
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!(INPUT_KEYS as readonly string[]).includes(key)) throw new Error('登记内容里有不认识的字段。');
  if (typeof raw.name !== 'string') throw new Error('请填写项目名字。');
  const name = safeName(raw.name);
  if ([...name].length > PROJECT_NAME_MAX) throw new Error(`项目名字最多 ${PROJECT_NAME_MAX} 个字。`);
  const input: ProjectRegisterInput = { name };
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string') throw new Error('显示名必须是文字。');
    input.label = checkLabel(raw.label);
  }
  return input;
}

type Core = {
  // 只由主进程实现：Electron 原生目录选择器；取消时返回 null（不是错误）。
  chooseFolder(): Promise<string | null>;
  realpath(path: string): Promise<string>;
  git(repo: string, args: string[]): Promise<string>;
  // 登记规则只走核心；createOnly 让桌面登记不覆盖同名项目（命令行照旧）。
  addProject(name: string, repo: string, options: Partial<Project> & { createOnly?: boolean }): Promise<Project>;
  // 快速体检：失败不回滚登记，作为结构化结果交回窗口。
  checkProject(name: string): Promise<ProjectCheck>;
  // 登记完成后发布新 View（看板和群聊的项目名单立刻能看到）。
  updated(): Promise<void>;
  onError?(error: unknown): void;
};

export function projectActions(core: Core, options: { selections?: ProjectSelections } = {}) {
  const selections = options.selections ?? projectSelections();

  const choose = async (args: unknown[], sender: number): Promise<ProjectChoice | null> => {
    if (args.length) throw new Error('选择文件夹不需要参数。');
    const picked = await core.chooseFolder();
    if (picked === null) return null;
    if (typeof picked !== 'string' || !picked) throw new Error('没有拿到选择的文件夹，请重新选择。');
    // 先解析符号链接，再问 Git 顶层目录；窗口和界面都碰不到这一步的路径。
    let selected: string;
    try { selected = await core.realpath(picked); } catch { throw new Error('找不到这个文件夹，请重新选择。'); }
    let top: string;
    try { top = (await core.git(selected, ['rev-parse', '--show-toplevel'])).trim(); }
    catch (error) {
      if (hasCode(error, 'ENOENT')) throw new Error('找不到 git 命令，请先安装 Git。');
      throw new Error(NOT_GIT);
    }
    if (!top || !isAbsolute(top)) throw new Error(NOT_GIT);
    let repo: string;
    try { repo = await core.realpath(top); } catch { throw new Error('找不到这个仓库，请重新选择。'); }
    const folder = basename(repo);
    const name = suggestedProjectName(folder), label = suggestedProjectLabel(folder);
    return { selectionId: selections.add({ repo, name, label, sender }), repo, name, label };
  };

  const register = async (args: unknown[], sender: number): Promise<ProjectRegistration> => {
    if (args.length !== 2) throw new Error('登记项目需要选择令牌和登记内容。');
    // 先校验内容，再消费令牌：填错名字不会白丢这次选择。
    const input = projectInput(args[1]);
    const selection = selections.take(args[0], sender);
    // 只转 createOnly 和可选 label：worktreeRoot、setup、verify、denyReadExtra、rules 由核心用默认配置，
    // 窗口交不进路径、命令或后续要读取的文件。
    const project = await core.addProject(input.name, selection.repo, {
      createOnly: true,
      ...(input.label !== undefined ? { label: input.label } : {}),
    });
    let check: ProjectCheck | null = null, checkError: string | null = null;
    try { check = await core.checkProject(project.name); }
    catch (error) { checkError = error instanceof Error ? error.message : String(error); }
    try { await core.updated(); }
    catch (error) { core.onError?.(error); }
    return { project: { name: project.name, label: project.label ?? project.name, repo: project.repo }, check, checkError };
  };

  return { choose, register, selections };
}

// 规则文件的一次性选择令牌（docs/tasks/TASK-003.md）：窗口交不进任何绝对路径。
// 主进程用系统文件选择器挑好真实文件，只把展示路径和一次性令牌交给窗口；登记修改时凭令牌换回真实路径。
type FileSelection = { path: string; sender: number; expires: number };
export function fileSelections(options: { now?: () => number; ttlMs?: number; randomId?: () => string } = {}) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? PROJECT_SELECTION_TTL_MS;
  const randomId = options.randomId ?? (() => randomBytes(32).toString('hex'));
  const items = new Map<string, FileSelection>();
  const sweep = () => { for (const [id, selection] of items) if (selection.expires <= now()) items.delete(id); };
  return {
    add(path: string, sender: number): string {
      sweep();
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = randomId();
        if (typeof id !== 'string' || !id || items.has(id)) continue;
        items.set(id, { path, sender, expires: now() + ttlMs });
        return id;
      }
      throw new Error('生成选择令牌失败，请重新选择文件。');
    },
    take(id: unknown, sender: number): string {
      if (typeof id !== 'string' || !id || id.length > 200) throw new Error('这次选择已失效，请重新选择文件。');
      const selection = items.get(id);
      if (!selection || selection.expires <= now() || selection.sender !== sender) throw new Error('这次选择已失效，请重新选择文件。');
      items.delete(id);
      return selection.path;
    },
    clear() { items.clear(); },
    get size() { return items.size; },
  };
}
export type FileSelections = ReturnType<typeof fileSelections>;

// 项目管理（docs/tasks/TASK-003.md）：打开仓库、编辑登记、快速/完整体检、移除登记。
// 窗口只交已登记项目名；rules 只能凭文件选择令牌带进来，别的绝对路径一律进不来。
const PATCH_KEYS = ['label', 'worktreeRoot', 'setup', 'verify', 'denyReadExtra', 'rules'] as const;
export function projectPatch(value: unknown): ProjectUpdate {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('修改内容格式不对。');
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!(PATCH_KEYS as readonly string[]).includes(key)) throw new Error('修改内容里有不认识的字段。');
  const patch: ProjectUpdate = {};
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string') throw new Error('显示名必须是文字。');
    patch.label = raw.label;
  }
  if (raw.worktreeRoot !== undefined) {
    if (typeof raw.worktreeRoot !== 'string') throw new Error('副本目录必须是文字。');
    patch.worktreeRoot = raw.worktreeRoot;
  }
  for (const key of ['setup', 'verify', 'denyReadExtra'] as const) {
    if (raw[key] !== undefined) {
      if (!Array.isArray(raw[key])) throw new Error('命令和路径必须是列表。');
      for (const item of raw[key] as unknown[]) if (typeof item !== 'string') throw new Error('列表里每一项都必须是文字。');
      patch[key] = raw[key] as string[];
    }
  }
  if (raw.rules !== undefined) {
    if (raw.rules !== null && typeof raw.rules !== 'string') throw new Error('规则文件必须是文字或空。');
    if (raw.rules === '') throw new Error('规则文件路径不能为空。');
    patch.rules = raw.rules;
  }
  return patch;
}

type ManageCore = {
  // 按项目名解析：仓库路径只来自登记处，窗口交不进任何路径。
  loadProject(name: string): Promise<Project>;
  updateProject(name: string, patch: ProjectUpdate): Promise<Project>;
  removeProject(name: string): Promise<{ name: string }>;
  // 快速/完整体检：核心完成后自己原子写回 check（完整再写 baseline）。
  checkProject(name: string, options: { quick?: boolean }): Promise<ProjectCheck>;
  // Electron shell.openPath：返回空串成功，否则是失败原因。
  openPath(path: string): Promise<string>;
  // 系统文件选择器（规则文件用）；取消返回 null（不是错误）。
  chooseFile(): Promise<string | null>;
  realpath(path: string): Promise<string>;
  isFile(path: string): Promise<boolean>;
  updated(): Promise<void>;
  onError?(error: unknown): void;
};

export function projectManageActions(core: ManageCore, options: { selections?: FileSelections } = {}) {
  const selections = options.selections ?? fileSelections();
  // 内存中的按项目互斥：同一项目快速/完整体检不能重入，不同项目各自运行。不持久化：应用退出后不承诺恢复。
  const checking = new Set<string>();
  const nameArg = (value: unknown) => {
    if (typeof value !== 'string' || !value) throw new Error('需要项目名字。');
    return safeName(value);
  };
  const publish = async () => { try { await core.updated(); } catch (error) { core.onError?.(error); } };

  const chooseRules = async (args: unknown[], sender: number): Promise<{ selectionId: string; path: string } | null> => {
    if (args.length) throw new Error('选择规则文件不需要参数。');
    const picked = await core.chooseFile();
    if (picked === null) return null;
    if (typeof picked !== 'string' || !picked) throw new Error('没有拿到选择的文件，请重新选择。');
    let path: string;
    try { path = await core.realpath(picked); } catch { throw new Error('找不到这个文件，请重新选择。'); }
    if (!await core.isFile(path)) throw new Error('选中的不是文件，请重新选择。');
    return { selectionId: selections.add(path, sender), path };
  };

  const open = async (args: unknown[]) => {
    if (args.length !== 1) throw new Error('打开仓库需要项目名字。');
    const name = nameArg(args[0]);
    const project = await core.loadProject(name).catch((error: unknown) => {
      if (hasCode(error, 'ENOENT')) throw new Error(`没有登记叫 ${name} 的项目。`);
      throw error;
    });
    const failed = await core.openPath(project.repo);
    if (failed) throw new Error(failed);
  };

  const update = async (args: unknown[], sender: number) => {
    if (args.length !== 2) throw new Error('编辑项目需要项目名字和修改内容。');
    const name = nameArg(args[0]);
    const patch = projectPatch(args[1]);
    // rules 凭一次性令牌换回真实路径：窗口交进来的任何别的字符串都过不了令牌这一关。
    if (typeof patch.rules === 'string') patch.rules = selections.take(patch.rules, sender);
    await core.updateProject(name, patch);
    await publish();
  };

  const remove = async (args: unknown[]) => {
    if (args.length !== 1) throw new Error('移除登记需要项目名字。');
    await core.removeProject(nameArg(args[0]));
    await publish();
  };

  const check = async (args: unknown[]) => {
    if (args.length !== 2) throw new Error('体检需要项目名字和类型。');
    const name = nameArg(args[0]);
    const kind = args[1];
    if (kind !== 'quick' && kind !== 'full') throw new Error('体检类型只认快速或完整体检。');
    if (checking.has(name)) throw new Error(`项目 ${name} 正在体检，等这一轮跑完再试。`);
    checking.add(name);
    try { return await core.checkProject(name, { quick: kind === 'quick' }); }
    finally { checking.delete(name); }
  };

  return { chooseRules, open, update, remove, check, selections };
}
