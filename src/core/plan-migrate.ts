import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { withLock, writeAtomic } from './fsx.ts';
import {
  HANDOFF_CONTRACT, TASK_LIST_HEADERS, TASK_SECTIONS,
  assembleHandoff, contractMetadata, formatDependencies, loadHandoffFiles,
  normalizeAttemptToken, parseTaskList, readHandoffReport, sectionNames, taskHeading,
} from './task-plan.ts';
import type { HandoffDiagnostic, HandoffFiles, HandoffReport, HandoffTask, PlanRow } from './task-plan.ts';

// 规划迁移：默认只预览。写入前先对任务数、编号、标题、状态、依赖、READY、说明路径和当前执行做对账，
// 对不上、或有含糊状态、重复编号、循环依赖、无法识别的前置任务时，一份都不写。
// 解析和诊断只调用 task-plan，这里不另写一套规则。

const REFUSAL = new Set([
  'DUPLICATE_TASK_ID', 'DEPENDENCY_UNPARSEABLE', 'TASK_LIST_DUPLICATE', 'SPEC_MISSING',
  'STATUS_MISMATCH', 'AMBIGUOUS_STATUS', 'UNKNOWN_STATUS', 'DEPENDENCY_CYCLE',
  'SPEC_ID_MISMATCH', 'SPEC_ESCAPE', 'SPEC_TRUNCATED', 'TASK_LIST_ESCAPE', 'TASK_LIST_TRUNCATED',
  'TASK_LIST_ENTRY_MISSING', 'CAPSULE_ESCAPE', 'CAPSULE_TRUNCATED', 'REVIEW_ESCAPE', 'REVIEW_TRUNCATED',
]);
const WRITABLE = /^(?:docs\/TASK_LIST\.md|docs\/tasks\/TASK-\d+\.md|docs\/execution\/TASK-\d+\/attempt-\d+\.md|docs\/reviews\/TASK-\d+\/attempt-\d+\.md)$/;
const PLACEHOLDER = '待确认（旧文档未提供独立字段；迁移器未推断内容）。';

export type PlanSemantic = {
  taskCount: number;
  ids: string[];
  listIds: string[];
  titles: Record<string, string>;
  statuses: Record<string, string>;
  dependencyEdges: string[];
  ready: string[];
  specPaths: Record<string, string>;
  currentAttempts: Record<string, string>;
};
export type PlanMigration = {
  contractVersion: 1;
  mode: 'dry-run' | 'apply';
  reconciliation: { before: PlanSemantic; after: PlanSemantic; semanticEqual: boolean };
  refusals: string[];
  changedPaths: string[];
  diff: string;
  applied: boolean;
  verification?: HandoffReport;
};

const taskSort = (a: string, b: string) => Number(/TASK-(\d+)/.exec(a)?.[1] ?? Number.NaN) - Number(/TASK-(\d+)/.exec(b)?.[1] ?? Number.NaN) || a.localeCompare(b);
const finish = (text: string) => text.replace(/\s+$/u, '') + '\n';

function snapshot(report: HandoffReport, listText: string | null): PlanSemantic {
  const index = new Map<string, PlanRow>();
  for (const row of listText ? parseTaskList(listText) : []) if (!index.has(row.id)) index.set(row.id, row);
  const titles: Record<string, string> = {};
  const statuses: Record<string, string> = {};
  const specPaths: Record<string, string> = {};
  const currentAttempts: Record<string, string> = {};
  const edges: string[] = [];
  for (const task of report.tasks) {
    titles[task.id] = index.get(task.id)?.title ?? task.title;
    statuses[task.id] = task.status;
    specPaths[task.id] = task.specPath;
    currentAttempts[task.id] = task.currentAttempt;
    for (const dep of task.dependencies) edges.push(`${task.id}->${dep.id}[${dep.accepted.join('|')}]`);
  }
  return {
    taskCount: report.tasks.length, ids: report.tasks.map(task => task.id), listIds: [...index.keys()].sort(taskSort),
    titles, statuses, dependencyEdges: edges.sort(), ready: report.ready, specPaths, currentAttempts,
  };
}

