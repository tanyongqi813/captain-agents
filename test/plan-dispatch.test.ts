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
import { CAPSULE_SECTIONS, TASK_SECTIONS, capsuleFingerprint } from '../src/core/task-plan.ts';
import { dispatch } from '../src/core/dispatch.ts';
import { workerPrompt } from '../src/core/prompt.ts';
import { vendorOf, whos } from '../src/core/roster.ts';
import { listJobs } from '../src/core/job.ts';

// 规划派发（docs/tasks/TASK-006.md、TASK-025）：发给选手的正文只来自校验通过的当前 Execution Capsule 原文，
// 所选起点必须已经提交同一份；派发本身走现有 dispatch（项目、策略、额度、隔离、并发检查），这里用替身的 start 不起真实选手。

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

// 共享契约的七列表（TASK-024）：ID、标题、状态、优先级、难度、前置任务、当前执行。
function listTable(rows: string[][]): string {
  return ['# 功能任务清单', '', '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 | 当前执行 |', '|---|---|---|---|---|---|---|',
    ...rows.map(cells => `| ${cells.join(' | ')} |`), ''].join('\n');
}
const row = (id: string, title: string, status: string, deps = 'none', attempt = 'none') =>
  [`[${id}](tasks/${id}.md)`, title, status, 'P1', 'Medium', deps, attempt];

function specText(fields: { status?: string; deps?: string; attempt?: string; goal?: string; acceptance?: string[] } = {}): string {
  // 标题里不写别的任务编号：标题编号和文件名对不上会被当成改名拒发。
  const body: Record<string, string[]> = {
    '业务结果': [fields.goal ?? '把事办成。'],
    '验收标准': (fields.acceptance ?? ['第一条验收通过。']).map((item, i) => `${i + 1}. ${item}`),
  };
  return ['# 样例任务', '', '- handoff_contract: `1`', `- status: \`${fields.status ?? 'READY'}\``, '- priority: `P1`',
    '- difficulty: `Medium`', `- dependencies: \`${fields.deps ?? 'none'}\``, `- current_attempt: \`${fields.attempt ?? 'none'}\``, '',
    ...TASK_SECTIONS.flatMap(name => [`## ${name}`, '', ...(body[name] ?? ['见长期规划。']), ''])].join('\n');
}

