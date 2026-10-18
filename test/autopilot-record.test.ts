import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { context, until } from './helpers.ts';
import { ensureHome, paths } from '../src/core/paths.ts';
import { addProject } from '../src/core/project.ts';
import {
  MAX_CONTINUES_PER_NODE, MAX_DEPTH, MAX_RETRIES_PER_NODE, PRESETS, advance, autopilotDir, budgetUsed,
  canRetry, createAutopilot, exceededBudget, isActiveState, listAutopilots, newToken, parseRun, readAutopilot, runFile,
  transition, updateAutopilot,
} from '../src/core/autopilot.ts';
import type { AutopilotRun } from '../src/core/autopilot.ts';

// 无人看守的登记层（docs/tasks/TASK-009.md 验收 1、5、6）：
// - 只能从 TASK-006 的核心权威入口认出真正可执行的 READY 任务，别的都写文件前拒绝；
// - 登记是原子落盘的独立文件，带动作令牌、预算和节点/尝试历史；
// - 状态机与预算判定是纯函数，非法转移失败关闭。
// 这里不启动推进器、不派真活（那是 autopilot-engine.test.ts）。

function listTable(rows: string[][]): string {
  return ['# 功能任务清单', '', '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |', '|---|---|---|---|---|---|',
    ...rows.map(cells => `| ${cells.join(' | ')} |`), ''].join('\n');
}
const row = (id: string, title: string, status: string, deps = '无') => [`[${id}](tasks/${id}.md)`, title, status, 'P1', 'Medium', deps];
function specText(fields: { status?: string; deps?: string; goal?: string; acceptance?: string[] } = {}): string {
  return ['# TASK-000：样例', '',
    `- 状态：\`${fields.status ?? 'READY'}\``, '- 优先级：`P1`', '- 难度等级：`Medium`',
    `- 前置任务：${fields.deps ?? '无'}`, '', '## 业务结果', '', fields.goal ?? '把事办成。', '',
    '## 验收标准', '', ...(fields.acceptance ?? ['第一条验收通过。']).map((item, i) => `${i + 1}. ${item}`), ''].join('\n');
}