function upsertMetadata(text: string, key: string, value: string): string {
  const line = `- ${key}: \`${value}\``;
  const pattern = new RegExp(`^\\s*-\\s*${key}\\s*[:：]\\s*.+$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, line);
  const title = /^#.+$/m.exec(text);
  if (!title || title.index === undefined) return text;
  const position = title.index + title[0].length;
  return text.slice(0, position) + `\n\n${line}\n` + text.slice(position).replace(/^\n/, '');
}

function rewriteSpec(text: string, task: HandoffTask): string {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex(line => line.startsWith('## '));
  const body = lines.slice(first < 0 ? lines.length : first);
  const block = [
    `# ${task.id} — ${task.title}`, '',
    `- handoff_contract: \`${HANDOFF_CONTRACT}\``,
    `- status: \`${task.status}\``,
    `- priority: \`${task.priority}\``,
    `- difficulty: \`${task.difficulty}\``,
    `- dependencies: \`${formatDependencies(task.dependencies)}\``,
    `- current_attempt: \`${task.currentAttempt}\``, '',
  ];
  const present = new Set(sectionNames(text));
  let migrated = finish([...block, ...body].join('\n')).replace(/\n$/, '');
  for (const name of TASK_SECTIONS) if (!present.has(name)) migrated += `\n\n## ${name}\n\n${PLACEHOLDER}`;
  return finish(migrated);
}

function rewriteList(tasks: HandoffTask[], original: string, index: Map<string, PlanRow>): string {
  const rows = [`| ${TASK_LIST_HEADERS.join(' | ')} |`, '|---|---|---|---|---|---|---|'];
  for (const task of tasks) {
    const deps = task.dependencies.map(dep => dep.id).join(', ') || 'none';
    const attempt = !task.currentAttempt || task.currentAttempt === 'none' ? 'none' : `attempt-${task.currentAttempt}`;
    rows.push(`| [${task.id}](tasks/${task.id}.md) | ${index.get(task.id)?.title ?? task.title} | ${task.status} | ${task.priority} | ${task.difficulty} | ${deps} | ${attempt} |`);
  }
  const lines = original.split(/\r?\n/);
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    const pipe = lines[i].trim().startsWith('|');
    if (pipe && start < 0) start = i;
    else if (!pipe && start >= 0) { end = i - 1; break; }
  }
  if (start >= 0 && end < 0) end = lines.length - 1;
  const next = start < 0 ? rows : [...lines.slice(0, start), ...rows, ...lines.slice(end + 1)];
  return finish(next.join('\n'));
}

function rewriteCapsule(rel: string, text: string, tasks: Map<string, HandoffTask>): string {
  const cap = contractMetadata(text);
  const dir = /docs\/execution\/(TASK-\d+)\//.exec(rel)?.[1] ?? '';
  const fileAttempt = /attempt-(\d+)\.md$/.exec(rel)?.[1] ?? '';
  const capTask = cap.task_id || dir;
  const capAttempt = normalizeAttemptToken(cap.attempt || fileAttempt);
  let next = upsertMetadata(text, 'handoff_contract', HANDOFF_CONTRACT);
  if (cap.dispatch_state === undefined) {
    const task = tasks.get(capTask);
    const state = task && task.currentAttempt === capAttempt && task.status === 'READY' ? 'READY'
      : task && task.currentAttempt === capAttempt && (task.status === 'PASSED' || task.status === 'PASSED_WITH_NOTES') ? 'CLOSED'
        : '待确认';
    next = upsertMetadata(next, 'dispatch_state', state);
  }
  return finish(next);
}

function lineDiff(rel: string, before: string, after: string): string {
  if (before === after) return '';
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const out = [`--- a/${rel}`, `+++ b/${rel}`];
  const max = Math.max(oldLines.length, newLines.length);
  let shown = 0;
  for (let i = 0; i < max && shown < 80; i++) {
    if (oldLines[i] === newLines[i]) continue;
    if (i < oldLines.length) { out.push(`-${oldLines[i]}`); shown++; }
    if (i < newLines.length && shown < 80) { out.push(`+${newLines[i]}`); shown++; }
  }
  return `${out.join('\n')}\n`;
}

function blockedPath(diagnostics: HandoffDiagnostic[], rel: string): boolean {
  return diagnostics.some(item => item.path === rel && (item.code.endsWith('TRUNCATED') || item.code.endsWith('ESCAPE')));
}