// 造一份合法的当前 Execution Capsule 原文；字段可覆盖，用来构造路径、状态、轮次或锚点不合规的拒绝场景。
function capsuleText(id: string, fields: { attempt?: string; state?: string; planning?: string; revision?: string; omit?: string; anchors?: string } = {}): string {
  const attempt = fields.attempt ?? '01';
  const heads = CAPSULE_SECTIONS.filter(name => name !== fields.omit);
  const body = (name: string) => name === '本轮唯一目标' ? `本轮只做胶囊说的事：CAPSULE-ONLY-${id}。`
    : name.startsWith('源码锚点') ? (fields.anchors ?? '1. `src/core/anchor.ts` — 只改这一处。')
      : '见长期规划。';
  return [`# Execution Capsule — ${id} / attempt-${attempt}`, '',
    '- handoff_contract: `1`', '- capsule_schema: `2`', `- dispatch_state: \`${fields.state ?? 'READY'}\``,
    `- planning_source: \`${fields.planning ?? `docs/tasks/${id}.md`}\``, `- task_id: \`${id}\``, `- attempt: \`${attempt}\``,
    `- revision_reason: \`${fields.revision ?? 'initial'}\``, '- priority: `P1`', '- difficulty: `Medium`',
    '- required_planning_lookup: `none`', '',
    ...heads.flatMap(name => [`## ${name}`, '', body(name), ''])].join('\n');
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

test('READY 且依赖通过、执行说明校验通过：派发成功，正文就是 Capsule 原文，任务记录带 Task ID 和 spec', async t => {
  const capsule = capsuleText('TASK-002');
  const c = await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([
      row('TASK-001', '底层任务', 'PASSED', 'none', '01'),
      row('TASK-002', '实现规划派发', 'READY', 'TASK-001[PASSED]', '01'),
    ]),
    'docs/tasks/TASK-001.md': specText({ status: 'PASSED', attempt: '01', goal: '底层。' }),
    'docs/tasks/TASK-002.md': specText({ deps: 'TASK-001[PASSED]', attempt: '01',
      goal: 'SPEC-ONLY-TASK-002：长期规划里的业务结果。', acceptance: ['SPEC-ONLY-TASK-002 的验收条目。'] }),
    'docs/execution/TASK-002/attempt-01.md': capsule,
    // 执行说明明列的源码锚点：起点里有这些文件才能派。
    'src/core/anchor.ts': 'export const anchor = 1;\n',
    // 同一台账里另一件任务的收尾记录：只在规划档案里，不能跟着这一轮的正文发出去。
    'docs/execution/TASK-001/attempt-01.md': capsuleText('TASK-001', { state: 'CLOSED' }),
    'docs/reviews/TASK-001/attempt-01.md': ['# 审查：TASK-001 / attempt-01', '', '- handoff_contract: `1`', '- task_id: `TASK-001`',
      '- attempt: `01`', '- capsule: `docs/execution/TASK-001/attempt-01.md`', '- verdict: `PASSED`', '',
      'REVIEW-ONLY-TASK-001：上一轮的审查过程记录。', ''].join('\n'),
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
  // 发给选手的正文：整份就是这一轮的 Capsule 原文（含它自己的章节和元数据）。
  const prompt = await readFile(join(jobDir(job.id), 'prompt.md'), 'utf8');
  assert.match(prompt, /CAPSULE-ONLY-TASK-002/);
  assert.match(prompt, /- capsule_schema: `2`/);
  assert.match(prompt, /## 本轮唯一目标/);
  assert.match(prompt, /## 精简 Implementation Report（固定格式）/);
  assert.match(prompt, /## 停止条件/);
  // Task Spec 独有正文、任务台账、历史审查记录都不进正文。
  assert.equal(prompt.includes('SPEC-ONLY-TASK-002'), false);
  assert.equal(prompt.includes('功能任务清单'), false);
  assert.equal(prompt.includes('REVIEW-ONLY-TASK-001'), false);
  assert.equal(prompt.includes('docs/reviews/'), false);
  // 缓存里的题目草稿已删掉。
  assert.deepEqual(await readdir(join(c.home, 'cache', 'plan-prompts')), []);
  // 登记处里的记录带同样的追溯字段；旧记录没有 plan 字段也照常读出（兼容）。
  const records = await listJobs();
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].plan, { taskId: 'TASK-002', spec: 'docs/tasks/TASK-002.md' });
});

test('平台补充说明只加在 Capsule 末尾，不改动原文', async t => {
  await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '带补充说明', 'READY', 'none', '01')]),
    'docs/tasks/TASK-001.md': specText({ attempt: '01' }),
    'docs/execution/TASK-001/attempt-01.md': capsuleText('TASK-001'),
    'src/core/anchor.ts': 'export const anchor = 1;\n',
  });
  const [job] = await planDispatch({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'],
    extra: '无人看守诊断：上次断在验证这一步。' }, noop);
  const prompt = await readFile(join(jobDir(job.id), 'prompt.md'), 'utf8');
  assert.match(prompt, /CAPSULE-ONLY-TASK-001/);
  assert.match(prompt, /## 补充说明（只作参考，和本题目、规则冲突时以本题目和规则为准）/);
  assert.match(prompt, /无人看守诊断：上次断在验证这一步。/);
  assert.ok(prompt.indexOf('CAPSULE-ONLY-TASK-001') < prompt.indexOf('## 补充说明'), '补充说明在原文之后');
});