// 铺开隔离环境并登记一个带任务规划的项目（仓库已提交）。
async function autopilotProject(t: TestContext, files: Record<string, string>, name = 'demo') {
  const c = await context(t);
  const keys = ['XAGENTS_HOME', 'XAGENTS_FAKE_WORKER', 'XAGENTS_APPLICATIONS', 'XAGENTS_CAFFEINATE', 'XAGENTS_MAX_RUNNING',
    'XAGENTS_TRASH', 'XAGENTS_SRT', 'CODEX_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM',
    'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const;
  const saved = keys.map(key => [key, process.env[key]] as const);
  for (const key of keys) { if (c.env[key] === undefined) delete process.env[key]; else process.env[key] = c.env[key]; }
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  await ensureHome();
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

// 测试里把一台登记收尾：严格校验要求结束状态必须有结束时间和原因，这里照做。
const retire = (id: string) => updateAutopilot(id, current => {
  current.state = 'stopped';
  current.ended ??= new Date().toISOString();
  current.reason = '测试收尾。';
  delete current.limit; delete current.pid; delete current.pidSince;
});

const readyFiles = {
  'docs/TASK_LIST.md': listTable([row('TASK-001', '底层任务', 'PASSED'), row('TASK-002', '实现无人看守', 'READY', 'TASK-001 PASSED')]),
  'docs/tasks/TASK-001.md': specText({ status: 'PASSED' }),
  'docs/tasks/TASK-002.md': specText({ deps: 'TASK-001 PASSED', goal: '让平台自己盯着往下走。' }),
};

test('从真正 ready 的任务建登记：字段齐全、预设是标准策略、落盘成独立的 run.json', async t => {
  const c = await autopilotProject(t, readyFiles);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  assert.match(run.id, /^\d{4}-\d{4}-auto/);
  assert.equal(run.version, 1);
  assert.equal(run.project, 'demo');
  assert.equal(run.repo, c.repo);
  assert.match(run.base, /^[0-9a-f]{40}$/);
  assert.equal(run.taskId, 'TASK-002');
  assert.equal(run.spec, 'docs/tasks/TASK-002.md');
  assert.deepEqual(run.who, ['codex:high']);
  assert.equal(run.network, false);           // 主人的联网总开关缺省关，照抄在当前登记里
  assert.equal(run.ro, false);
  assert.deepEqual(run.policy, PRESETS.standard);
  assert.equal(run.state, 'planning');
  assert.equal(run.elapsedSeconds, 0);
  assert.equal(run.sleeps, 0);
  assert.equal(run.attemptCount, 0);
  assert.equal(run.nodeCount, 1);
  assert.deepEqual(run.nodes, [{ id: 'TASK-002', depth: 0, state: 'pending', attempts: 0, continues: 0, retries: 0 }]);
  assert.deepEqual(run.attempts, []);
  assert.equal(run.action, undefined);
  // 真的写在 ~/.xagents/autopilots/<编号>/run.json，读回来一模一样；写的是整份文件，不留临时文件。
  assert.equal(runFile(run.id), join(paths().home, 'autopilots', run.id, 'run.json'));
  const raw = JSON.parse(await readFile(runFile(run.id), 'utf8')) as AutopilotRun;
  assert.deepEqual(raw, run);
  assert.deepEqual((await readdir(autopilotDir(run.id))).filter(name => name.endsWith('.tmp')), []);
  assert.deepEqual(await readAutopilot(run.id), run);
});

test('不可执行的任务、非登记项目、非法选手和非法预算都在写文件之前拒绝', async t => {
  await autopilotProject(t, {
    ...readyFiles,
    'docs/TASK_LIST.md': listTable([row('TASK-001', '草稿', 'DRAFT'), row('TASK-002', '真就绪', 'READY')]),
    'docs/tasks/TASK-001.md': specText({ status: 'DRAFT' }),
  });
  const base = { project: 'demo', taskId: 'TASK-002', who: ['codex:high'] };
  // 任务是否可执行只认 TASK-006 的权威入口：DRAFT、依赖没过、台账里没有的一律不行。
  await assert.rejects(createAutopilot({ ...base, taskId: 'TASK-001' }), /现在不能派发/);
  await assert.rejects(createAutopilot({ ...base, taskId: 'TASK-999' }), /任务台账里没有 TASK-999/);
  await assert.rejects(createAutopilot({ ...base, taskId: '坏号' }), /任务编号要写成 TASK-数字/);
  await assert.rejects(createAutopilot({ ...base, project: '没登记' }), /没有登记叫 没登记 的项目|没有登记/);
  // 选手范围必须在 roster 与主人策略之内。
  await assert.rejects(createAutopilot({ ...base, who: ['不存在的选手:high'] }), /选手不存在/);
  await assert.rejects(createAutopilot({ ...base, who: [] }), /至少一位选手/);
  await assert.rejects(createAutopilot({ ...base, who: Array.from({ length: 7 }, () => 'codex:high') }), /最多 6 位/);
  await assert.rejects(createAutopilot({ ...base, who: ['codex:max'] }), /推理强度只允许/);
  // 预算只接预设 ID，不接任意数字。
  await assert.rejects(createAutopilot({ ...base, policy: '30' }), /只接受 short（短任务）、standard（标准）、long（长任务）/);
  await assert.rejects(createAutopilot({ ...base, policy: '{"minutes":9999}' }), /只接受 short/);
  // 一个都没建成：没有登记、没有目录。
  assert.deepEqual(await listAutopilots(), { runs: [], broken: [] });
});

test('三个策略预设与设计一致；细拆深度和每个节点的 continue/retry 次数有硬上限', () => {
  assert.deepEqual(PRESETS.short, { id: 'short', minutes: 60, attempts: 4, nodes: 3 });
  assert.deepEqual(PRESETS.standard, { id: 'standard', minutes: 240, attempts: 10, nodes: 6 });
  assert.deepEqual(PRESETS.long, { id: 'long', minutes: 480, attempts: 16, nodes: 10 });
  assert.equal(MAX_DEPTH, 2);
  assert.equal(MAX_CONTINUES_PER_NODE, 1);
  assert.equal(MAX_RETRIES_PER_NODE, 1);
});

test('同一个任务同时只许一台无人看守；结束之后可以再建', async t => {
  await autopilotProject(t, readyFiles);
  const first = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await assert.rejects(createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['grok:high'] }), /已经有一台无人看守在推进/);
  // 停下之后可以再来一台。
  await retire(first.id);
  const second = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['grok:high'] });
  assert.notEqual(second.id, first.id);
});

