import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { context } from './helpers.ts';
import { addProject } from '../src/core/project.ts';
import { ensureHome } from '../src/core/paths.ts';
import { CAPSULE_SECTIONS, TASK_SECTIONS, readHandoffReport, readTaskPlan } from '../src/core/task-plan.ts';
import type { TaskPlan } from '../src/core/task-plan.ts';
import { migrateHandoff } from '../src/core/plan-migrate.ts';

async function writeRepo(repo: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(repo, ...rel.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}
async function readRepo(repo: string, rels: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rel of rels) out[rel] = await readFile(join(repo, ...rel.split('/')), 'utf8');
  return out;
}
function legacy(id: string, title: string, status: string, deps: string, extra = ''): string {
  return `# ${id}：${title}\n\n- 状态：\`${status}\`\n- 优先级：\`P1\`\n- 难度等级：\`Medium\`\n- 前置任务：${deps}\n${extra}## 业务结果\n\n办成。\n\n## 验收标准\n\n1. 办成。\n`;
}
function ledger(rows: string[]): string {
  return `# 说明\n\n这段要留下。\n\n| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |\n|---|---|---|---|---|---|\n${rows.map(row => `| ${row} |`).join('\n')}\n\n脚注还在。\n`;
}
function capsule(id: string, attempt: string): string {
  const meta = ['planning_source', `docs/tasks/${id}.md`, 'handoff_contract', '1', 'task_id', id, 'attempt', attempt,
    'revision_reason', 'initial', 'priority', 'P1', 'difficulty', 'Medium', 'required_planning_lookup', 'none',
    'capsule_schema', '2', 'dispatch_state', 'READY'];
  const lines = [`# ${id} 第 ${attempt} 轮`, ''];
  for (let i = 0; i < meta.length; i += 2) lines.push(`- ${meta[i]}: \`${meta[i + 1]}\``);
  return `${lines.join('\n')}\n\n${CAPSULE_SECTIONS.map(name => `## ${name}\n\n已填。`).join('\n\n')}\n`;
}
function viewOf(plan: TaskPlan) {
  return {
    ids: plan.tasks.map(task => task.id), titles: plan.tasks.map(task => task.title),
    statuses: plan.tasks.map(task => task.status), deps: plan.tasks.map(task => task.deps), ready: plan.ready,
  };
}
const happyFiles = {
  'docs/TASK_LIST.md': ledger([
    '[TASK-001](tasks/TASK-001.md) | 底层 | PASSED | P1 | Medium | 无',
    '[TASK-002](tasks/TASK-002.md) | 上层 | READY | P1 | Medium | TASK-001 PASSED',
  ]),
  'docs/tasks/TASK-001.md': legacy('TASK-001', '底层', 'PASSED', '无'),
  'docs/tasks/TASK-002.md': legacy('TASK-002', '上层', 'READY', 'TASK-001 PASSED'),
  'docs/execution/TASK-002/attempt-01.md': capsule('TASK-002', '01'),
};
const happyPaths = Object.keys(happyFiles);

async function repo(t: TestContext, files: Record<string, string>) {
  const c = await context(t);
  await writeRepo(c.repo, files);
  return c;
}

