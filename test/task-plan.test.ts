import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { context, exec } from './helpers.ts';
import { MAX_ACCEPTANCE_ITEMS, MAX_LIST_BYTES, MAX_TASKS, parseTaskSpec, readTaskPlan, resolveTaskSpec } from '../src/core/task-plan.ts';
import { addProject } from '../src/core/project.ts';
import { ensureHome } from '../src/core/paths.ts';
import { buildView } from '../src/core/view.ts';

// 任务规划识别（docs/tasks/TASK-005.md）：只读、路径边界、状态/依赖校验、单项目损坏隔离。

// 在临时仓库里铺一批文件（key 是仓库内相对路径，用 / 分隔）。
async function repoWith(t: TestContext, files: Record<string, string>) {
  const c = await context(t);
  for (const [rel, content] of Object.entries(files)) {
    const target = join(c.repo, ...rel.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return c;
}

// 造一份合法的 Task Spec 文本；字段可覆盖，omit 可整体删掉某个头部字段。
function specText(fields: { status?: string; deps?: string; suggested?: string; goal?: string; acceptance?: string[]; omit?: Array<'status' | 'deps'> } = {}): string {
  const lines = [
    '# TASK-000：样例',
    '',
  ];
  if (!fields.omit?.includes('status')) lines.push(`- 状态：\`${fields.status ?? 'READY'}\``);
  lines.push('- 优先级：`P1`', '- 难度等级：`Medium`');
  if (!fields.omit?.includes('deps')) lines.push(`- 前置任务：${fields.deps ?? '无'}`);
  if (fields.suggested) lines.push(`- 推荐执行者：${fields.suggested}`);
  lines.push('', '## 业务结果', '', fields.goal ?? '把事办成。', '', '## 验收标准', '',
    ...(fields.acceptance ?? ['第一条验收通过。', '第二条验收通过。']).map((item, i) => `${i + 1}. ${item}`), '');
  return lines.join('\n');
}

function listTable(rows: string[][]): string {
  return ['# 功能任务清单', '', '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |', '|---|---|---|---|---|---|',
    ...rows.map(cells => `| ${cells.join(' | ')} |`), ''].join('\n');
}

const row = (id: string, title: string, status: string, deps = '无') => [`[${id}](tasks/${id}.md)`, title, status, 'P1', 'Medium', deps];

test('没有 docs/TASK_LIST.md：present 为 false，无诊断，旧项目行为不变', async t => {
  const c = await repoWith(t, { 'README.md': '普通仓库' });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.present, false);
  assert.deepEqual(plan.tasks, []);
  assert.deepEqual(plan.ready, []);
  assert.deepEqual(plan.diagnostics, []);
});

test('Task Spec 只提取有界执行胶囊：相对路径、锚点、命令与已知基线', () => {
  const spec = parseTaskSpec(`${specText()}\n## 精确锚点\n\n- \`src/a.ts\` 的 \`run\`\n\n## 执行边界\n\n- 可修改：\`src/a.ts\`、\`test/a.test.ts\`、\`../escape\`、\`/absolute\`\n- 修改文件上限：2\n\n## 执行者验证\n\n\`\`\`bash\nnpm run typecheck\nnode --test test/a.test.ts\n\`\`\`\n\n## 已知基线\n\n- quota 的 PTY 用例不排查\n`);
  assert.deepEqual(spec.execution, {
    files: ['src/a.ts', 'test/a.test.ts'], fileLimit: 2,
    anchors: ['src/a.ts 的 run'],
    verification: ['npm run typecheck', 'node --test test/a.test.ts'],
    baseline: ['quota 的 PTY 用例不排查'],
  });
});

test('合法台账与 specs：稳定输出任务、依赖、状态、目标、验收与 ready 队列', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([
      row('TASK-001', '第一个任务', 'PASSED'),
      row('TASK-002', '第二个任务', 'READY', 'TASK-001 PASSED'),
      row('TASK-003', '未就绪任务', 'DRAFT'),
    ]),
    'docs/tasks/TASK-001.md': specText({ status: 'PASSED', suggested: 'Codex' }),
    'docs/tasks/TASK-002.md': specText({ deps: 'TASK-001 PASSED', goal: '让依赖通过的任务也能跑起来。' }),
    'docs/tasks/TASK-003.md': specText({ status: 'DRAFT', acceptance: ['只有一条。'] }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.present, true);
  assert.equal(plan.tasks.length, 3);
  const [one, two, three] = plan.tasks;
  assert.equal(one.id, 'TASK-001');
  assert.equal(one.title, '第一个任务');
  assert.equal(one.status, 'PASSED');
  assert.equal(one.known, true);
  assert.equal(one.goal, '把事办成。');
  assert.deepEqual(one.acceptance, ['第一条验收通过。', '第二条验收通过。']);
  assert.equal(one.spec, 'docs/tasks/TASK-001.md');
  assert.equal(one.suggested, 'Codex');
  assert.deepEqual(one.problems, []);
  assert.equal(one.ready, false); // PASSED 是已通过，不是可执行
  assert.deepEqual(two.deps, [{ id: 'TASK-001', accepted: ['PASSED'] }]);
  assert.equal(two.goal, '让依赖通过的任务也能跑起来。');
  assert.equal(two.ready, true);
  assert.equal(three.ready, false); // DRAFT 不是 READY
  assert.deepEqual(plan.ready, ['TASK-002']);
  assert.deepEqual(plan.diagnostics, []);
});

