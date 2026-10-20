import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { context } from './helpers.ts';
import type { QuotaSnapshot } from '../src/core/quota.ts';
import { ensureHome, jobDir } from '../src/core/paths.ts';
import { addProject } from '../src/core/project.ts';
import { planDispatch } from '../src/core/plan-dispatch.ts';
import { listJobs } from '../src/core/job.ts';

// 规划派发（docs/tasks/TASK-006.md）：只有真正可执行的 READY 任务能派发；任务记录带上 Task ID 和 spec 追溯。
// 派发本身走现有 dispatch（项目、策略、额度、隔离、并发检查），这里用替身的 start 不起真实选手。

async function quota(home: string, used = 55) {
  const at = new Date().toISOString();
  const snapshot: QuotaSnapshot = { queriedAt: at, providers: [
    { name: 'Codex', icon: 'codex', plan: 'pro', at, bars: [{ label: '周额度', used, reset: null, windowMinutes: 10080 }] },
    { name: 'Grok', icon: 'grok', plan: null, at, bars: [] },
    { name: 'Cursor', icon: 'cursor', plan: null, at, bars: [] },
  ] };
  await mkdir(join(home, 'cache'), { recursive: true });
  await writeFile(join(home, 'cache/quota.json'), JSON.stringify(snapshot));
}

function listTable(rows: string[][]): string {
  return ['# 功能任务清单', '', '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |', '|---|---|---|---|---|---|',
    ...rows.map(cells => `| ${cells.join(' | ')} |`), ''].join('\n');
}
const row = (id: string, title: string, status: string, deps = '无') => [`[${id}](tasks/${id}.md)`, title, status, 'P1', 'Medium', deps];

function specText(fields: { status?: string; deps?: string; goal?: string; acceptance?: string[]; execution?: string } = {}): string {
  return ['# TASK-000：样例', '',
    `- 状态：\`${fields.status ?? 'READY'}\``, '- 优先级：`P1`', '- 难度等级：`Medium`',
    `- 前置任务：${fields.deps ?? '无'}`, '', '## 业务结果', '', fields.goal ?? '把事办成。', '',
    '## 验收标准', '', ...(fields.acceptance ?? ['第一条验收通过。']).map((item, i) => `${i + 1}. ${item}`), '', fields.execution ?? ''].join('\n');
}

// 登记一个带任务规划的项目：仓库已提交（派发前的不提交检查要过）。
// 环境照仓库的测试约定铺开：临时 XAGENTS_HOME + 真实选手替身（test/fixtures/worker.ts，由 helpers 的 context 给出）。
// 替身只是本机那份选手程序的替代品；生产代码里“替身才跳过隔离自检”的判断一条都没改，也不为测试放宽。
async function plannedProject(t: TestContext, files: Record<string, string>, name = 'demo') {
  const c = await context(t);
  const keys = ['XAGENTS_HOME', 'XAGENTS_FAKE_WORKER', 'XAGENTS_APPLICATIONS', 'XAGENTS_CAFFEINATE', 'XAGENTS_MAX_RUNNING',
    'XAGENTS_TRASH', 'XAGENTS_SRT', 'CODEX_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
    'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const;
  const saved = keys.map(key => [key, process.env[key]] as const);
  for (const key of keys) { if (c.env[key] === undefined) delete process.env[key]; else process.env[key] = c.env[key]; }
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  await ensureHome();
  await quota(c.home);
  for (const [rel, content] of Object.entries(files)) {
    const target = join(c.repo, ...rel.split('/'));
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  }
  await c.git(['add', '.']);
  await c.git(['commit', '-m', '任务规划']);
  await addProject(name, c.repo, {});
  return c;
}

const noop = async () => {};

test('READY 且依赖通过的任务：派发成功，任务记录带上 Task ID 和 spec，题目含验收标准', async t => {
  const c = await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '底层任务', 'PASSED'), row('TASK-002', '实现规划派发', 'READY', 'TASK-001 PASSED')]),
    'docs/tasks/TASK-001.md': specText({ status: 'PASSED' }),
    'docs/tasks/TASK-002.md': specText({ deps: 'TASK-001 PASSED', goal: '让规划页能发起派活。', acceptance: ['只有可执行任务能派发。', '任务记录带 Task ID。'] }),
  });
  const jobs = await planDispatch({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] }, noop);
  assert.equal(jobs.length, 1);
  const job = jobs[0];
  assert.equal(job.who, 'codex');
  assert.equal(job.effort, 'high');
  assert.equal(job.project, 'demo');
  assert.equal(job.kind, '实现');
  assert.match(job.title, /^TASK-002 /);
  assert.equal(job.plan?.taskId, 'TASK-002');
  assert.equal(job.plan?.spec, 'docs/tasks/TASK-002.md');
  // 发给选手的题目：任务编号、目标、验收标准、来源 spec 都在。
  const prompt = await readFile(join(jobDir(job.id), 'prompt.md'), 'utf8');
  assert.match(prompt, /任务编号：TASK-002/);
  assert.match(prompt, /让规划页能发起派活。/);
  assert.match(prompt, /1\. 只有可执行任务能派发。/);
  assert.match(prompt, /docs\/tasks\/TASK-002\.md/);
  // 缓存里的题目草稿已删掉。
  assert.deepEqual(await readdir(join(c.home, 'cache', 'plan-prompts')), []);
  // 登记处里的记录带同样的追溯字段；旧记录没有 plan 字段也照常读出（兼容）。
  const records = await listJobs();
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].plan, { taskId: 'TASK-002', spec: 'docs/tasks/TASK-002.md' });
});

