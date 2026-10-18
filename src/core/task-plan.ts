import { open, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { relativeInside } from './platform.ts';
import { hasCode } from './fsx.ts';
import { findProject } from './project.ts';
import { safeName } from './paths.ts';

// 任务规划识别（docs/tasks/TASK-005.md）：只读发现已登记项目的 docs/TASK_LIST.md 与
// docs/tasks/TASK-数字.md，输出带校验的任务规划视图。规划文件一律是不可信纯文本，
// 这里只做受限的契约解析（任务表 + spec 顶部字段 + 两个章节片段），不执行其中任何内容。
// 上限在实现前写进 test/task-plan.test.ts，超限不报错，截断并给中文诊断。
export const MAX_LIST_BYTES = 512 * 1024;   // 任务台账最大体积
export const MAX_SPEC_BYTES = 256 * 1024;   // 单个 Task Spec 最大体积
export const MAX_TASKS = 500;               // 台账最多读取的任务行数
export const MAX_TITLE_CHARS = 200;         // 标题片段上限
export const MAX_GOAL_CHARS = 500;          // 业务结果片段上限
export const MAX_ACCEPTANCE_ITEMS = 20;     // 验收条目数上限
export const MAX_ACCEPTANCE_CHARS = 200;    // 单条验收上限

// 允许的状态；之外的都算未知状态，诊断且不可派发。PASSED_WITH_NOTES 是认可的等价通过状态。
export const PLAN_STATUSES = ['DRAFT', 'READY', 'IN_PROGRESS', 'CHANGES_REQUESTED', 'PASSED', 'PASSED_WITH_NOTES', 'BLOCKED'] as const;
// 前置任务里被认可为“通过”的状态（spec 写“或”连接的多个等价通过状态）。
const PASS_STATES = ['PASSED', 'PASSED_WITH_NOTES'] as const;

export type PlanDiagnostic = { level: 'error' | 'warn'; message: string };
export type PlanTask = {
  id: string; title: string; status: string; known: boolean;
  deps: { id: string; accepted: string[] }[];
  goal: string; acceptance: string[];
  // 仓库内相对路径（docs/tasks/TASK-数字.md）；缺失或不合法时是 null。
  spec: string | null;
  // 推荐执行者只是展示元数据：原样保留，不校验是否在 roster，更不得转成 Who。
  suggested: string | null;
  ready: boolean;
  problems: string[];
};
export type TaskPlan = {
  // false = 仓库里没有 docs/TASK_LIST.md，旧项目无行为变化。
  present: boolean;
  project: string;
  tasks: PlanTask[];
  // 可执行队列：READY、spec 齐全、无问题、所有前置任务按各自认可状态通过。
  ready: string[];
  diagnostics: PlanDiagnostic[];
};

// 任务台账里的一个任务行（纯解析结果，不访问文件系统）。
export type PlanRow = { id: string; link: string; title: string; status: string };

// 解析任务台账的任务表：只认 [TASK-数字](路径) 开头的表格行，其余行（标题、表头、分隔线）跳过。
export function parseTaskList(text: string): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed.slice(1, -1).split('|').map(cell => cell.trim());
    if (cells.length < 3) continue;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(cells[0]);
    if (!link) continue;
    const id = link[1].trim();
    if (!/^TASK-\d+$/.test(id)) continue;
    rows.push({ id, link: link[2].trim(), title: cells[1], status: cells[2] });
  }
  return rows;
}

// spec 顶部字段：- 状态：`READY` / - 前置任务：无 / - 推荐执行者：某某（冒号全半角均可，值去反引号）。
function fieldValue(text: string, name: string): string | null {
  const match = new RegExp(`^\\s*-\\s*${name}\\s*[:：]\\s*(.+?)\\s*$`, 'm').exec(text);
  return match ? match[1].replace(/`/g, '').trim() : null;
}

// 压成一段纯文字并按字截断（多行内容先折成一行，超长的尾巴丢掉）。
export function clip(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.slice(0, max).join('');
}

// 取一个 ## 章节里的纯文字片段：跳过 Markdown 记号，业务结果压成一段，验收按编号条目分行。
function section(text: string, name: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex(line => new RegExp(`^##\\s+${name}\\s*$`).test(line.trim()));
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line.trim())) break;
    body.push(line);
  }
  return body;
}