test('迁移默认只预览；写入后任务数、编号、标题、状态、依赖和可执行队列不变，再跑一次也不改', async t => {
  const c = await repo(t, happyFiles);
  const before = viewOf(await readTaskPlan({ name: 'demo', repo: c.repo }));
  const original = await readRepo(c.repo, happyPaths);
  const dry = await migrateHandoff(c.repo);
  assert.equal(dry.mode, 'dry-run');
  assert.equal(dry.applied, false);
  assert.deepEqual(dry.refusals, []);
  assert.equal(dry.reconciliation.semanticEqual, true);
  assert.deepEqual(dry.reconciliation.before.ids, ['TASK-001', 'TASK-002']);
  assert.deepEqual(dry.reconciliation.before.ready, ['TASK-002']);
  assert.equal(dry.reconciliation.before.currentAttempts['TASK-001'], 'none');
  assert.equal(dry.reconciliation.before.currentAttempts['TASK-002'], '01');
  assert.deepEqual(await readRepo(c.repo, happyPaths), original);
  const applied = await migrateHandoff(c.repo, { apply: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.verification?.diagnostics.some(item => item.severity === 'error'), false);
  const afterPlan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.deepEqual(viewOf(afterPlan), before);
  assert.equal(afterPlan.tasks[1].currentAttempt, '01');
  const list = await readFile(join(c.repo, 'docs/TASK_LIST.md'), 'utf8');
  const spec = await readFile(join(c.repo, 'docs/tasks/TASK-002.md'), 'utf8');
  assert.match(list, /这段要留下/);
  assert.match(list, /脚注还在/);
  assert.match(list, /当前执行/);
  assert.match(spec, /handoff_contract: `1`/);
  assert.match(spec, /current_attempt: `01`/);
  for (const name of TASK_SECTIONS) assert.equal(spec.includes(`## ${name}`), true, name);
  const again = await migrateHandoff(c.repo, { apply: true });
  assert.equal(again.applied, true);
  assert.deepEqual(again.changedPaths, []);
  assert.equal(again.reconciliation.semanticEqual, true);
});

test('未知状态、含糊状态、含糊依赖、重复编号、循环依赖和状态不一致都拒绝写入', async t => {
  const cases: { name: string; files: Record<string, string>; code: string }[] = [
    { name: '未知状态', code: 'UNKNOWN_STATUS', files: { 'docs/TASK_LIST.md': ledger(['[TASK-001](tasks/TASK-001.md) | 怪 | WIP | P1 | Medium | 无']), 'docs/tasks/TASK-001.md': legacy('TASK-001', '怪', 'WIP', '无') } },
    { name: '含糊状态', code: 'AMBIGUOUS_STATUS', files: { 'docs/TASK_LIST.md': ledger(['[TASK-001](tasks/TASK-001.md) | 混 | WAITING_REVIEW | P1 | Medium | 无']), 'docs/tasks/TASK-001.md': legacy('TASK-001', '混', 'WAITING_REVIEW', '无') } },
    { name: '含糊依赖', code: 'DEPENDENCY_UNPARSEABLE', files: { 'docs/TASK_LIST.md': ledger(['[TASK-001](tasks/TASK-001.md) | 甲 | PASSED | P1 | Medium | 无', '[TASK-002](tasks/TASK-002.md) | 乙 | READY | P1 | Medium | 无']), 'docs/tasks/TASK-001.md': legacy('TASK-001', '甲', 'PASSED', '无'), 'docs/tasks/TASK-002.md': legacy('TASK-002', '乙', 'READY', 'TASK-001 做完再说') } },
    { name: '重复编号', code: 'TASK_LIST_DUPLICATE', files: { 'docs/TASK_LIST.md': ledger(['[TASK-001](tasks/TASK-001.md) | 甲 | READY | P1 | Medium | 无', '[TASK-001](tasks/TASK-001.md) | 乙 | READY | P1 | Medium | 无']), 'docs/tasks/TASK-001.md': legacy('TASK-001', '甲', 'READY', '无') } },
    { name: '循环依赖', code: 'DEPENDENCY_CYCLE', files: { 'docs/TASK_LIST.md': ledger(['[TASK-001](tasks/TASK-001.md) | 甲 | READY | P1 | Medium | TASK-002 PASSED', '[TASK-002](tasks/TASK-002.md) | 乙 | READY | P1 | Medium | TASK-001 PASSED']), 'docs/tasks/TASK-001.md': legacy('TASK-001', '甲', 'READY', 'TASK-002 PASSED'), 'docs/tasks/TASK-002.md': legacy('TASK-002', '乙', 'READY', 'TASK-001 PASSED') } },
    { name: '状态不一致', code: 'STATUS_MISMATCH', files: { 'docs/TASK_LIST.md': ledger(['[TASK-001](tasks/TASK-001.md) | 甲 | READY | P1 | Medium | 无']), 'docs/tasks/TASK-001.md': legacy('TASK-001', '甲', 'DRAFT', '无') } },
    { name: '非法终态', code: 'DEPENDENCY_UNPARSEABLE', files: { 'docs/TASK_LIST.md': ledger(['[TASK-002](tasks/TASK-002.md) | 乙 | READY | P1 | Medium | TASK-001']), 'docs/tasks/TASK-002.md': legacy('TASK-002', '乙', 'READY', 'TASK-001[READY]') } },
    { name: '空终态', code: 'DEPENDENCY_UNPARSEABLE', files: { 'docs/TASK_LIST.md': ledger(['[TASK-002](tasks/TASK-002.md) | 乙 | READY | P1 | Medium | TASK-001']), 'docs/tasks/TASK-002.md': legacy('TASK-002', '乙', 'READY', 'TASK-001[]') } },
    { name: '重复终态', code: 'DEPENDENCY_UNPARSEABLE', files: { 'docs/TASK_LIST.md': ledger(['[TASK-002](tasks/TASK-002.md) | 乙 | READY | P1 | Medium | TASK-001']), 'docs/tasks/TASK-002.md': legacy('TASK-002', '乙', 'READY', 'TASK-001[PASSED|PASSED]') } },
  ];
  for (const item of cases) {
    const c = await repo(t, item.files);
    const original = await readRepo(c.repo, Object.keys(item.files));
    const result = await migrateHandoff(c.repo, { apply: true });
    assert.equal(result.applied, false, item.name);
    assert.ok(result.refusals.some(reason => reason.startsWith(item.code)), `${item.name}：${result.refusals.join(' | ')}`);
    assert.deepEqual(await readRepo(c.repo, Object.keys(item.files)), original, item.name);
  }
});

test('没有 Git 目录时拒绝写入', async t => {
  const c = await context(t, false);
  const plain = join(c.temp, 'plain');
  await writeRepo(plain, { 'docs/tasks/TASK-001.md': legacy('TASK-001', '甲', 'READY', '无'), 'docs/TASK_LIST.md': ledger(['[TASK-001](tasks/TASK-001.md) | 甲 | READY | P1 | Medium | 无']) });
  const before = await readFile(join(plain, 'docs/tasks/TASK-001.md'), 'utf8');
  const result = await migrateHandoff(plain, { apply: true });
  assert.equal(result.applied, false);
  assert.ok(result.refusals.some(reason => reason.startsWith('NOT_GIT')));
  assert.equal(await readFile(join(plain, 'docs/tasks/TASK-001.md'), 'utf8'), before);
});

test('verify 能发现执行说明和审查记录的交叉引用被改坏', async t => {
  const c = await repo(t, {
    ...happyFiles,
    'docs/reviews/TASK-002/attempt-01.md': '# 审查\n\n- handoff_contract: `1`\n- task_id: `TASK-002`\n- attempt: `01`\n- capsule: `docs/execution/TASK-002/attempt-99.md`\n- verdict: `CHANGES_REQUESTED`\n- next_action: `correction`\n- next_capsule: `docs/execution/TASK-002/attempt-02.md`\n',
  });
  const broken = capsule('TASK-002', '01').replace('- task_id: `TASK-002`', '- task_id: `TASK-009`');
  await writeFile(join(c.repo, 'docs/execution/TASK-002/attempt-01.md'), broken);
  const report = await readHandoffReport(c.repo);
  assert.ok(report.diagnostics.some(item => item.code === 'CAPSULE_CROSS_REFERENCE'));
  assert.ok(report.diagnostics.some(item => item.code === 'REVIEW_CROSS_REFERENCE'));
  assert.equal(report.dispatchable.includes('TASK-002'), false);
});

test('下一轮写明的胶囊路径优先于目录里更晚的文件', async t => {
  const c = await repo(t, {
    'docs/TASK_LIST.md': ledger(['[TASK-003](tasks/TASK-003.md) | 指针 | READY | P1 | Medium | 无']),
    'docs/tasks/TASK-003.md': legacy('TASK-003', '指针', 'READY', '无', '- 下一轮：见 `docs/execution/TASK-003/attempt-02.md`\n'),
    'docs/execution/TASK-003/attempt-01.md': capsule('TASK-003', '01'),
    'docs/execution/TASK-003/attempt-04.md': capsule('TASK-003', '04'),
  });
  const report = await readHandoffReport(c.repo);
  assert.equal(report.tasks[0].currentAttempt, '02');
});

test('已结束的任务不把目录里最后一份胶囊猜成当前执行', async t => {
  const c = await repo(t, {
    'docs/TASK_LIST.md': ledger(['[TASK-001](tasks/TASK-001.md) | 做完 | PASSED | P1 | Medium | 无']),
    'docs/tasks/TASK-001.md': legacy('TASK-001', '做完', 'PASSED', '无'),
    'docs/execution/TASK-001/attempt-03.md': capsule('TASK-001', '03'),
  });
  const report = await readHandoffReport(c.repo);
  assert.equal(report.tasks[0].currentAttempt, 'none');
});

test('命令行 doctor、migrate、verify 走同一份核心结果', async t => {
  const c = await repo(t, happyFiles);
  const previous = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (previous === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = previous; });
  await ensureHome();
  await addProject('demo', await realpath(c.repo), {});
  const doctor = await c.cli(['plan', 'doctor', 'demo']);
  const direct = await readHandoffReport(c.repo);
  assert.equal(doctor.code, 2);
  assert.deepEqual(JSON.parse(doctor.stdout).diagnostics, direct.diagnostics);
  const preview = await c.cli(['plan', 'migrate', 'demo']);
  assert.equal(preview.code, 0);
  const parsed = JSON.parse(preview.stdout);
  assert.equal(parsed.applied, false);
  assert.equal(parsed.reconciliation.semanticEqual, true);
  const verify = await c.cli(['plan', 'verify', 'demo']);
  assert.deepEqual(JSON.parse(verify.stdout).diagnostics, direct.diagnostics);
});