test('READY 但前置任务未通过：不进 ready，并说明原因', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '底层', 'IN_PROGRESS'), row('TASK-002', '上层', 'READY', 'TASK-001 PASSED')]),
    'docs/tasks/TASK-001.md': specText({ status: 'IN_PROGRESS' }),
    'docs/tasks/TASK-002.md': specText({ deps: 'TASK-001 PASSED' }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.deepEqual(plan.ready, []);
  const upper = plan.tasks.find(task => task.id === 'TASK-002')!;
  assert.match(upper.problems.join('\n'), /前置任务 TASK-001 当前状态是 IN_PROGRESS/);
  assert.match(plan.diagnostics.map(d => d.message).join('\n'), /尚未通过/);
});

test('spec 明确接受的等价通过状态（PASSED 或 PASSED_WITH_NOTES）也算通过', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '底层', 'PASSED_WITH_NOTES'), row('TASK-002', '上层', 'READY', 'TASK-001 PASSED 或 PASSED_WITH_NOTES')]),
    'docs/tasks/TASK-001.md': specText({ status: 'PASSED_WITH_NOTES' }),
    'docs/tasks/TASK-002.md': specText({ deps: 'TASK-001 PASSED 或 PASSED_WITH_NOTES' }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  // TASK-001 已通过（PASSED_WITH_NOTES），不是 READY，本身不可执行；它的通过状态放行 TASK-002。
  assert.deepEqual(plan.ready, ['TASK-002']);
});

test('未知状态：诊断、known 为 false、不可派发', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '怪任务', 'WIP')]),
    'docs/tasks/TASK-001.md': specText({ status: 'WIP' }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  const task = plan.tasks[0];
  assert.equal(task.known, false);
  assert.equal(task.ready, false);
  assert.match(task.problems.join('\n'), /未知状态 WIP/);
  assert.ok(plan.diagnostics.some(d => d.level === 'error' && /未知状态 WIP/.test(d.message)));
});

test('台账表状态与 spec 不一致：以 spec 为准并给 warn', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '任务', 'READY')]),
    'docs/tasks/TASK-001.md': specText({ status: 'DRAFT' }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.tasks[0].status, 'DRAFT');
  assert.equal(plan.tasks[0].ready, false);
  assert.ok(plan.diagnostics.some(d => d.level === 'warn' && /不一致，以 Task Spec 为准/.test(d.message)));
});

test('重复 ID：两个都标问题，不可派发', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '甲', 'READY'), row('TASK-001', '乙', 'READY')]),
    'docs/tasks/TASK-001.md': specText(),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.tasks.length, 2);
  for (const task of plan.tasks) {
    assert.equal(task.ready, false);
    assert.match(task.problems.join('\n'), /重复出现/);
  }
  assert.deepEqual(plan.ready, []);
});