// 解析 spec 的前置任务字段：找出每个 TASK-数字，它后面（到下一个任务或行尾）出现的通过状态都认可；
// 没写通过状态时按 PASSED 要求。
export function parseDeps(value: string | null): { id: string; accepted: string[] }[] {
  if (!value || /^(无|none)$/i.test(value.trim())) return [];
  const deps: { id: string; accepted: string[] }[] = [];
  const found = [...value.matchAll(/TASK-(\d+)/g)];
  for (let i = 0; i < found.length; i++) {
    const until = i + 1 < found.length ? found[i + 1].index! : value.length;
    const rest = value.slice(found[i].index! + found[i][0].length, until);
    const accepted = PASS_STATES.filter(state => rest.includes(state));
    deps.push({ id: `TASK-${found[i][1]}`, accepted: accepted.length ? accepted : ['PASSED'] });
  }
  return deps;
}

// 解析 Task Spec 文本：顶部字段 + 业务结果/验收标准两个章节的受限纯文字片段。只做字符串处理。
// depsRaw 保留“前置任务”字段原文：调用方用它区分“字段缺失”和“字段存在但没有可识别的 TASK-数字”（都算畸形）。
export function parseTaskSpec(text: string): { status: string | null; depsRaw: string | null; deps: { id: string; accepted: string[] }[]; suggested: string | null; goal: string; acceptance: string[] } {
  const status = fieldValue(text, '状态');
  const depsRaw = fieldValue(text, '前置任务');
  const suggested = fieldValue(text, '推荐执行者');
  const goal = clip(section(text, '业务结果').join(' '), MAX_GOAL_CHARS);
  const acceptance: string[] = [];
  for (const line of section(text, '验收标准')) {
    const item = /^\s*\d+\s*[.、)]\s*(.+?)\s*$/.exec(line);
    if (!item) continue;
    acceptance.push(clip(item[1].replace(/`/g, ''), MAX_ACCEPTANCE_CHARS));
    if (acceptance.length >= MAX_ACCEPTANCE_ITEMS) break;
  }
  return { status: status ? status.toUpperCase() : null, depsRaw, deps: parseDeps(depsRaw), suggested: suggested || null, goal, acceptance };
}

// spec 链接契约：只接受仓库内 docs/tasks/TASK-数字.md（反斜杠先按 posix 语义规范化）。
// 返回 null 表示合法，否则是一句中文拒绝理由。
export function specLinkProblem(link: string): string | null {
  const norm = link.replace(/\\/g, '/');
  if (/^([A-Za-z]:)?\//.test(norm)) return '使用了绝对路径';
  if (norm.split('/').includes('..')) return '路径包含 ..';
  if (!/^tasks\/TASK-\d+\.md$/.test(norm)) return '必须是 docs/tasks/ 下的 TASK-数字.md';
  return null;
}

// 按上限读取文本文件，超限截断（调用方据 truncated 给诊断）。
async function readCapped(file: string, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return { text: buffer.toString('utf8'), truncated: size > maxBytes };
  } finally { await handle.close(); }
}

// 找循环依赖：返回处在环上的任务 ID。
function cyclicTasks(ids: string[], depsOf: (id: string) => string[]): Set<string> {
  const color = new Map<string, 1 | 2>(), cyclic = new Set<string>(), stack: string[] = [];
  const visit = (id: string) => {
    if (cyclic.has(id)) return;
    color.set(id, 1); stack.push(id);
    for (const dep of depsOf(id)) {
      if (!ids.includes(dep)) continue;
      if (color.get(dep) === 1) for (const node of stack.slice(stack.indexOf(dep))) cyclic.add(node);
      else if (color.get(dep) !== 2) visit(dep);
    }
    stack.pop(); color.set(id, 2);
  };
  for (const id of ids) if (!color.has(id)) visit(id);
  return cyclic;
}

// 只读识别一个已登记项目的任务规划。任何单项目损坏都只反映在这个项目的诊断里，不向外抛。
export async function readTaskPlan(project: { name: string; repo: string }): Promise<TaskPlan> {
  const diagnostics: PlanDiagnostic[] = [];
  const repo = await realpath(project.repo);
  const entry = join(repo, 'docs', 'TASK_LIST.md');
  // 台账入口自身也不许借符号链接逃出仓库。
  const entryReal = await realpath(entry).catch((error: NodeJS.ErrnoException) => {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return null;
    throw error;
  });
  if (entryReal === null) return { present: false, project: project.name, tasks: [], ready: [], diagnostics };
  if (relativeInside(repo, entryReal) === undefined) {
    diagnostics.push({ level: 'error', message: '任务台账通过符号链接指向了仓库外，已忽略整个规划。' });
    return { present: true, project: project.name, tasks: [], ready: [], diagnostics };
  }
  if (!(await stat(entryReal)).isFile()) {
    diagnostics.push({ level: 'error', message: '任务台账不是普通文件，已忽略整个规划。' });
    return { present: true, project: project.name, tasks: [], ready: [], diagnostics };
  }
  const list = await readCapped(entryReal, MAX_LIST_BYTES);
  if (list.truncated) diagnostics.push({ level: 'warn', message: `任务台账超过 ${MAX_LIST_BYTES / 1024} KB，已按上限截断读取。` });
  const rows = parseTaskList(list.text);
  if (!rows.length) {
    diagnostics.push({ level: 'error', message: '任务台账里没有可识别的任务表（缺少 [ID](路径) 行）。' });
    return { present: true, project: project.name, tasks: [], ready: [], diagnostics };
  }
  if (rows.length > MAX_TASKS) diagnostics.push({ level: 'warn', message: `任务数量超过 ${MAX_TASKS} 个，超出部分不再读取。` });

  const tasks: PlanTask[] = [];
  for (const row of rows.slice(0, MAX_TASKS)) {
    const problems: string[] = [];
    const linkProblem = specLinkProblem(row.link);
    let specPath: string | null = null;
    let spec: { status: string | null; depsRaw: string | null; deps: { id: string; accepted: string[] }[]; suggested: string | null; goal: string; acceptance: string[] } | null = null;
    if (linkProblem) problems.push(`${row.id}：Task Spec 路径不合法（${row.link}）：${linkProblem}。`);
    else {
      // 链接相对 docs/ 解析（契约：docs/tasks/TASK-数字.md）。
      const norm = row.link.replace(/\\/g, '/');
      // 行 ID 必须和链接文件名的 TASK-数字 严格一致，否则会把别的任务的状态、依赖读到这一行名下。
      const fileId = /(?:^|\/)TASK-(\d+)\.md$/.exec(norm)?.[1];
      if (fileId === undefined || fileId !== row.id.slice('TASK-'.length)) {
        problems.push(`${row.id}：台账行 ID 与 Task Spec 文件（${row.link}）不一致，无法进入可执行队列。`);
      } else {
        const full = join(repo, 'docs', ...norm.split('/'));
        // realpath 之后必须仍在仓库内，否则是越界符号链接。
        const resolved = await realpath(full).catch((error: NodeJS.ErrnoException) => {
          if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return null;
          throw error;
        });
        if (resolved === null) problems.push(`${row.id}：缺少 Task Spec（${row.link}），无法确认状态与依赖。`);
        else if (relativeInside(repo, resolved) === undefined) problems.push(`${row.id}：Task Spec 通过符号链接指向了仓库外，已拒绝读取（${row.link}）。`);
        else if (!(await stat(resolved)).isFile()) problems.push(`${row.id}：缺少 Task Spec（${row.link}），无法确认状态与依赖。`);
        else {
          specPath = `docs/${norm}`;
          const text = await readCapped(resolved, MAX_SPEC_BYTES);
          if (text.truncated) diagnostics.push({ level: 'warn', message: `${row.id} 的 Task Spec 超过 ${MAX_SPEC_BYTES / 1024} KB，已按上限截断读取。` });
          spec = parseTaskSpec(text.text);
          // 状态以 Task Spec 为准；台账表里的状态不一致时提醒，不阻塞。
          if (spec.status && row.status && spec.status !== row.status.trim().toUpperCase()) {
            diagnostics.push({ level: 'warn', message: `${row.id}：台账状态（${row.status}）与 Task Spec 状态（${spec.status}）不一致，以 Task Spec 为准。` });
          }
        }
      }
    }
    // Task Spec 是状态与依赖的权威来源：字段缺失或畸形只给诊断并禁止派发，
    // 绝不回退到台账状态，也不把缺失的前置任务字段当成“无依赖”放行。
    if (spec) {
      if (!spec.status) problems.push(`${row.id}：Task Spec 缺少或无法解析“状态”字段，无法进入可执行队列。`);
      const depsMalformed = spec.depsRaw === null || (!/^(无|none)$/i.test(spec.depsRaw.trim()) && spec.deps.length === 0);
      if (depsMalformed) problems.push(`${row.id}：Task Spec 缺少或无法解析“前置任务”字段，无法进入可执行队列。`);
    }
    const status = spec?.status ?? '';
    const known = (PLAN_STATUSES as readonly string[]).includes(status);
    if (spec?.status && !known) problems.push(`${row.id}：未知状态 ${status}，无法进入可执行队列。`);
    tasks.push({ id: row.id, title: clip(row.title, MAX_TITLE_CHARS), status, known,
      deps: spec?.deps ?? [], goal: spec?.goal ?? '', acceptance: spec?.acceptance ?? [], spec: specPath, suggested: spec?.suggested ?? null,
      ready: false, problems });
  }

  // 重复 ID：全部标问题，一个都不可派发。
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.id, (counts.get(task.id) ?? 0) + 1);
  for (const task of tasks) if (counts.get(task.id)! > 1) task.problems.push(`${task.id}：任务台账中重复出现，无法进入可执行队列。`);

  // 依赖与循环：依赖状态取被依赖任务自己的（spec 优先于台账表）。
  const byId = new Map(tasks.map(task => [task.id, task]));
  const cyclic = cyclicTasks([...byId.keys()], id => byId.get(id)!.deps.map(dep => dep.id));
  for (const id of cyclic) byId.get(id)!.problems.push(`${id}：循环依赖，无法进入可执行队列。`);
  for (const task of tasks) {
    for (const dep of task.deps) {
      const target = byId.get(dep.id);
      if (!target) task.problems.push(`${task.id}：未知前置任务 ${dep.id}，不在任务台账中。`);
      else if (!dep.accepted.includes(target.status)) task.problems.push(`${task.id}：前置任务 ${dep.id} 当前状态是 ${target.status || '未填写'}，尚未通过（需要 ${dep.accepted.join(' 或 ')}）。`);
    }
  }
  for (const task of tasks) task.ready = task.known && task.spec !== null && task.status === 'READY' && !task.problems.length;
  for (const task of tasks) for (const problem of task.problems) diagnostics.push({ level: 'error', message: problem });
  return { present: true, project: project.name, tasks, ready: tasks.filter(task => task.ready).map(task => task.id), diagnostics };
}

// 打开 Task Spec 的受控解析（docs/tasks/TASK-006.md，界面规范第 19 节）：主进程只按“已登记项目名 + 仓库内 spec
// 相对路径”还原出要打开的文件。窗口交来的字符串一律当不可信输入，依次过四道：
// 1) 相对路径必须是 docs/tasks/TASK-数字.md（复用 TASK-005 的 specLinkProblem，绝对路径、`..` 一律不认）；
// 2) 项目名必须来自登记处（不认窗口自己编的名字，也不收任何仓库路径）；
// 3) 现阶段规划里必须真有这份 spec（即 TASK-005 解析并确认过它是仓库内的普通文件），否则拒绝；
// 4) 落到仓库里再 realpath 一次，仍须在仓库内、且是普通文件（防换掉链接绕过）。
// 只有全部通过才返回绝对路径给主进程打开；任何一步不合规都抛中文原因，绝不把任意路径递出去。
export async function resolveTaskSpec(projectName: unknown, rel: unknown): Promise<string> {
  if (typeof projectName !== 'string' || !projectName) throw new Error('项目标识无效。');
  if (typeof rel !== 'string' || !rel || [...rel].length > 200) throw new Error('Task Spec 路径无效。');
  const norm = rel.replace(/\\/g, '/');
  const link = norm.startsWith('docs/') ? norm.slice('docs/'.length) : null;
  const problem = link === null ? '必须写成 docs/tasks/TASK-数字.md' : specLinkProblem(link);
  if (problem) throw new Error(`Task Spec 路径不合法（${problem}），只能打开仓库里的 docs/tasks/TASK-数字.md。`);
  const project = await findProject(safeName(projectName));
  const plan = await readTaskPlan({ name: project.name, repo: project.repo });
  if (!plan.present) throw new Error(`项目 ${project.name} 没有任务规划（缺少 docs/TASK_LIST.md）。`);
  if (!plan.tasks.some(task => task.spec === norm)) throw new Error(`任务规划里没有 ${norm} 这份 Task Spec，请刷新规划后再试。`);
  const repo = await realpath(project.repo);
  const file = await realpath(join(repo, ...norm.split('/'))).catch((error: NodeJS.ErrnoException) => {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) throw new Error(`找不到 Task Spec（${norm}）。`);
    throw error;
  });
  if (relativeInside(repo, file) === undefined) throw new Error(`Task Spec（${norm}）指向了仓库外，已拒绝打开。`);
  if (!(await stat(file)).isFile()) throw new Error(`Task Spec（${norm}）不是普通文件，已拒绝打开。`);
  return file;
}