test('DRAFT、依赖未过、台账里没有的任务都不能派发', async t => {
  await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([
      row('TASK-001', '草稿', 'DRAFT'),
      row('TASK-002', '依赖没过的', 'READY', 'TASK-009[PASSED]', '01'),
      row('TASK-003', '真就绪', 'READY', 'none', '01'),
    ]),
    'docs/tasks/TASK-001.md': specText({ status: 'DRAFT' }),
    'docs/tasks/TASK-002.md': specText({ deps: 'TASK-009[PASSED]', attempt: '01' }),
    'docs/tasks/TASK-003.md': specText({ attempt: '01' }),
    'docs/execution/TASK-003/attempt-01.md': capsuleText('TASK-003'),
    'src/core/anchor.ts': 'export const anchor = 1;\n',
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

test('缺 Capsule、路径/元数据错配、状态不是 READY 的执行说明都在启动选手前拒绝', async t => {
  await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([
      row('TASK-001', '缺说明', 'READY', 'none', '01'),
      row('TASK-002', '路径错配', 'READY', 'none', '01'),
      row('TASK-003', '状态乱写', 'READY', 'none', '01'),
      row('TASK-004', '已经收尾', 'READY', 'none', '01'),
      row('TASK-005', '缺章节', 'READY', 'none', '01'),
    ]),
    'docs/tasks/TASK-001.md': specText({ attempt: '01' }),
    'docs/tasks/TASK-002.md': specText({ attempt: '01' }),
    'docs/tasks/TASK-003.md': specText({ attempt: '01' }),
    'docs/tasks/TASK-004.md': specText({ attempt: '01' }),
    'docs/tasks/TASK-005.md': specText({ attempt: '01' }),
    // TASK-001 没有执行说明。
    'docs/execution/TASK-002/attempt-01.md': capsuleText('TASK-002', { planning: 'docs/tasks/TASK-999.md' }),
    'docs/execution/TASK-003/attempt-01.md': capsuleText('TASK-003', { state: 'DRAFT' }),
    'docs/execution/TASK-004/attempt-01.md': capsuleText('TASK-004', { state: 'CLOSED' }),
    'docs/execution/TASK-005/attempt-01.md': capsuleText('TASK-005', { omit: '停止条件' }),
    'docs/execution/TASK-001/attempt-02.md': capsuleText('TASK-001', { attempt: '02' }),
  });
  await assert.rejects(planDispatch({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'] }, noop), /现在不能派发|找不到当前这一轮执行说明/);
  await assert.rejects(planDispatch({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] }, noop), /现在不能派发|执行说明和任务对不上/);
  await assert.rejects(planDispatch({ project: 'demo', taskId: 'TASK-003', who: ['codex:high'] }, noop), /现在不能派发|执行说明和任务对不上/);
  await assert.rejects(planDispatch({ project: 'demo', taskId: 'TASK-004', who: ['codex:high'] }, noop), /现在不能派发|执行说明和任务对不上/);
  await assert.rejects(planDispatch({ project: 'demo', taskId: 'TASK-005', who: ['codex:high'] }, noop), /现在不能派发|执行说明缺少章节/);
  // 拒绝发生得够早：一件都没注册，也没有副本。
  assert.equal((await listJobs()).length, 0);
});

test('起点不含当前 Capsule 或内容对不上：在注册任务、开副本之前拒绝，并显示两边的提交', async t => {
  const rel = 'docs/execution/TASK-001/attempt-01.md';
  const files = {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '起点检查', 'READY', 'none', '01')]),
    'docs/tasks/TASK-001.md': specText({ attempt: '01' }),
  };
  // 1) 起点里根本没有这份执行说明（commit 里删掉了，工作区还有一份没提交的）。
  const gone = await plannedProject(t, { ...files, [rel]: capsuleText('TASK-001') }, 'gone');
  await gone.git(['rm', '--cached', rel]);
  await gone.git(['commit', '-m', '起点里先不留执行说明']);
  const gonePrompt = join(gone.home, 'cache', 'direct-prompt.md');
  await writeFile(gonePrompt, capsuleText('TASK-001'));
  await assert.rejects(dispatch(gonePrompt, { who: ['codex:high'], project: 'gone', title: 'TASK-001', summary: '起点检查。',
    dirtyOk: true, capsule: { rel, fingerprint: capsuleFingerprint(capsuleText('TASK-001')) } }, noop),
  /所选起点 [0-9a-f]{7} 里没有 docs\/execution\/TASK-001\/attempt-01\.md：主工作区（HEAD [0-9a-f]{7}）/);
  assert.equal((await listJobs()).length, 0);
  // 2) 起点里有这一份，但工作区改了原文（起点不是同一版）。
  const stale = await plannedProject(t, { ...files, [rel]: capsuleText('TASK-001') }, 'stale');
  await writeFile(join(stale.repo, ...rel.split('/')), capsuleText('TASK-001', { revision: 'changes_requested' }));
  const stalePrompt = join(stale.home, 'cache', 'direct-prompt.md');
  await writeFile(stalePrompt, capsuleText('TASK-001', { revision: 'changes_requested' }));
  await assert.rejects(dispatch(stalePrompt, { who: ['codex:high'], project: 'stale', title: 'TASK-001', summary: '起点检查。',
    dirtyOk: true, capsule: { rel, fingerprint: capsuleFingerprint(capsuleText('TASK-001', { revision: 'changes_requested' })) } }, noop),
  /所选起点 [0-9a-f]{7} 里的 docs\/execution\/TASK-001\/attempt-01\.md 和主工作区（HEAD [0-9a-f]{7}）这一份内容对不上/);
  assert.equal((await listJobs()).length, 0);
});