test('缺失 spec：标问题、不可派发；spec 字段为 null', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '没有 spec', 'READY'), row('TASK-002', '正常', 'READY')]),
    'docs/tasks/TASK-002.md': specText(),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  const missing = plan.tasks.find(task => task.id === 'TASK-001')!;
  assert.equal(missing.spec, null);
  assert.equal(missing.ready, false);
  assert.match(missing.problems.join('\n'), /缺少 Task Spec/);
  assert.deepEqual(plan.ready, ['TASK-002']);
});

test('未知依赖：诊断、不可派发', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-002', '悬空依赖', 'READY', 'TASK-999 PASSED')]),
    'docs/tasks/TASK-002.md': specText({ deps: 'TASK-999 PASSED' }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.tasks[0].ready, false);
  assert.match(plan.tasks[0].problems.join('\n'), /未知前置任务 TASK-999/);
});

test('循环依赖：双方都标问题，不可派发', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '甲', 'READY', 'TASK-002 PASSED'), row('TASK-002', '乙', 'READY', 'TASK-001 PASSED')]),
    'docs/tasks/TASK-001.md': specText({ deps: 'TASK-002 PASSED' }),
    'docs/tasks/TASK-002.md': specText({ deps: 'TASK-001 PASSED' }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.deepEqual(plan.ready, []);
  for (const task of plan.tasks) assert.match(task.problems.join('\n'), /循环依赖/);
});

test('spec 缺少“状态”字段：诊断并禁止派发，不回退台账状态', async t => {
  const c = await repoWith(t, {
    // 台账表写 READY：以前会回退成 READY 直接放行，现在必须拦住。
    'docs/TASK_LIST.md': listTable([row('TASK-001', '没写状态', 'READY')]),
    'docs/tasks/TASK-001.md': specText({ omit: ['status'] }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  const task = plan.tasks[0];
  assert.equal(task.ready, false);
  assert.equal(task.status, '');
  assert.equal(task.known, false);
  assert.match(task.problems.join('\n'), /缺少或无法解析“状态”字段/);
  assert.deepEqual(plan.ready, []);
});

test('spec 缺少“前置任务”字段：诊断并禁止派发，不当成无依赖', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '没写依赖', 'READY')]),
    'docs/tasks/TASK-001.md': specText({ omit: ['deps'] }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  const task = plan.tasks[0];
  assert.equal(task.ready, false);
  assert.deepEqual(task.deps, []);
  assert.match(task.problems.join('\n'), /缺少或无法解析“前置任务”字段/);
  assert.deepEqual(plan.ready, []);
});

test('spec“前置任务”字段畸形（没有 TASK-数字）：诊断并禁止派发', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '乱写依赖', 'READY')]),
    'docs/tasks/TASK-001.md': specText({ deps: '先把基础做完' }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  const task = plan.tasks[0];
  assert.equal(task.ready, false);
  assert.deepEqual(task.deps, []);
  assert.match(task.problems.join('\n'), /缺少或无法解析“前置任务”字段/);
  assert.deepEqual(plan.ready, []);
});

test('台账行 ID 与 spec 文件 ID 不一致：诊断并禁止派发，不把别人的状态读到自己名下', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': ['# 清单', '', '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |', '|---|---|---|---|---|---|',
      `| [TASK-001](tasks/TASK-002.md) | 张冠李戴 | READY | P1 | Medium | 无 |`, ''].join('\n'),
    // 文件本身 PASSED：若被 TASK-001 绑定会被当成已通过；真正合法的 READY 身份应属于 TASK-002。
    'docs/tasks/TASK-002.md': specText({ status: 'PASSED' }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  const task = plan.tasks[0];
  assert.equal(task.id, 'TASK-001');
  assert.equal(task.ready, false);
  assert.equal(task.spec, null);
  assert.equal(task.status, '');
  assert.match(task.problems.join('\n'), /台账行 ID 与 Task Spec 文件（tasks\/TASK-002\.md）不一致/);
  assert.deepEqual(plan.ready, []);
});