test('状态机骨架：合法链走得通，非法转移失败关闭，预算到线只转 needs_owner', async t => {
  await autopilotProject(t, readyFiles);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  assert.equal(advance(run, { kind: 'started' }), false);          // planning 不能直接算“已启动”
  assert.equal(advance(run, { kind: 'intent' }), true);
  assert.equal(run.state, 'executing');
  assert.equal(advance(run, { kind: 'done' }), true);
  assert.equal(run.state, 'reviewing');
  assert.equal(advance(run, { kind: 'reviewed' }), true);
  assert.equal(run.state, 'verifying');
  assert.equal(advance(run, { kind: 'verified' }), true);
  assert.equal(run.state, 'completed');
  // 结束之后什么都推不动。
  for (const event of [{ kind: 'intent' }, { kind: 'done' }, { kind: 'stop' }] as const) assert.equal(advance(run, event), false);

  // 上面几步只在这一份对象上推，先落一份终态（第二台才建得起来）。
  await updateAutopilot(run.id, current => { current.state = 'completed'; current.ended = new Date().toISOString(); });
  // 失败 → 诊断 → 重试；重试受预算和每节点次数限制。
  const second = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  advance(second, { kind: 'intent' });
  advance(second, { kind: 'failed', note: '这一次没成。' });
  assert.equal(second.state, 'diagnosing');
  assert.equal(advance(second, { kind: 'retry' }), true);
  assert.equal(second.state, 'executing');
  // 预算到线：只能转 needs_owner，中文原因里写明是哪一项预设、哪个上限。
  await retire(second.id);
  const third = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  advance(third, { kind: 'intent' });
  assert.equal(advance(third, { kind: 'budget', limit: 'attempts' }), true);
  assert.equal(third.state, 'needs_owner');
  assert.equal(third.limit, 'attempts');
  assert.match(third.reason!, /尝试次数预算用完了/);
  assert.equal(advance(third, { kind: 'retry' }), false);
  // 推进器丢了不是失败：先记 recovering，回来时接着走。
  await retire(third.id);
  const fourth = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  assert.equal(advance(fourth, { kind: 'lost', note: '推进进程不在了。' }), true);
  assert.equal(fourth.state, 'recovering');
  assert.equal(advance(fourth, { kind: 'resume' }), true);
  assert.equal(fourth.state, 'executing');
});

test('预算四项分别判定：时长、尝试、节点、已知用量，任一到达就返回那一项', async t => {
  await autopilotProject(t, readyFiles);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'], policy: 'short' });
  assert.deepEqual(PRESETS.short, run.policy);
  const base = structuredClone(run);
  assert.equal(exceededBudget(base), null);
  // 时长：短任务 60 分钟。
  const minutes = structuredClone(run); minutes.elapsedSeconds = 60 * 60;
  assert.deepEqual(budgetUsed(minutes), { minutes: 60, attempts: 0, nodes: 1, usage: 0 });
  assert.equal(exceededBudget(minutes), 'minutes');
  // 尝试：4 次。
  const attempts = structuredClone(run); attempts.attemptCount = 4;
  assert.equal(exceededBudget(attempts), 'attempts');
  // 节点：3 个。
  const nodes = structuredClone(run); nodes.nodeCount = 3;
  assert.equal(exceededBudget(nodes), 'nodes');
  // 已知用量：登记里给了上限才判。
  const usage = structuredClone(run); usage.usage = { read: 700, cached: 200, out: 100 }; usage.usageLimit = 1000;
  assert.deepEqual(budgetUsed(usage), { minutes: 0, attempts: 0, nodes: 1, usage: 1000 });
  assert.equal(exceededBudget(usage), 'usage');
  // 休眠单独记在 sleeps 里（推进器扣掉之后才累加 elapsedSeconds），不会再算进运行时长。
  const slept = structuredClone(run); slept.elapsedSeconds = 3600; slept.sleeps = 1800;
  assert.equal(budgetUsed(slept).minutes, 60);
});

