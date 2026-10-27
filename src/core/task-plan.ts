import { createHash } from 'node:crypto';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { relativeInside } from './platform.ts';
import { hasCode } from './fsx.ts';
import { findProject } from './project.ts';
import { safeName } from './paths.ts';

// 任务规划识别：只读发现已登记项目的 docs/TASK_LIST.md 与 docs/tasks/TASK-数字.md。
// 规划文件一律是不可信纯文本。这里同时认识两套写法，并且只用这一套解析：
// - 共享契约 handoff_contract: 1（英文元数据、七列表、当前执行指针）
// - 现有中文台账（状态 / 前置任务 / 六列表）
// 派发仍只看下面的 ready：READY、spec 齐全、依赖按写明的通过状态满足、没有既有问题。
// 契约诊断（doctor / migrate / verify）走 readHandoffReport，不把缺胶囊算进 ready。
// 上限在实现前写进 test/task-plan.test.ts，超限不报错，截断并给中文诊断。
export const HANDOFF_CONTRACT = '1';
export const MAX_LIST_BYTES = 512 * 1024;   // 任务台账最大体积
export const MAX_SPEC_BYTES = 256 * 1024;   // 单个 Task Spec 最大体积
export const MAX_TASKS = 500;               // 台账最多读取的任务行数
export const MAX_TITLE_CHARS = 200;         // 标题片段上限
export const MAX_GOAL_CHARS = 500;          // 业务结果片段上限
export const MAX_ACCEPTANCE_ITEMS = 20;     // 验收条目数上限
export const MAX_ACCEPTANCE_CHARS = 200;    // 单条验收上限
export const MAX_EXECUTION_FILES = 20;
export const MAX_EXECUTION_ITEMS = 12;
export const MAX_EXECUTION_ITEM_CHARS = 240;

export type ExecutionContract = {
  files: string[];
  fileLimit: number | null;
  anchors: string[];
  verification: string[];
  baseline: string[];
};

// 允许的状态；之外的都算未知状态，诊断且不可派发。PASSED_WITH_NOTES 是认可的等价通过状态。
export const PLAN_STATUSES = ['DRAFT', 'READY', 'IN_PROGRESS', 'CHANGES_REQUESTED', 'PASSED', 'PASSED_WITH_NOTES', 'BLOCKED'] as const;