test('PASSED_WITH_NOTES 是合法状态：不产生错误诊断，也能作为依赖的等价通过状态', async t => {
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '带备注通过', 'PASSED_WITH_NOTES'), row('TASK-002', '后续', 'READY', 'TASK-001 PASSED 或 PASSED_WITH_NOTES')]),
    'docs/tasks/TASK-001.md': specText({ status: 'PASSED_WITH_NOTES' }),
    'docs/tasks/TASK-002.md': specText({ deps: 'TASK-001 PASSED 或 PASSED_WITH_NOTES' }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  const first = plan.tasks.find(task => task.id === 'TASK-001')!;
  assert.equal(first.known, true);
  assert.deepEqual(first.problems, []);
  assert.equal(first.ready, false); // 已通过，不是 READY
  assert.deepEqual(plan.ready, ['TASK-002']);
  // 整个规划没有任何错误级诊断（PASSED_WITH_NOTES 不再被报“未知状态”）。
  assert.deepEqual(plan.diagnostics.filter(d => d.level === 'error'), []);
});

test('路径穿越与绝对路径：拒绝读取并给诊断', async t => {
  const c = await context(t);
  await mkdir(join(c.repo, 'docs', 'tasks'), { recursive: true });
  await writeFile(join(c.repo, 'docs', 'escape.md'), specText());
  const table = ['# 清单', '', '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |', '|---|---|---|---|---|---|',
    `| [TASK-001](../escape.md) | 穿越 | READY | P1 | Medium | 无 |`,
    `| [TASK-002](/etc/passwd) | 绝对 | READY | P1 | Medium | 无 |`,
    `| [TASK-003](C:\\\\Windows\\\\x.md) | 盘符 | READY | P1 | Medium | 无 |`,
    ''].join('\n');
  await writeFile(join(c.repo, 'docs', 'TASK_LIST.md'), table);
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.tasks.length, 3);
  assert.match(plan.tasks[0].problems.join('\n'), /路径包含 \.\./);
  assert.match(plan.tasks[1].problems.join('\n'), /绝对路径/);
  assert.match(plan.tasks[2].problems.join('\n'), /绝对路径/);
  assert.deepEqual(plan.ready, []);
});

test('指向仓库外的符号链接：拒绝读取并给诊断', { skip: process.platform === 'win32' ? '只属于 macOS：Windows 上创建符号链接需要开发模式或提权，流水线上建不了' : false }, async t => {
  const c = await context(t);
  const outsideDir = join(c.temp, 'elsewhere');
  await mkdir(outsideDir, { recursive: true });
  await writeFile(join(outsideDir, 'TASK-001.md'), specText());
  await mkdir(join(c.repo, 'docs', 'tasks'), { recursive: true });
  await symlink(join(outsideDir, 'TASK-001.md'), join(c.repo, 'docs', 'tasks', 'TASK-001.md'));
  await writeFile(join(c.repo, 'docs', 'TASK_LIST.md'), listTable([row('TASK-001', '借道', 'READY')]));
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.tasks[0].ready, false);
  assert.match(plan.tasks[0].problems.join('\n'), /符号链接指向了仓库外/);
  assert.deepEqual(plan.ready, []);
});

test('台账入口本身指向仓库外：整个规划忽略并给诊断', { skip: process.platform === 'win32' ? '只属于 macOS：Windows 上创建符号链接需要开发模式或提权，流水线上建不了' : false }, async t => {
  const c = await context(t);
  const outsideDir = join(c.temp, 'elsewhere');
  await mkdir(outsideDir, { recursive: true });
  await writeFile(join(outsideDir, 'TASK_LIST.md'), listTable([row('TASK-001', '借道', 'READY')]));
  await mkdir(join(c.repo, 'docs'), { recursive: true });
  await symlink(join(outsideDir, 'TASK_LIST.md'), join(c.repo, 'docs', 'TASK_LIST.md'));
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.present, true);
  assert.deepEqual(plan.tasks, []);
  assert.ok(plan.diagnostics.some(d => d.level === 'error' && /符号链接指向了仓库外/.test(d.message)));
});