test('动作令牌：换人之后旧令牌的改写被拒绝，登记里只留当前那一个', async t => {
  await autopilotProject(t, readyFiles);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const token = newToken();
  await updateAutopilot(run.id, current => { advance(current, { kind: 'intent' }); current.action = { token, node: 'TASK-002', attempt: 1, at: new Date().toISOString() }; });
  const updated = await transition(run.id, token, current => {
    assert.equal(current.action, undefined);          // 令牌核对通过后由 transition 清掉，调用方只能拿新的
    current.sleeps += 30;
  });
  assert.equal(updated.action, undefined);
  assert.equal(updated.sleeps, 30);
  await assert.rejects(transition(run.id, token, () => {}), /动作令牌已经换人|已经没有/);
  // 结束之后不许再推进。
  await retire(run.id);
  await assert.rejects(transition(run.id, undefined, () => {}), /已经停在 stopped/);
});

test('登记文件坏了就失败关闭：读不出来会报中文错误，列表里记成 broken 但不拖垮别的', async t => {
  await autopilotProject(t, readyFiles);
  const good = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await retire(good.id);
  // 半份 JSON。
  const brokenDir = join(paths().home, 'autopilots', 'manual-broken');
  await mkdir(brokenDir, { recursive: true });
  await writeFile(join(brokenDir, 'run.json'), '{"version":1,');
  await assert.rejects(readAutopilot('manual-broken'), /登记文件不是完整 JSON|登记文件不对/);
  // 版本不认识。
  const wrong = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  await writeFile(runFile(wrong.id), JSON.stringify({ ...wrong, version: 99 }));
  await assert.rejects(readAutopilot(wrong.id), /版本不认识/);
  assert.equal(parseRun({ ...good }, good.id).id, good.id);
  await assert.rejects(async () => parseRun(null, 'x'), /登记文件不对/);
  const { runs, broken } = await listAutopilots();
  assert.deepEqual(runs.map(run => run.id), [good.id]);
  assert.deepEqual(broken.sort(), ['manual-broken', wrong.id].sort());
  // 找不到的编号给中文提示，不是 ENOENT。
  await assert.rejects(readAutopilot('没有这台'), /找不到无人看守 没有这台/);
});

test('命令行骨架：只认 start/status/list/resume/stop，参数走白名单，缺参数和坏预设都拒绝', async t => {
  const c = await autopilotProject(t, readyFiles);
  const list = await c.cli(['autopilot', 'list']);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /没有无人看守。/);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const status = await c.cli(['autopilot', 'status']);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, new RegExp(run.id));
  assert.match(status.stdout, /准备中|在干|等恢复/);
  // 参数错就报中文，不起进程、不建登记。
  const noWho = await c.cli(['autopilot', 'start', 'TASK-002', '--project', 'demo']);
  assert.notEqual(noWho.code, 0);
  assert.match(noWho.stderr, /至少一位选手/);
  const badPolicy = await c.cli(['autopilot', 'start', 'TASK-002', '--project', 'demo', '--who', 'codex:high', '--policy', 'fast']);
  assert.notEqual(badPolicy.code, 0);
  assert.match(badPolicy.stderr, /只接受 short/);
  const unknown = await c.cli(['autopilot', 'nope']);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.stderr, /只支持 start、status、list、resume 和 stop/);
  const noId = await c.cli(['autopilot', 'resume']);
  assert.notEqual(noId.code, 0);
  assert.match(noId.stderr, /参数数量不对/);
  const help = await c.cli(['--help']);
  assert.match(help.stdout, /xagents autopilot resume <编号>/);
  const missing = await c.cli(['autopilot', 'stop', '没有这台']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /找不到无人看守 没有这台/);
});