export type PlanDiagnostic = { level: 'error' | 'warn'; message: string };
export type HandoffDiagnostic = {
  code: string; severity: 'error' | 'warn' | 'info'; taskId: string | null; path: string | null; message: string;
};
export type PlanDependency = { id: string; accepted: string[] };
export type PlanTask = {
  id: string; title: string; status: string; known: boolean;
  deps: PlanDependency[];
  goal: string; acceptance: string[];
  // 旧视图夹具/记录可以没有；真实规划解析始终填入。
  execution?: ExecutionContract;
  // 仓库内相对路径（docs/tasks/TASK-数字.md）；缺失或不合法时是 null。
  spec: string | null;
  // 推荐执行者只是展示元数据：原样保留，不校验是否在 roster，更不得转成 Who。
  suggested: string | null;
  ready: boolean;
  problems: string[];
  // 契约字段。旧夹具可以不带；没有写明时是 null，不从胶囊文件猜测。
  priority?: string | null;
  difficulty?: string | null;
  currentAttempt?: string | null;
  contract?: string | null;
};
export type HandoffTask = {
  id: string; title: string; status: string; priority: string; difficulty: string;
  dependencies: PlanDependency[]; currentAttempt: string; specPath: string;
};
export type HandoffReport = {
  contractVersion: 1;
  tasks: HandoffTask[];
  ready: string[];
  dispatchable: string[];
  diagnostics: HandoffDiagnostic[];
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
// 前三列始终是 ID、标题、状态。优先级、难度、前置任务、当前执行有表头才填。
export type PlanRow = {
  id: string; link: string; title: string; status: string;
  priority: string; difficulty: string; depsText: string; attempt: string;
};
export const TASK_LIST_HEADERS = ['ID', '标题', '状态', '优先级', '难度', '前置任务', '当前执行'] as const;
const HEADER_ALIASES: Record<string, string> = {
  id: 'ID', 任务: 'ID', 任务id: 'ID', 标题: '标题', 名称: '标题',
  状态: '状态', status: '状态', 优先级: '优先级', priority: '优先级',
  难度: '难度', difficulty: '难度', 前置任务: '前置任务', 依赖: '前置任务',
  dependencies: '前置任务', 当前执行: '当前执行', current_attempt: '当前执行',
};
const FIELD_ALIASES: Record<string, string> = {
  handoff_contract: 'handoff_contract', status: 'status', 状态: 'status',
  priority: 'priority', 优先级: 'priority', difficulty: 'difficulty',
  难度: 'difficulty', 难度等级: 'difficulty', dependencies: 'dependencies', 依赖: 'dependencies',
  前置任务: 'dependencies', current_attempt: 'current_attempt', 当前执行: 'current_attempt',
  当前评审: 'current_review', 下一轮: 'next_capsule', 推荐执行者: 'recommended_executor',
};
export const TASK_SECTIONS = ['业务结果', '非目标', '架构设计', '兼容要求', '验收标准', '依赖与排序', '主要接口', '长期约束', '微批边界'] as const;
export const CAPSULE_SECTIONS = ['本轮唯一目标', '本轮验收切片', '已确认事实（禁止重新推导）', 'Active findings', '源码锚点（最多 5 个）', '修改白名单', '明确非目标', '定向验证（最多 5 条）', '禁止验证', '已知基线失败', '单次执行预算', '停止条件', '精简 Implementation Report（固定格式）'] as const;
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export const DIFFICULTIES = ['Low', 'Medium', 'High'] as const;
export const DISPATCH_STATES = ['READY', 'CLAIMED', 'CLOSED'] as const;
const AMBIGUOUS_STATUS = /WAITING_|[；;]|\b[A-Z]\s+(?:READY|DRAFT|BLOCKED)\b/;

export function canonicalHeader(value: string): string {
  const trimmed = value.trim();
  return HEADER_ALIASES[trimmed] ?? HEADER_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
function stripTicks(value: string): string {
  const text = value.trim();
  return text.length >= 2 && text.startsWith('`') && text.endsWith('`') ? text.slice(1, -1).trim() : text;
}
export function normalizeAttemptToken(value: string): string {
  const text = stripTicks(value.trim());
  if (!text) return '';
  if (/^none$/i.test(text)) return 'none';
  const match = /^(?:attempt-)?(\d+)$/.exec(text);
  return match ? match[1] : text;
}
function splitCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|').map(cell => cell.trim());
}
function headerPositions(headers: string[] | null): Record<string, number> {
  const at = (name: string, fallback: number) => headers ? headers.indexOf(name) : fallback;
  return {
    ID: at('ID', 0), 标题: at('标题', 1), 状态: at('状态', 2),
    优先级: at('优先级', -1), 难度: at('难度', -1), 前置任务: at('前置任务', -1), 当前执行: at('当前执行', -1),
  };
}
function cellAt(cells: string[], index: number, fallback = ''): string {
  return index >= 0 && index < cells.length ? cells[index] : fallback;
}

// 解析任务台账的任务表：只认 [TASK-数字](路径) 开头的表格行，其余行（标题、表头、分隔线）跳过。
// 表头用来认优先级、难度、前置任务和当前执行；没有表头时前三列仍是 ID、标题、状态。
export function parseTaskList(text: string): PlanRow[] {
  const headers = taskListHeaders(text);
  const pos = headerPositions(headers);
  const rows: PlanRow[] = [];
  for (const line of text.split('\n')) {
    const cells = splitCells(line);
    if (!cells || cells.length < 3) continue;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(cellAt(cells, pos.ID >= 0 ? pos.ID : 0));
    if (!link) continue;
    const id = link[1].trim();
    if (!/^TASK-\d+$/.test(id)) continue;
    rows.push({
      id, link: link[2].trim(),
      title: cellAt(cells, pos.标题, cells[1] ?? ''),
      status: cellAt(cells, pos.状态, cells[2] ?? ''),
      priority: cellAt(cells, pos.优先级),
      difficulty: cellAt(cells, pos.难度),
      depsText: cellAt(cells, pos.前置任务),
      attempt: normalizeAttemptToken(cellAt(cells, pos.当前执行)),
    });
  }
  return rows;
}
export function taskListHeaders(text: string): string[] | null {
  for (const line of text.split('\n')) {
    const cells = splitCells(line);
    if (!cells) continue;
    if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
    if (cells.some(cell => canonicalHeader(cell) === 'ID') && !cells.some(cell => /\[TASK-\d+\]/.test(cell))) return cells.map(canonicalHeader);
  }
  return null;
}

// 顶部字段。中文名和契约英文名都收成同一套键；同一键出现多次时以后者为准。
export function contractMetadata(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of text.matchAll(/^\s*-\s*([^:：\n]+)\s*[:：]\s*(.+?)\s*$/gm)) {
    const raw = match[1].trim();
    const key = FIELD_ALIASES[raw] ?? FIELD_ALIASES[raw.toLowerCase()] ?? raw;
    result[key] = stripTicks(match[2]);
  }
  return result;
}
export function taskHeading(text: string): { id: string | null; title: string } {
  const match = /^#\s+(TASK-\d+)\s*(?:—|-|：|:)\s*(.+?)\s*$/m.exec(text);
  return match ? { id: match[1], title: match[2].trim() } : { id: null, title: '' };
}
export function sectionNames(text: string): string[] {
  return [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map(match => match[1].trim());
}
export function statusProblem(status: string): 'AMBIGUOUS_STATUS' | 'UNKNOWN_STATUS' | null {
  if ((PLAN_STATUSES as readonly string[]).includes(status)) return null;
  return AMBIGUOUS_STATUS.test(status) ? 'AMBIGUOUS_STATUS' : 'UNKNOWN_STATUS';
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

const cleanItem = (value: string) => clip(value.replace(/^\s*[-*]\s*/, '').replace(/`/g, ''), MAX_EXECUTION_ITEM_CHARS);
const listItems = (text: string, name: string): string[] => section(text, name)
  .filter(line => /^\s*[-*]\s+/.test(line))
  .map(cleanItem).filter(Boolean).slice(0, MAX_EXECUTION_ITEMS);

function executionContract(text: string): ExecutionContract {
  const boundary = section(text, '执行边界');
  const allowed = boundary.find(line => /^\s*[-*]\s*可修改\s*[:：]/.test(line));
  const files = allowed ? [...allowed.matchAll(/`([^`]+)`/g)].map(match => match[1].trim())
    .filter(path => path.length <= 240 && !/^([A-Za-z]:)?[\\/]/.test(path) && !path.split(/[\\/]/).includes('..'))
    .slice(0, MAX_EXECUTION_FILES) : [];
  const limitLine = boundary.find(line => /修改文件上限\s*[:：]/.test(line));
  const rawLimit = limitLine ? Number(/修改文件上限\s*[:：]\s*(\d+)/.exec(limitLine)?.[1]) : NaN;
  const fileLimit = Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= MAX_EXECUTION_FILES ? rawLimit : null;
  const verifyLines = section(text, '执行者验证');
  const verification: string[] = [];
  let fenced = false;
  for (const line of verifyLines) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    const item = line.trim();
    if (fenced && item && [...item].length <= MAX_EXECUTION_ITEM_CHARS && !/[\x00-\x1f\x7f-\x9f]/u.test(item)) verification.push(item);
    if (verification.length >= MAX_EXECUTION_ITEMS) break;
  }
  return { files: [...new Set(files)], fileLimit, anchors: listItems(text, '精确锚点'), verification,
    baseline: listItems(text, '已知基线') };
}

const TERMINAL_STATES = new Set(['PASSED', 'PASSED_WITH_NOTES']);

// 括号里的终态必须逐字是 PASSED 或 PASSED_WITH_NOTES。空项、重复和别的状态直接拒绝，不删、不合并、不改大小写。
function bracketStates(raw: string): string[] {
  const parts = raw.split('|');
  if (parts.some(part => part.length === 0)) throw new Error('前置任务的通过状态不合法：存在空项。');
  const seen = new Set<string>();
  for (const part of parts) {
    if (!TERMINAL_STATES.has(part)) throw new Error(`前置任务的通过状态不合法：${part}`);
    if (seen.has(part)) throw new Error(`前置任务的通过状态重复：${part}`);
    seen.add(part);
  }
  return parts;
}

// 前置任务。契约写法 TASK-001[PASSED|PASSED_WITH_NOTES] 优先。
// 旧中文只在写明了 PASSED、PASSED_WITH_NOTES 或“已通过”时才认；没写通过状态的句子直接拒绝，不猜成 PASSED。
// 单独一个 TASK-数字（没有旁白）仍按 PASSED，这是契约本身的省略，不是散文猜测。
export function parseDependencies(value: string | null): PlanDependency[] {
  if (!value || /^(无|none)$/i.test(value.trim())) return [];
  const text = value.trim();
  if (text.includes('[') || text.includes(']')) {
    const deps: PlanDependency[] = [];
    for (const chunk of text.split(/[,，]/)) {
      const match = /^\s*(TASK-\d+)(?:\[([^\]]*)\])?\s*$/.exec(chunk);
      if (!match) throw new Error(`无法识别前置任务：${text}`);
      deps.push({ id: match[1], accepted: match[2] === undefined ? ['PASSED'] : bracketStates(match[2]) });
    }
    if (!deps.length) throw new Error(`无法识别前置任务：${text}`);
    return deps;
  }
  const ids = [...new Set([...text.matchAll(/TASK-\d+/g)].map(match => match[0]))];
  if (!ids.length) throw new Error(`无法识别前置任务：${text}`);
  const folded = text.toUpperCase();
  const states = new Set([...folded.matchAll(/\b(?:PASSED_WITH_NOTES|PASSED)\b/g)].map(match => match[0]));
  let accepted: string[];
  if (states.has('PASSED') && states.has('PASSED_WITH_NOTES') && /(?:或|\||\/)/.test(text)) accepted = ['PASSED', 'PASSED_WITH_NOTES'];
  else if (states.has('PASSED_WITH_NOTES')) accepted = ['PASSED_WITH_NOTES'];
  else if (states.has('PASSED') || text.includes('已通过')) accepted = ['PASSED'];
  else throw new Error(`前置任务的通过状态不明确：${text}`);
  return ids.map(id => ({ id, accepted }));
}
export function parseDeps(value: string | null): PlanDependency[] {
  try { return parseDependencies(value); }
  catch { return []; }
}

export type ParsedSpec = {
  status: string | null; depsRaw: string | null; deps: PlanDependency[]; depsError: string | null;
  suggested: string | null; goal: string; acceptance: string[]; execution: ExecutionContract;
  priority: string | null; difficulty: string | null; currentAttempt: string | null; contract: string | null;
  nextCapsule: string | null;
};

// 解析 Task Spec 文本：顶部字段 + 业务结果/验收标准两个章节的受限纯文字片段。只做字符串处理。
// 状态认“状态”或 status，前置任务认“前置任务”或 dependencies。depsRaw 用来区分“字段缺失”和“写了但无法识别”。
export function parseTaskSpec(text: string): ParsedSpec {
  const meta = contractMetadata(text);
  const status = meta.status ?? null;
  const depsRaw = meta.dependencies ?? null;
  let deps: PlanDependency[] = [];
  let depsError: string | null = null;
  try { deps = parseDependencies(depsRaw); }
  catch (error) { depsError = error instanceof Error ? error.message : String(error); }
  const attempt = meta.current_attempt === undefined ? null : normalizeAttemptToken(meta.current_attempt);
  const goal = clip(section(text, '业务结果').join(' '), MAX_GOAL_CHARS);
  const acceptance: string[] = [];
  for (const line of section(text, '验收标准')) {
    const item = /^\s*\d+\s*[.、)]\s*(.+?)\s*$/.exec(line);
    if (!item) continue;
    acceptance.push(clip(item[1].replace(/`/g, ''), MAX_ACCEPTANCE_CHARS));
    if (acceptance.length >= MAX_ACCEPTANCE_ITEMS) break;
  }
  return {
    status: status ? status.toUpperCase() : null, depsRaw, deps, depsError,
    suggested: meta.recommended_executor || null, goal, acceptance, execution: executionContract(text),
    priority: meta.priority ?? null, difficulty: meta.difficulty ?? null,
    currentAttempt: attempt === '' ? null : attempt, contract: meta.handoff_contract ?? null,
    nextCapsule: meta.next_capsule ?? null,
  };
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
    let spec: ParsedSpec | null = null;
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
      const emptyDeps = spec.depsRaw !== null && /^(无|none)$/i.test(spec.depsRaw.trim());
      const depsMalformed = spec.depsError !== null || spec.depsRaw === null || (!emptyDeps && spec.deps.length === 0);
      if (depsMalformed) problems.push(`${row.id}：Task Spec 缺少或无法解析“前置任务”字段，无法进入可执行队列。`);
    }
    const status = spec?.status ?? '';
    const known = (PLAN_STATUSES as readonly string[]).includes(status);
    if (spec?.status && !known) problems.push(`${row.id}：未知状态 ${status}，无法进入可执行队列。`);
    tasks.push({ id: row.id, title: clip(row.title, MAX_TITLE_CHARS), status, known,
      deps: spec?.deps ?? [], goal: spec?.goal ?? '', acceptance: spec?.acceptance ?? [], execution: spec?.execution ?? { files: [], fileLimit: null, anchors: [], verification: [], baseline: [] }, spec: specPath, suggested: spec?.suggested ?? null,
      ready: false, problems, priority: spec?.priority ?? null, difficulty: spec?.difficulty ?? null,
      currentAttempt: spec?.currentAttempt ?? (row.attempt || null), contract: spec?.contract ?? null });
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
      // 只有 READY 才把“前置还没通过”当成规划页错误并拦住派发。DRAFT 等状态本来就不能派，正常等待不再报 error。
      else if (task.status === 'READY' && !dep.accepted.includes(target.status)) task.problems.push(`${task.id}：前置任务 ${dep.id} 当前状态是 ${target.status || '未填写'}，尚未通过（需要 ${dep.accepted.join(' 或 ')}）。`);
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

export function formatDependencies(deps: PlanDependency[]): string {
  return deps.map(dep => `${dep.id}[${dep.accepted.join('|')}]`).join(', ') || 'none';
}
function handoffDiagnostic(code: string, message: string, taskId: string | null = null, path: string | null = null, severity: HandoffDiagnostic['severity'] = 'error'): HandoffDiagnostic {
  return { code, severity, taskId, path, message };
}
const byTask = (a: string, b: string) => Number(/TASK-(\d+)/.exec(a)?.[1] ?? Number.NaN) - Number(/TASK-(\d+)/.exec(b)?.[1] ?? Number.NaN) || a.localeCompare(b);
function inferAttempt(taskId: string, spec: ParsedSpec, capsules: { rel: string }[]): string {
  if (spec.currentAttempt) return spec.currentAttempt;
  const pointed = new RegExp(`docs/execution/${taskId}/attempt-(\\d+)\\.md`).exec(spec.nextCapsule ?? '');
  if (pointed) return pointed[1];
  if (spec.status === 'READY' || spec.status === 'IN_PROGRESS' || spec.status === 'CHANGES_REQUESTED') {
    const found = capsules.flatMap(file => {
      const match = new RegExp(`^docs/execution/${taskId}/attempt-(\\d+)\\.md$`).exec(file.rel);
      return match ? [[Number(match[1]), match[1]] as const] : [];
    });
    if (found.length) return found.sort((a, b) => b[0] - a[0])[0][1];
  }
  return 'none';
}

export type HandoffFiles = {
  listText: string | null;
  specs: { rel: string; text: string }[];
  capsules: { rel: string; text: string }[];
  reviews: { rel: string; text: string }[];
  diagnostics?: HandoffDiagnostic[];
};

// 把已经读进来的文本收成一份机器结果。doctor、migrate、verify 都走这里，不再各写一套字段规则。
export function assembleHandoff(files: HandoffFiles): HandoffReport {
  const diagnostics: HandoffDiagnostic[] = [...(files.diagnostics ?? [])];
  const tasks = new Map<string, HandoffTask>();
  const specText = new Map<string, string>();
  if (files.listText === null) diagnostics.push(handoffDiagnostic('TASK_LIST_MISSING', '没有任务台账 docs/TASK_LIST.md。', null, 'docs/TASK_LIST.md'));
  const headers = files.listText === null ? null : taskListHeaders(files.listText);
  if (!headers || headers.join('\0') !== TASK_LIST_HEADERS.join('\0')) {
    diagnostics.push(handoffDiagnostic('TASK_LIST_COLUMNS', '任务台账表头不是约定的七列（ID、标题、状态、优先级、难度、前置任务、当前执行）。', null, 'docs/TASK_LIST.md'));
  }
  const rows = files.listText === null ? [] : parseTaskList(files.listText);
  const index = new Map<string, PlanRow>();
  for (const row of rows) {
    if (index.has(row.id)) {
      diagnostics.push(handoffDiagnostic('TASK_LIST_DUPLICATE', '任务台账里有重复的任务编号。', row.id, 'docs/TASK_LIST.md'));
      continue;
    }
    index.set(row.id, row);
    if (row.link.replace(/\\/g, '/') !== `tasks/${row.id}.md`) {
      diagnostics.push(handoffDiagnostic('TASK_LIST_LINK', `编号格必须是 [TASK-数字](tasks/TASK-数字.md)，现在是 ${row.link}。`, row.id, 'docs/TASK_LIST.md'));
    }
    const listed = row.status.trim().toUpperCase();
    const code = statusProblem(listed);
    if (code) diagnostics.push(handoffDiagnostic(code, code === 'AMBIGUOUS_STATUS' ? `任务台账状态含糊，不能猜：${row.status}。` : `任务台账状态无法识别：${row.status || '未填写'}。`, row.id, 'docs/TASK_LIST.md'));
  }
  for (const file of files.specs) {
    const fileId = /TASK-\d+/.exec(file.rel)?.[0] ?? '';
    const heading = taskHeading(file.text);
    if (!fileId) {
      diagnostics.push(handoffDiagnostic('SPEC_ID_MISSING', '任务说明文件名里没有任务编号。', null, file.rel));
      continue;
    }
    if (heading.id && heading.id !== fileId) {
      diagnostics.push(handoffDiagnostic('SPEC_ID_MISMATCH', `标题里的编号是 ${heading.id}，文件名是 ${fileId}，两种编号对不上，不能改名。`, fileId, file.rel));
    }
    if (tasks.has(fileId)) {
      diagnostics.push(handoffDiagnostic('DUPLICATE_TASK_ID', '同一个任务编号有多份任务说明。', fileId, file.rel));
      continue;
    }
    const parsed = parseTaskSpec(file.text);
    if (parsed.depsError) diagnostics.push(handoffDiagnostic('DEPENDENCY_UNPARSEABLE', parsed.depsError, fileId, file.rel));
    const status = parsed.status ?? '';
    tasks.set(fileId, {
      id: fileId, title: heading.title || fileId, status, priority: parsed.priority ?? '', difficulty: parsed.difficulty ?? '',
      dependencies: parsed.deps, currentAttempt: inferAttempt(fileId, parsed, files.capsules), specPath: file.rel,
    });
    specText.set(fileId, file.text);
  }
  const cycle = [...cyclicTasks([...tasks.keys()], id => tasks.get(id)!.dependencies.map(dep => dep.id))].sort(byTask);
  if (cycle.length) diagnostics.push(handoffDiagnostic('DEPENDENCY_CYCLE', `循环依赖：${cycle.join(' → ')}。`, null, null));
  const dispatchable: string[] = [];
  for (const task of [...tasks.values()].sort((a, b) => byTask(a.id, b.id))) {
    const text = specText.get(task.id) ?? '';
    const meta = contractMetadata(text);
    if (meta.handoff_contract !== HANDOFF_CONTRACT) diagnostics.push(handoffDiagnostic('CONTRACT_VERSION', '任务说明的 handoff_contract 必须是 1。', task.id, task.specPath));
    const missing = TASK_SECTIONS.filter(name => !sectionNames(text).includes(name));
    if (missing.length) diagnostics.push(handoffDiagnostic('TASK_SECTIONS', `任务说明缺少章节：${missing.join('、')}。`, task.id, task.specPath));
    const code = statusProblem(task.status);
    if (code) diagnostics.push(handoffDiagnostic(code, code === 'AMBIGUOUS_STATUS' ? `任务状态含糊，不能猜：${task.status || '未填写'}。` : `任务状态无法识别：${task.status || '未填写'}。`, task.id, task.specPath));
    if (!(PRIORITIES as readonly string[]).includes(task.priority)) diagnostics.push(handoffDiagnostic('PRIORITY', `优先级无法识别：${task.priority || '未填写'}。`, task.id, task.specPath));
    if (!(DIFFICULTIES as readonly string[]).includes(task.difficulty)) diagnostics.push(handoffDiagnostic('DIFFICULTY', `难度无法识别：${task.difficulty || '未填写'}。`, task.id, task.specPath));
    const row = index.get(task.id);
    if (!row) diagnostics.push(handoffDiagnostic('TASK_LIST_ENTRY_MISSING', '任务说明没有出现在任务台账里。', task.id, 'docs/TASK_LIST.md'));
    else if (row.status.trim().toUpperCase() !== task.status) diagnostics.push(handoffDiagnostic('STATUS_MISMATCH', `任务台账状态（${row.status || '未填写'}）和任务说明（${task.status || '未填写'}）不一致。`, task.id, task.specPath));
    else if (headers?.includes('优先级') && headers.includes('难度') && (row.priority !== task.priority || row.difficulty !== task.difficulty)) {
      diagnostics.push(handoffDiagnostic('INDEX_FACT_MISMATCH', '任务台账里的优先级或难度和任务说明不一致。', task.id, task.specPath));
    } else if (headers?.includes('当前执行') && row.attempt !== task.currentAttempt) {
      diagnostics.push(handoffDiagnostic('ATTEMPT_MISMATCH', `任务台账的当前执行（${row.attempt || '未填写'}）和任务说明（${task.currentAttempt}）不一致。`, task.id, task.specPath));
    }
    for (const dep of task.dependencies) {
      const target = tasks.get(dep.id);
      if (!target) diagnostics.push(handoffDiagnostic('DEPENDENCY_MISSING', `前置任务不存在：${dep.id}。`, task.id, task.specPath));
      else if (!dep.accepted.includes(target.status)) diagnostics.push(handoffDiagnostic('DEPENDENCY_UNSATISFIED', `${dep.id} 现在是 ${target.status || '未填写'}，还没到 ${dep.accepted.join('|')}。`, task.id, task.specPath, 'info'));
    }
    if (task.status !== 'READY') continue;
    if (!task.currentAttempt || task.currentAttempt === 'none') {
      diagnostics.push(handoffDiagnostic('READY_ATTEMPT_MISSING', 'READY 的任务没有当前执行指针。', task.id, task.specPath));
      continue;
    }
    const capsuleRel = `docs/execution/${task.id}/attempt-${task.currentAttempt}.md`;
    const capsule = files.capsules.find(file => file.rel === capsuleRel);
    if (!capsule) {
      diagnostics.push(handoffDiagnostic('READY_CAPSULE_MISSING', 'READY 的任务找不到当前这一轮执行说明。', task.id, capsuleRel));
      continue;
    }
    const cap = contractMetadata(capsule.text);
    const expect: Record<string, string> = {
      handoff_contract: HANDOFF_CONTRACT, capsule_schema: '2', dispatch_state: 'READY',
      task_id: task.id, attempt: task.currentAttempt, planning_source: task.specPath,
    };
    const bad = Object.entries(expect).filter(([key, value]) => cap[key] !== value).map(([key]) => key);
    if (bad.length) {
      diagnostics.push(handoffDiagnostic('CAPSULE_CROSS_REFERENCE', `执行说明和任务对不上：${bad.join('、')}。`, task.id, capsuleRel));
      continue;
    }
    const missingCapsule = CAPSULE_SECTIONS.filter(name => !sectionNames(capsule.text).includes(name));
    if (missingCapsule.length) {
      diagnostics.push(handoffDiagnostic('CAPSULE_SECTIONS', `执行说明缺少章节：${missingCapsule.join('、')}。`, task.id, capsuleRel));
      continue;
    }
    for (const key of ['revision_reason', 'priority', 'difficulty', 'required_planning_lookup']) {
      if (!cap[key]) diagnostics.push(handoffDiagnostic('CAPSULE_METADATA', `执行说明缺少 ${key}。`, task.id, capsuleRel));
    }
    const depsOk = task.dependencies.every(dep => tasks.get(dep.id)?.status !== undefined && dep.accepted.includes(tasks.get(dep.id)!.status));
    const taskErrors = diagnostics.some(item => item.taskId === task.id && item.severity === 'error');
    if (depsOk && !taskErrors) dispatchable.push(task.id);
  }
  for (const id of [...index.keys()].filter(id => !tasks.has(id)).sort(byTask)) {
    diagnostics.push(handoffDiagnostic('SPEC_MISSING', '任务台账有这一行，但没有对应的任务说明。', id, 'docs/TASK_LIST.md'));
  }
  for (const review of files.reviews) {
    const meta = contractMetadata(review.text);
    if (meta.handoff_contract !== HANDOFF_CONTRACT) diagnostics.push(handoffDiagnostic('REVIEW_CONTRACT', '审查记录的 handoff_contract 必须是 1。', meta.task_id ?? null, review.rel));
    const reviewTask = meta.task_id ?? '';
    const reviewAttempt = meta.attempt ?? '';
    const expectedCapsule = `docs/execution/${reviewTask}/attempt-${reviewAttempt}.md`;
    const expectedReview = `docs/reviews/${reviewTask}/attempt-${reviewAttempt}.md`;
    if (review.rel !== expectedReview) diagnostics.push(handoffDiagnostic('REVIEW_PATH', '审查记录的路径和里面写的任务、轮次不一致。', reviewTask || null, review.rel));
    if (meta.capsule !== expectedCapsule || !files.capsules.some(file => file.rel === expectedCapsule)) {
      diagnostics.push(handoffDiagnostic('REVIEW_CROSS_REFERENCE', '审查记录指向的执行说明不存在，或路径不一致。', reviewTask || null, review.rel));
    }
    const capsule = files.capsules.find(file => file.rel === expectedCapsule);
    if ((meta.verdict === 'PASSED' || meta.verdict === 'PASSED_WITH_NOTES') && capsule && contractMetadata(capsule.text).dispatch_state !== 'CLOSED') {
      diagnostics.push(handoffDiagnostic('PASSED_CAPSULE_OPEN', '审查已经通过，对应的执行说明却还没标成 CLOSED。', reviewTask || null, expectedCapsule));
    }
    if (meta.verdict === 'CHANGES_REQUESTED') {
      const action = meta.next_action;
      const expectedReason = action === 'correction' ? 'changes_requested' : action === 'checkpoint_resume' ? 'checkpoint_resume' : null;
      const nextAttempt = /^\d+$/.test(reviewAttempt) ? String(Number(reviewAttempt) + 1).padStart(2, '0') : '';
      const expectedNext = `docs/execution/${reviewTask}/attempt-${nextAttempt}.md`;
      const next = files.capsules.find(file => file.rel === expectedNext);
      if (!expectedReason || meta.next_capsule !== expectedNext || !next) {
        diagnostics.push(handoffDiagnostic('REVIEW_NEXT_CAPSULE', '退回修改时，下一轮执行说明没有按顺序接上。', reviewTask || null, review.rel));
      } else if (contractMetadata(next.text).revision_reason !== expectedReason) {
        diagnostics.push(handoffDiagnostic('REVIEW_NEXT_ACTION', '审查记录的下一步和下一轮执行说明的修订原因不一致。', reviewTask || null, expectedNext));
      }
    }
  }
  const errorTasks = new Set(diagnostics.filter(item => item.severity === 'error').map(item => item.taskId));
  const ordered = [...tasks.values()].sort((a, b) => byTask(a.id, b.id));
  diagnostics.sort((a, b) => `${a.taskId ?? ''}\0${a.code}\0${a.path ?? ''}`.localeCompare(`${b.taskId ?? ''}\0${b.code}\0${b.path ?? ''}`, 'zh-CN'));
  return {
    contractVersion: 1,
    tasks: ordered,
    ready: ordered.filter(task => task.status === 'READY').map(task => task.id),
    dispatchable: errorTasks.has(null) ? [] : dispatchable.filter(id => !errorTasks.has(id)).sort(byTask),
    diagnostics,
  };
}

async function readInside(repo: string, rel: string, maxBytes: number): Promise<{ text: string; truncated: boolean } | 'missing' | 'escape' | 'notfile'> {
  const resolved = await realpath(join(repo, ...rel.split('/'))).catch((error: NodeJS.ErrnoException) => {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return null;
    throw error;
  });
  if (resolved === null) return 'missing';
  if (relativeInside(repo, resolved) === undefined) return 'escape';
  if (!(await stat(resolved)).isFile()) return 'notfile';
  return readCapped(resolved, maxBytes);
}
async function attemptFiles(repo: string, kind: 'execution' | 'reviews', diagnostics: HandoffDiagnostic[]): Promise<{ rel: string; text: string }[]> {
  const root = join(repo, 'docs', kind);
  const dirs = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return [] as string[];
    throw error;
  });
  const files: { rel: string; text: string }[] = [];
  for (const dir of dirs.filter(name => /^TASK-\d+$/.test(name)).sort(byTask)) {
    const names = await readdir(join(root, dir)).catch((error: NodeJS.ErrnoException) => {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return [] as string[];
      throw error;
    });
    for (const name of names.filter(item => /^attempt-\d+\.md$/.test(item)).sort()) {
      const rel = `docs/${kind}/${dir}/${name}`;
      const read = await readInside(repo, rel, MAX_SPEC_BYTES);
      if (read === 'escape') diagnostics.push(handoffDiagnostic(kind === 'execution' ? 'CAPSULE_ESCAPE' : 'REVIEW_ESCAPE', '文件通过符号链接指向了仓库外，已拒绝读取。', dir, rel));
      else if (typeof read === 'object') {
        if (read.truncated) diagnostics.push(handoffDiagnostic(kind === 'execution' ? 'CAPSULE_TRUNCATED' : 'REVIEW_TRUNCATED', '文件超过读取上限，已截断。', dir, rel));
        files.push({ rel, text: read.text });
      }
    }
  }
  return files;
}

// 从仓库读出规划文件并给出契约 1 的机器结果。不写文件。
export async function loadHandoffFiles(repoInput: string): Promise<HandoffFiles & { diagnostics: HandoffDiagnostic[] }> {
  const repo = await realpath(repoInput);
  const diagnostics: HandoffDiagnostic[] = [];
  const list = await readInside(repo, 'docs/TASK_LIST.md', MAX_LIST_BYTES);
  let listText: string | null = null;
  if (list === 'missing') listText = null;
  else if (list === 'escape') diagnostics.push(handoffDiagnostic('TASK_LIST_ESCAPE', '任务台账通过符号链接指向了仓库外，已拒绝读取。', null, 'docs/TASK_LIST.md'));
  else if (list === 'notfile') diagnostics.push(handoffDiagnostic('TASK_LIST_MISSING', '任务台账不是普通文件。', null, 'docs/TASK_LIST.md'));
  else {
    listText = list.text;
    if (list.truncated) diagnostics.push(handoffDiagnostic('TASK_LIST_TRUNCATED', '任务台账超过读取上限，已截断。', null, 'docs/TASK_LIST.md'));
  }
  const specDir = join(repo, 'docs', 'tasks');
  const specNames = await readdir(specDir).catch((error: NodeJS.ErrnoException) => {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return [] as string[];
    throw error;
  });
  const specs: { rel: string; text: string }[] = [];
  for (const name of specNames.filter(item => /^TASK-\d+\.md$/.test(item)).sort(byTask)) {
    const rel = `docs/tasks/${name}`;
    const read = await readInside(repo, rel, MAX_SPEC_BYTES);
    if (read === 'escape') diagnostics.push(handoffDiagnostic('SPEC_ESCAPE', '任务说明通过符号链接指向了仓库外，已拒绝读取。', name.replace(/\.md$/, ''), rel));
    else if (read === 'notfile') diagnostics.push(handoffDiagnostic('SPEC_MISSING', '任务说明不是普通文件。', name.replace(/\.md$/, ''), rel));
    else if (typeof read === 'object') {
      if (read.truncated) diagnostics.push(handoffDiagnostic('SPEC_TRUNCATED', '任务说明超过读取上限，已截断，不能据此迁移。', name.replace(/\.md$/, ''), rel));
      specs.push({ rel, text: read.text });
    }
  }
  return { listText, specs, capsules: await attemptFiles(repo, 'execution', diagnostics), reviews: await attemptFiles(repo, 'reviews', diagnostics), diagnostics };
}
export async function readHandoffReport(repo: string): Promise<HandoffReport> {
  const files = await loadHandoffFiles(repo);
  return assembleHandoff(files);
}

// 起点一致性按这个指纹比：只把换行统一成 \n，其余一字不动，正文有任何差别指纹就不同。
export function capsuleFingerprint(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');
}
export type DispatchCapsule = { taskId: string; attempt: string; rel: string; text: string; fingerprint: string; anchors: string[] };

export const MAX_ANCHOR_FILES = 5;
const ANCHOR_SECTION = '源码锚点（最多 5 个）';
// 锚点项写成 `仓库相对路径` 开头才算；路径只认有扩展名的普通相对文件路径。
const ANCHOR_FILES = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*\.[A-Za-z0-9]{1,8}$/;

// 源码锚点只从当前 Capsule 的“源码锚点”章节取：别的章节、Task Spec、聊天记录和自然语言描述都不算。
// 绝对路径、..、反斜杠、空路径、超过 5 项、读不出明确路径的都当场抛错拒绝派发，不降级成警告、不猜替代文件。
export function sourceAnchors(text: string): string[] {
  const items = section(text, ANCHOR_SECTION).map(line => line.trim()).filter(Boolean);
  const found: string[] = [];
  for (const line of items) {
    const item = line.replace(/^(?:\d+[.、)]|[-*])\s*/, '');
    const spans = [...item.matchAll(/`([^`]+)`/g)].map(match => match[1].trim()).filter(Boolean);
    if (!spans.length) throw new Error(`源码锚点要写成 \`仓库相对路径\` 的列表项：${clip(line, 80)}`);
    // 一项里只认一个像文件路径的行内代码段：多一个就没法确定改哪个文件，宁可不派。
    const files = spans.filter(path => ANCHOR_FILES.test(path) && !path.includes('\\') && !path.split('/').includes('..'));
    if (!files.length) throw new Error(`源码锚点不是安全的仓库相对文件路径：${clip(spans.join('、'), 120)}`);
    if (files.length > 1) throw new Error(`一项源码锚点只能写一个文件路径，现在有：${files.join('、')}`);
    if (!found.includes(files[0])) found.push(files[0]);
  }
  if (!found.length) throw new Error('执行说明没有列出源码锚点。');
  if (items.length > MAX_ANCHOR_FILES) throw new Error(`源码锚点最多 ${MAX_ANCHOR_FILES} 个，现在列了 ${items.length} 个。`);
  return found;
}

// 派发正文的唯一来源：校验通过的当前 Execution Capsule 原文。
// 资格（可派发集合）、路径与元数据交叉引用、章节齐全、读取边界都由 assembleHandoff 判定，
// 这里只把结论和原文取出来；任何一条不满足都在这里拒绝，不降级成警告。
export async function readDispatchCapsule(repo: string, taskId: string): Promise<DispatchCapsule> {
  const files = await loadHandoffFiles(repo);
  const report = assembleHandoff(files);
  const task = report.tasks.find(item => item.id === taskId);
  if (!task) throw new Error(`任务台账里没有 ${taskId}，请刷新规划后再试。`);
  if (!report.dispatchable.includes(taskId)) {
    const problems = report.diagnostics.filter(item => item.taskId === taskId && item.severity === 'error').map(item => item.message);
    throw new Error(`任务 ${taskId} 现在不能派发：${problems.join('；') || '只有校验通过的当前执行说明才能派发。'}`);
  }
  const rel = `docs/execution/${taskId}/attempt-${task.currentAttempt}.md`;
  const capsule = files.capsules.find(file => file.rel === rel);
  if (!capsule) throw new Error(`任务 ${taskId} 找不到当前这一轮执行说明（${rel}）。`);
  let anchors: string[];
  try {
    anchors = sourceAnchors(capsule.text);
  } catch (error) {
    throw new Error(`任务 ${taskId} 现在不能派发：${(error as Error).message}`);
  }
  return { taskId, attempt: task.currentAttempt, rel, text: capsule.text, fingerprint: capsuleFingerprint(capsule.text), anchors };
}