test('超大台账截断：按上限读取并给 warn，不报错', async t => {
  const c = await context(t);
  await mkdir(join(c.repo, 'docs', 'tasks'), { recursive: true });
  // 第一行是合法任务，后面用注释行垫到超过上限。
  const pad = `| [TASK-001](tasks/TASK-001.md) | 任务 | READY | P1 | Medium | 无 |\n` + `| 不是任务行只是填充 ${'字'.repeat(200)} |\n`.repeat(Math.ceil((MAX_LIST_BYTES + 1024) / 210));
  await writeFile(join(c.repo, 'docs', 'TASK_LIST.md'), pad);
  await writeFile(join(c.repo, 'docs', 'tasks', 'TASK-001.md'), specText());
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.present, true);
  assert.ok(plan.diagnostics.some(d => d.level === 'warn' && /截断读取/.test(d.message)));
  assert.deepEqual(plan.tasks.map(task => task.id), ['TASK-001']);
});

test('任务数量超上限：截断并给 warn', async t => {
  const c = await context(t);
  await mkdir(join(c.repo, 'docs', 'tasks'), { recursive: true });
  const lines: string[] = [];
  for (let i = 1; i <= MAX_TASKS + 5; i++) lines.push(`| [TASK-${i}](tasks/TASK-${i}.md) | 任务${i} | READY | P1 | Medium | 无 |`);
  await writeFile(join(c.repo, 'docs', 'TASK_LIST.md'), ['# 清单', '', '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |', '|---|---|---|---|---|---|', ...lines, ''].join('\n'));
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.tasks.length, MAX_TASKS);
  assert.ok(plan.diagnostics.some(d => d.level === 'warn' && /超出部分不再读取/.test(d.message)));
});

test('验收条目超过条数上限：只保留前 20 条', async t => {
  const items = Array.from({ length: MAX_ACCEPTANCE_ITEMS + 5 }, (_, i) => `第 ${i + 1} 条验收。`);
  const c = await repoWith(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '任务', 'READY')]),
    'docs/tasks/TASK-001.md': specText({ acceptance: items }),
  });
  const plan = await readTaskPlan({ name: 'demo', repo: c.repo });
  assert.equal(plan.tasks[0].acceptance.length, MAX_ACCEPTANCE_ITEMS);
  assert.equal(plan.tasks[0].acceptance[0], '第 1 条验收。');
});

// 登记两个项目，一个规划损坏、一个正常，确认看板照常加载且互不影响。
async function registryWithProjects(t: TestContext, plans: Record<string, Record<string, string>>) {
  const c = await context(t);
  const before = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (before === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = before; });
  await ensureHome();
  for (const [name, files] of Object.entries(plans)) {
    const repo = join(c.temp, `repo-${name}`);
    await mkdir(repo, { recursive: true });
    const init = await exec('git', ['init', '-b', 'main'], repo, c.env);
    assert.equal(init.code, 0, init.stderr);
    for (const [rel, content] of Object.entries(files)) {
      const target = join(repo, ...rel.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await addProject(name, await realpath(repo), {});
  }
  return c;
}

test('单个项目规划损坏：不影响其他项目，也不阻止看板加载', async t => {
  const c = await registryWithProjects(t, {
    good: {
      'docs/TASK_LIST.md': listTable([row('TASK-001', '好任务', 'READY')]),
      'docs/tasks/TASK-001.md': specText(),
    },
    broken: {
      'docs/TASK_LIST.md': '这不是一张任务表，只是一段坏掉的文字。',
    },
  });
  const view = await buildView();
  assert.ok(view.plans.good.present);
  assert.deepEqual(view.plans.good.ready, ['TASK-001']);
  assert.equal(view.plans.broken.present, true);
  assert.ok(view.plans.broken.diagnostics.some(d => d.level === 'error'));
  assert.ok(Array.isArray(view.jobs));
});

test('仓库已删除的已登记项目：规划读取失败兜成诊断，看板照常', async t => {
  const c = await context(t);
  const before = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (before === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = before; });
  await ensureHome();
  const gone = join(c.temp, 'gone-repo');
  await mkdir(gone, { recursive: true });
  const init = await exec('git', ['init', '-b', 'main'], gone, c.env);
  assert.equal(init.code, 0, init.stderr);
  await addProject('gone', await realpath(gone), {});
  const { rm } = await import('node:fs/promises');
  await rm(gone, { recursive: true, force: true });
  const view = await buildView();
  assert.equal(view.plans.gone.present, true);
  assert.ok(view.plans.gone.diagnostics.some(d => /读取任务规划失败/.test(d.message)));
});