test('同一任务并发启动：只有一个建成，磁盘上只有一台活跃登记，也就只可能起一台推进器', async t => {
  await autopilotProject(t, readyFiles);
  const options = { project: 'demo', taskId: 'TASK-002', who: ['codex:high'] };
  const results = await Promise.allSettled([
    createAutopilot(options), createAutopilot(options), createAutopilot(options),
  ]);
  const ok = results.filter((item): item is PromiseFulfilledResult<AutopilotRun> => item.status === 'fulfilled');
  const no = results.filter((item): item is PromiseRejectedResult => item.status === 'rejected');
  assert.equal(ok.length, 1, '三个并发启动只能成一个');
  assert.equal(no.length, 2);
  for (const item of no) {
    assert.match(String(item.reason?.message), /这个任务已经有一台无人看守在推进/);
    assert.match(String(item.reason?.message), new RegExp(ok[0].value.id));   // 报出的是建成的那一台
  }
  const { runs, broken } = await listAutopilots();
  assert.deepEqual(broken, []);
  assert.equal(runs.length, 1, '磁盘上只能有一台登记');
  assert.equal(runs[0].id, ok[0].value.id);
  assert.equal(isActiveState(runs[0].state), true);
  assert.equal(runs[0].pid, undefined, '只有一台登记，也只会有这一台推进器');
});