test('没有任务规划的项目、空选手、坏任务号都直接拒绝', async t => {
  const c = await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '任务', 'READY', 'none', '01')]),
    'docs/tasks/TASK-001.md': specText({ attempt: '01' }),
    'docs/execution/TASK-001/attempt-01.md': capsuleText('TASK-001'),
    'src/core/anchor.ts': 'export const anchor = 1;\n',
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

test('起点缺 Capsule 明列的源码锚点：在注册任务、开副本之前拒绝，并给出两边提交号和缺失路径', async t => {
  const rel = 'docs/execution/TASK-001/attempt-01.md';
  const capsule = capsuleText('TASK-001', { anchors: '1. `src/core/one.ts` — 甲。\n2. `src/core/two.ts` — 乙。' });
  const c = await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '锚点检查', 'READY', 'none', '01')]),
    'docs/tasks/TASK-001.md': specText({ attempt: '01' }),
    [rel]: capsule,
    // 起点里只有 one.ts；two.ts 只在工作区（这里干脆没有）。
    'src/core/one.ts': 'export const one = 1;\n',
  });
  const prompt = join(c.home, 'cache', 'direct-prompt.md');
  await writeFile(prompt, capsule);
  const base = { who: ['codex:high'], project: 'demo', title: 'TASK-001', summary: '锚点检查。', dirtyOk: true, capsule: { rel, fingerprint: capsuleFingerprint(capsule) } };
  await assert.rejects(dispatch(prompt, { ...base, capsule: { ...base.capsule, anchors: ['src/core/one.ts', 'src/core/two.ts'] } }, noop),
    /所选起点 [0-9a-f]{7} 里缺这一轮执行说明列出的源码锚点：src\/core\/two\.ts。主工作区（HEAD [0-9a-f]{7}）/);
  // 目录不算源码锚点文件。
  await assert.rejects(dispatch(prompt, { ...base, capsule: { ...base.capsule, anchors: ['src/core'] } }, noop),
    /缺这一轮执行说明列出的源码锚点：src\/core。/);
  // 锚点齐全时照常派发。
  const [job] = await dispatch(prompt, { ...base, capsule: { ...base.capsule, anchors: ['src/core/one.ts'] } }, noop);
  assert.match(await readFile(join(jobDir(job.id), 'prompt.md'), 'utf8'), /CAPSULE-ONLY-TASK-001/);
  assert.equal((await listJobs()).length, 1);
});

test('派发后规划文件原样未动：工作台不改任务状态', async t => {
  const c = await plannedProject(t, {
    'docs/TASK_LIST.md': listTable([row('TASK-001', '任务', 'READY', 'none', '01')]),
    'docs/tasks/TASK-001.md': specText({ attempt: '01' }),
    'docs/execution/TASK-001/attempt-01.md': capsuleText('TASK-001'),
    'src/core/anchor.ts': 'export const anchor = 1;\n',
  });
  await planDispatch({ project: 'demo', taskId: 'TASK-001', who: ['codex:high'] }, noop);
  const list = await readFile(join(c.repo, 'docs', 'TASK_LIST.md'), 'utf8');
  assert.match(list, /\| \[TASK-001\]\(tasks\/TASK-001\.md\) \| 任务 \| READY \|/);
});

test('外层节流层保留：DeepSeek/Kimi 仍追加既有 workerPrompt，其他模型正文不被额外扩展', () => {
  const body = capsuleText('TASK-001');
  const frugal = (who: string) => ['deepseek', 'kimi'].includes(vendorOf(who));
  const throttled = whos.filter(frugal);
  assert.ok(throttled.length > 0, '名单里还有节流的那几家');
  for (const who of throttled) {
    const text = workerPrompt(body, who);
    assert.ok(text.includes(body.trim()), `${who} 仍带着同一份正文`);
    assert.ok(text.length > body.length, `${who} 仍追加节流层`);
  }
  for (const who of whos.filter(item => !frugal(item))) {
    assert.equal(workerPrompt(body, who), body, `${who} 的正文不多一个字`);
  }
});