async function planMigration(repo: string): Promise<PlanMigration & { writes: Record<string, string> }> {
  const loaded = await loadHandoffFiles(repo);
  const beforeReport = assembleHandoff(loaded);
  const tasks = new Map(beforeReport.tasks.map(task => [task.id, task]));
  const index = new Map<string, PlanRow>();
  for (const row of loaded.listText ? parseTaskList(loaded.listText) : []) if (!index.has(row.id)) index.set(row.id, row);
  const writes: Record<string, string> = {};
  const remember = (rel: string, before: string, after: string) => {
    if (!WRITABLE.test(rel) || blockedPath(loaded.diagnostics, rel) || before === after) return;
    writes[rel] = after;
  };
  for (const file of loaded.specs) {
    const task = tasks.get(/TASK-\d+/.exec(file.rel)?.[0] ?? '');
    const headingId = taskHeading(file.text).id;
    if (!task || (headingId !== null && headingId !== task.id)) continue;
    remember(file.rel, file.text, rewriteSpec(file.text, task));
  }
  if (loaded.listText !== null) remember('docs/TASK_LIST.md', loaded.listText, rewriteList(beforeReport.tasks, loaded.listText, index));
  for (const file of loaded.capsules) remember(file.rel, file.text, rewriteCapsule(file.rel, file.text, tasks));
  for (const file of loaded.reviews) remember(file.rel, file.text, finish(upsertMetadata(file.text, 'handoff_contract', HANDOFF_CONTRACT)));
  const replaced = (files: { rel: string; text: string }[]) => files.map(file => ({ rel: file.rel, text: writes[file.rel] ?? file.text }));
  const afterFiles: HandoffFiles = {
    listText: writes['docs/TASK_LIST.md'] ?? loaded.listText, specs: replaced(loaded.specs),
    capsules: replaced(loaded.capsules), reviews: replaced(loaded.reviews), diagnostics: loaded.diagnostics,
  };
  const afterReport = assembleHandoff(afterFiles);
  const before = snapshot(beforeReport, loaded.listText);
  const after = snapshot(afterReport, afterFiles.listText);
  const semanticEqual = JSON.stringify(before) === JSON.stringify(after);
  let git = false;
  try { await stat(join(repo, '.git')); git = true; } catch { git = false; }
  const refusals = new Set<string>();
  if (!git) refusals.add('NOT_GIT：仓库不是 Git 仓库，不能写入迁移。');
  for (const item of beforeReport.diagnostics) if (REFUSAL.has(item.code)) refusals.add(`${item.code}：${item.message}`);
  if (!semanticEqual) refusals.add('SEMANTIC_DRIFT：迁移前后的任务数、编号、标题、状态、依赖、READY、说明路径或当前执行对不上，已拒绝写入。');
  const changedPaths = Object.keys(writes).sort();
  return {
    contractVersion: 1, mode: 'dry-run', reconciliation: { before, after, semanticEqual },
    refusals: [...refusals].sort(), changedPaths, diff: changedPaths.map(rel => lineDiff(rel, sourceText(loaded, rel), writes[rel])).join(''),
    applied: false, writes,
  };
}

function sourceText(files: HandoffFiles, rel: string): string {
  if (rel === 'docs/TASK_LIST.md') return files.listText ?? '';
  return [...files.specs, ...files.capsules, ...files.reviews].find(file => file.rel === rel)?.text ?? '';
}

function published(plan: PlanMigration & { writes: Record<string, string> }, mode: 'dry-run' | 'apply', applied: boolean, verification?: HandoffReport): PlanMigration {
  return {
    contractVersion: 1, mode, reconciliation: plan.reconciliation, refusals: plan.refusals,
    changedPaths: plan.changedPaths, diff: plan.diff, applied, ...(verification ? { verification } : {}),
  };
}

export async function migrateHandoff(repo: string, options: { apply?: boolean } = {}): Promise<PlanMigration> {
  const preview = await planMigration(repo);
  if (!options.apply || preview.refusals.length) return published(preview, options.apply ? 'apply' : 'dry-run', false);
  return withLock(join(repo, 'docs'), async () => {
    const fresh = await planMigration(repo);
    if (fresh.refusals.length) return published(fresh, 'apply', false);
    for (const [rel, content] of Object.entries(fresh.writes)) {
      const file = join(repo, ...rel.split('/'));
      await mkdir(dirname(file), { recursive: true });
      await writeAtomic(file, content);
    }
    return published(fresh, 'apply', true, await readHandoffReport(repo));
  });
}