test('规划派发生成短执行胶囊，带文件白名单、验证上限和已知基线', async t => {
  const execution = ['## 精确锚点', '', '- `src/core/a.ts` 的 `run`', '', '## 执行边界', '',
    '- 可修改：`src/core/a.ts`、`test/a.test.ts`', '- 修改文件上限：2', '', '## 执行者验证', '', '```bash',
    'npm run typecheck', 'node --test test/a.test.ts', '```', '', '## 已知基线', '', '- quota PTY 不排查', ''].join('\n');
  const c = await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '短胶囊', 'READY')]),
    'docs/tasks/TASK-001.md': specText({ execution }),
  });
  const [job] = await planDispatch({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'] }, noop);
  const text = await readFile(join(jobDir(job.id), 'prompt.md'), 'utf8');
  assert.match(text, /# 执行胶囊：TASK-001/);
  assert.match(text, /src\/core\/a\.ts 的 run/);
  assert.match(text, /修改文件上限：2/);
  assert.match(text, /只运行上述命令/);
  assert.match(text, /quota PTY 不排查/);
  assert.match(text, /Task Spec 是负责人的长期规划档案/);
});

test('DRAFT、依赖未过、台账里没有的任务都不能派发', async t => {
  const c = await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([
      row('TASK-001', '草稿', 'DRAFT'),
      row('TASK-002', '依赖没过的', 'READY', 'TASK-009 PASSED'),
      row('TASK-003', '真就绪', 'READY'),
    ]),
    'docs/tasks/TASK-001.md': specText({ status: 'DRAFT' }),
    'docs/tasks/TASK-002.md': specText({ deps: 'TASK-009 PASSED' }),
    'docs/tasks/TASK-003.md': specText(),
  });
  await assert.rejects(planDispatch({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'] }, noop), /现在不能派发/);
  await assert.rejects(planDispatch({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] }, noop), /现在不能派发/);
  await assert.rejects(planDispatch({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'] }, noop), /DRAFT 不是 READY|只有 READY/);
  await assert.rejects(planDispatch({ project: 'demo', taskId: 'TASK-077', who: ['codex:high'] }, noop), /任务台账里没有 TASK-077/);
  // TASK-003 合法：确认前面的拒绝一个都没派出去。
  assert.equal((await listJobs()).length, 0);
  const ok = await planDispatch({ project: 'demo', taskId: 'TASK-003', who: ['codex:high'] }, noop);
  assert.equal(ok.length, 1);
});

test('没有任务规划的项目、空选手、坏任务号都直接拒绝', async t => {
  const c = await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '任务', 'READY')]),
    'docs/tasks/TASK-001.md': specText(),
  }, 'with-plan');
  // 再登记一个没有台账的项目。
  const { realpath } = await import('node:fs/promises');
  const bare = join(c.temp, 'bare-repo');
  await mkdir(bare, { recursive: true });
  const { exec } = await import('./helpers.ts');
  const init = await exec('git', ['init', '-b', 'main'], bare, c.env);
  assert.equal(init.code, 0, init.stderr);
  await writeFile(join(bare, 'base.txt'), '起点\n');
  const git = async (args: string[]) => { const r = await exec('git', args, bare, c.env); assert.equal(r.code, 0, r.stderr); return r.stdout.trim(); };
  await git(['add', 'base.txt']); await git(['commit', '-m', 'init']);
  await addProject('bare', await realpath(bare), {});
  await assert.rejects(planDispatch({ project: 'bare', taskId: 'TASK-001', who: ['codex:high'] }, noop), /没有任务规划/);
  await assert.rejects(planDispatch({ project: 'with-plan', taskId: 'TASK-001', who: [] }, noop), /先选择至少一位选手/);
  await assert.rejects(planDispatch({ project: 'with-plan', taskId: '坏号', who: ['codex:high'] }, noop), /任务编号无效/);
  assert.equal((await listJobs()).length, 0);
});

test('派发后规划文件原样未动：工作台不改任务状态', async t => {
  const c = await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '任务', 'READY')]),
    'docs/tasks/TASK-001.md': specText(),
  });
  await planDispatch({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'] }, noop);
  const list = await readFile(join(c.repo, 'docs', 'TASK_LIST.md'), 'utf8');
  assert.match(list, /\| \[TASK-001\]\(tasks\/TASK-001\.md\) \| 任务 \| READY \|/);
});