test('被改过或被写坏的登记一律失败关闭：策略、编号、布尔、计数、动作、节点、进程号、用量', async t => {
  await autopilotProject(t, readyFiles);
  const good = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  const baseline = JSON.parse(await readFile(runFile(good.id), 'utf8'));
  // 一台合法登记的现场照抄一份，只改要测的那一处，别的字段保持完全自洽。
  const write = async (id: string, mutate: (run: any) => void) => {
    const run = JSON.parse(JSON.stringify(baseline));
    run.id = id;
    mutate(run);
    await mkdir(join(paths().home, 'autopilots', id), { recursive: true });
    await writeFile(join(paths().home, 'autopilots', id, 'run.json'), JSON.stringify(run, null, 2));
    return id;
  };
  const at = new Date().toISOString();
  const cases: Array<[string, (run: any) => void, RegExp]> = [
    ['策略分钟数被改宽', run => { run.policy.minutes = 9999; }, /预设的数值被改过/],
    ['策略尝试数被改宽', run => { run.policy.attempts = 99; }, /预设的数值被改过/],
    ['策略节点数被改宽', run => { run.policy.nodes = 99; }, /预设的数值被改过/],
    ['策略换成自造的', run => { run.policy = { id: 'free', minutes: 60, attempts: 4, nodes: 3 }; }, /策略不认识/],
    ['编号和目录不一致', run => { run.id = '0501-9999-auto'; }, /编号和目录对不上/],
    ['选手范围不是数组', run => { run.who = 'codex:high'; }, /选手范围不是 1–6 位/],
    ['选手超量', run => { run.who = Array(7).fill('codex:high'); }, /选手范围不是 1–6 位/],
    ['选手写法坏', run => { run.who = ['codex high']; }, /选手写法不对/],
    ['联网快照不是真假值', run => { run.network = 'yes'; }, /联网快照不是真假值/],
    ['只读快照不是真假值', run => { run.ro = 1; }, /只读快照不是真假值/],
    ['创建时间不是时间', run => { run.created = '昨天'; }, /创建时间无效/],
    ['更新时间早于创建时间', run => { run.updated = '2020-01-01T00:00:00.000Z'; }, /更新时间早于创建时间/],
    ['没结束却写了结束时间', run => { run.ended = at; }, /不该有结束时间/],
    ['已停止却没有原因', run => { run.state = 'stopped'; run.ended = at; }, /stopped 状态缺少原因/],
    ['等主人却没有原因', run => { run.state = 'needs_owner'; run.ended = at; }, /needs_owner 状态缺少原因/],
    ['运行时长是 NaN', run => { run.elapsedSeconds = NaN; }, /运行时长无效/],
    ['运行时长是 Infinity', run => { run.elapsedSeconds = Infinity; }, /运行时长无效/],
    ['运行时长是负数', run => { run.elapsedSeconds = -5; }, /运行时长无效/],
    ['休眠时长是负数', run => { run.sleeps = -1; }, /休眠时长无效/],
    ['尝试次数是负数', run => { run.attemptCount = -1; }, /尝试次数无效/],
    ['尝试次数不是整数', run => { run.attemptCount = 1.5; }, /尝试次数无效/],
    ['尝试次数和记录对不上', run => { run.attemptCount = 2; }, /尝试次数和记录对不上/],
    ['节点数和记录对不上', run => { run.nodeCount = 0; }, /节点数和记录对不上/],
    ['用量是负数', run => { run.usage = { read: -1, cached: 0, out: 0 }; }, /用量记录无效/],
    ['用量是 NaN', run => { run.usage = { read: NaN, cached: 0, out: 0 }; }, /用量记录无效/],
    ['用量上限是 0', run => { run.usageLimit = 0; }, /用量上限无效/],
    ['进程号是字符串', run => { run.pid = 'abc'; }, /推进器进程号无效/],
    ['只有启动时间没有进程号', run => { run.pidSince = 123; }, /有推进器启动时间却没有进程号/],
    ['动作令牌是空串', run => { run.action = { token: '', node: 'TASK-002', attempt: 1, at }; }, /动作令牌无效/],
    ['动作序号是 0', run => { run.action = { token: 't', node: 'TASK-002', attempt: 0, at }; }, /动作尝试序号无效/],
    ['动作时间不是时间', run => { run.action = { token: 't', node: 'TASK-002', attempt: 1, at: 'now' }; }, /动作时间无效/],
    ['动作任务号不是字符串数组', run => { run.action = { token: 't', node: 'TASK-002', attempt: 1, at, jobs: 'job-1' }; }, /动作任务号无效/],
    ['节点不是数组', run => { run.nodes = 'x'; }, /缺少节点记录/],
    ['节点深度超过上限', run => { run.nodes[0].depth = 3; }, /节点深度超过 2/],
    ['节点状态不认识', run => { run.nodes[0].state = 'ok'; }, /节点状态不认识/],
    ['节点续做次数超过上限', run => { run.nodes[0].continues = 2; }, /节点续做次数超过上限/],
    ['节点重试次数超过上限', run => { run.nodes[0].retries = 2; }, /节点重试次数超过上限/],
    ['尝试结局不认识', run => {
      run.attempts = [{ node: 'TASK-002', attempt: 1, token: 't', at, outcome: 'retry' }];
      run.attemptCount = 1;
    }, /尝试结局不认识/],
    ['尝试令牌是空串', run => {
      run.attempts = [{ node: 'TASK-002', attempt: 1, token: '', at, outcome: 'done' }];
      run.attemptCount = 1;
    }, /尝试令牌无效/],
    ['结束状态还挂着待确认动作', run => {
      run.state = 'stopped'; run.ended = at; run.reason = '收手了。';
      run.action = { token: 't', node: 'TASK-002', attempt: 1, at };
    }, /还挂着待确认动作/],
    ['预算标记挂在没结束的状态', run => { run.limit = 'minutes'; }, /预算上限标记只属于 needs_owner/],
    ['版本不认识', run => { run.version = 99; }, /版本不认识/],
    ['起点提交不像提交', run => { run.base = 'main'; }, /起点提交无效/],
  ];
  const badIds: string[] = [];
  for (const [index, [label, mutate, shape]] of cases.entries()) {
    const id = `0501-${String(1000 + index)}-auto`;
    await write(id, mutate);
    await assert.rejects(async () => readAutopilot(id), shape, label);
    badIds.push(id);
  }
  // 一条坏的不许拖垮别的：正常那台照样列出来，坏的全部记成 broken。
  const { runs, broken } = await listAutopilots();
  assert.deepEqual(runs.map(run => run.id), [good.id]);
  assert.deepEqual(broken.sort(), badIds.sort());
  // 写入口同样挡：放开预算的改动不许进盘。
  await assert.rejects(
    updateAutopilot(good.id, current => { current.policy.minutes = 9999; }),
    /这次要写进去的登记不对：standard 预设的数值被改过/,
  );
  assert.deepEqual((await readAutopilot(good.id)).policy, PRESETS.standard);
});