// 打开 Task Spec 的受控解析（docs/tasks/TASK-006.md）：主进程只按“已登记项目名 + 仓库内 spec 相对路径”还原文件。
test('打开 Task Spec：只认已登记项目里规划过的相对路径，解析出仓库内的真实文件', async t => {
  const c = await registryWithProjects(t, {
    demo: {
      'docs/TASK_LIST.md': listTable([row('TASK-001', '任务', 'READY')]),
      'docs/tasks/TASK-001.md': specText(),
    },
  });
  const file = await resolveTaskSpec('demo', 'docs/tasks/TASK-001.md');
  assert.equal(file, await realpath(join(c.temp, 'repo-demo', 'docs', 'tasks', 'TASK-001.md')));
  assert.equal(await readFile(file, 'utf8'), specText());
  // 反斜杠写法（Windows 或窗口里手抄的）按同样的契约读，路径规范化后仍指向同一个文件。
  assert.equal(await resolveTaskSpec('demo', 'docs\\tasks\\TASK-001.md'), file);
});

test('打开 Task Spec：绝对路径、..、别的文件名、未登记项目、台账里没有的 spec 一律拒绝', async t => {
  const c = await registryWithProjects(t, {
    demo: {
      'docs/TASK_LIST.md': listTable([row('TASK-001', '任务', 'READY')]),
      'docs/tasks/TASK-001.md': specText(),
      'docs/README.md': '# 说明\n',
      'notes/TASK-001.md': specText(),
    },
  });
  const absolute = join(c.temp, 'repo-demo', 'docs', 'tasks', 'TASK-001.md');
  for (const rel of [absolute, 'C:\\repo\\docs\\tasks\\TASK-001.md', 'docs/tasks/../../secrets.md', '../TASK-001.md',
    'docs/README.md', 'docs/tasks/TASK-002.md', 'notes/TASK-001.md', 'tasks/TASK-001.md', '']) {
    await assert.rejects(resolveTaskSpec('demo', rel), /路径不合法|路径无效|任务规划里没有/, rel);
  }
  // 形状合法但规划里没有这份 spec（比如 TASK-002 的文件不在台账上）：同样拒绝，不按路径去翻库。
  await assert.rejects(resolveTaskSpec('demo', 'docs/tasks/TASK-002.md'), /任务规划里没有/);
  await assert.rejects(resolveTaskSpec('没登记的项目', 'docs/tasks/TASK-001.md'));
  await assert.rejects(resolveTaskSpec('../demo', 'docs/tasks/TASK-001.md'), /名字只能包含/);
  for (const bad of [null, 5, {}, ['docs/tasks/TASK-001.md'], 'docs/tasks/TASK-' + '1'.repeat(300) + '.md']) {
    await assert.rejects(resolveTaskSpec('demo', bad), /路径无效|路径不合法/);
  }
  await assert.rejects(resolveTaskSpec(null as unknown, 'docs/tasks/TASK-001.md'), /项目标识无效/);
});

test('打开 Task Spec：spec 换成指向仓库外的符号链接后拒绝打开', async t => {
  const c = await registryWithProjects(t, {
    demo: {
      'docs/TASK_LIST.md': listTable([row('TASK-001', '任务', 'READY')]),
      'docs/tasks/TASK-001.md': specText(),
    },
  });
  const repo = join(c.temp, 'repo-demo');
  const outside = join(c.temp, 'outside.md');
  await writeFile(outside, '仓库外的文件\n');
  // 规划读取时先确认过一次；之后把文件换成跑到仓库外的链接，打开前必须再挡一次。
  const { rm } = await import('node:fs/promises');
  await rm(join(repo, 'docs', 'tasks', 'TASK-001.md'));
  await symlink(outside, join(repo, 'docs', 'tasks', 'TASK-001.md'));
  await assert.rejects(resolveTaskSpec('demo', 'docs/tasks/TASK-001.md'), /仓库外|没有 .*这份 Task Spec|找不到/);
});