test('读取登记照原样读回，不按现在的设置偷偷修旧快照', async t => {
  await autopilotProject(t, readyFiles);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['grok:high'] });
  // 当年记下的是"开着联网、只读、两位选手"；之后主人改了设置也不能把旧登记改成新设置。
  const raw = JSON.parse(await readFile(runFile(run.id), 'utf8'));
  raw.network = true;
  raw.ro = true;
  raw.who = ['grok:high', 'codex:high:fast'];
  await writeFile(runFile(run.id), JSON.stringify(raw, null, 2));
  const back = await readAutopilot(run.id);
  assert.equal(back.network, true);
  assert.equal(back.ro, true);
  assert.deepEqual(back.who, ['grok:high', 'codex:high:fast']);
  assert.deepEqual(back.policy, PRESETS.standard);
});

test('命令行恢复链路：推进器没起来的登记用 resume <编号> 接着走，不另建一台、不改原预算令牌', async t => {
  const c = await autopilotProject(t, readyFiles);
  const run = await createAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] });
  // 现场：登记建好了，推进器没起来（等恢复），而且时长预算已经用完——这台推进器一起来就收尾，不会真去派活。
  await updateAutopilot(run.id, current => {
    current.state = 'recovering';
    current.reason = '推进进程没能启动，用 autopilot resume 接着起来。';
    current.elapsedSeconds = 5 * 60 * 60;
  });
  // 提示里给出的是能照着敲的命令。
  const status = await c.cli(['autopilot', 'status', run.id]);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, new RegExp(`xagents autopilot resume ${run.id}`));
  const list = await c.cli(['autopilot', 'list']);
  assert.match(list.stdout, new RegExp(`xagents autopilot resume ${run.id}`));
  // 真的走命令行恢复：起的是原编号那台，不是新建一台。
  const resumed = await c.cli(['autopilot', 'resume', run.id]);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.match(resumed.stdout, new RegExp(`无人看守 ${run.id} 已恢复`));
  assert.match(resumed.stdout, /策略 standard（240 分钟/);
  assert.match(resumed.stdout, /选手 codex:high/);
  const after = await until(() => readAutopilot(run.id), item => item.state === 'needs_owner');
  assert.equal(after.state, 'needs_owner');
  assert.equal(after.limit, 'minutes');
  assert.equal(after.taskId, 'TASK-002');
  assert.deepEqual(after.policy, PRESETS.standard);
  assert.deepEqual(after.who, ['codex:high']);
  assert.equal(after.created, run.created);
  const { runs } = await listAutopilots();
  assert.equal(runs.length, 1, '恢复不能另建一台');
  assert.equal(runs[0].id, run.id);
  // 已经收尾的登记不再允许恢复。
  const again = await c.cli(['autopilot', 'resume', run.id]);
  assert.notEqual(again.code, 0);
  assert.match(again.stderr, /已经停在「等主人」，不用恢复/);
});

test('推进器没能启动时，start 的报错直接给出可以照敲的 resume 命令', async t => {
  await autopilotProject(t, readyFiles);
  const { startAutopilot } = await import('../src/core/autopilot-engine.ts');
  await assert.rejects(
    startAutopilot({ project: 'demo', taskId: 'TASK-002', who: ['codex:high'] }, {
      launch: async () => { throw new Error('spawn 失败'); },
    }),
    /用 xagents autopilot resume \d{4}-\d{4}-auto(?:-\d+)? 接着起来/,
  );
  const { runs } = await listAutopilots();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].state, 'recovering');
  assert.match(String(runs[0].reason), /autopilot resume/);
});
