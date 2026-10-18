import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, symlink, rm, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { readIcon } from '../app/main/icons.ts';
import { httpsLink, productionCsp, samePage, securePreferences, trustedSender } from '../app/main/security.ts';
import { loadBounds, saveBounds } from '../app/main/window-state.ts';
import { watchRegistry } from '../app/main/watch.ts';
import { settingsActions, settingsPatch, teamActions, chatActions, planActions, planSpecActions } from '../app/main/actions.ts';
import { cleanComment } from '../src/core/comments.ts';
import { sayInTeam, stopTeam } from '../src/core/team.ts';
import type { Team } from '../src/core/team.ts';
import { channels } from '../app/shared/ipc.ts';
import { noticeTitle } from '../app/main/notifications.ts';
import { SLIM_EVERY_MS, SLIM_FIRST_MS, slimScheduler } from '../app/main/slim.ts';
import { SLIM_CHOICES } from '../app/renderer/lib/storage.ts';
import { RANGE_CHOICES } from '../app/renderer/lib/dashboard.ts';
import { ranges, rangeLabel } from '../src/core/dashboard.ts';
import { RUN_CHOICES, STOP_CHOICES } from '../app/renderer/lib/limits.ts';
import { LIMIT_CAPS, quotaStops } from '../src/core/settings.ts';
import { slimDays } from '../src/core/settings.ts';
import { effectiveWorkers } from '../src/core/policy.ts';
import { buildView } from '../src/core/view.ts';
import { writeAtomic, writeJson as atomicJson } from '../src/core/fsx.ts';
import { derive } from '../app/renderer/lib/board.ts';
import type { Job } from '../src/core/job.ts';
import { context, until } from './helpers.ts';
import { PROJECT_SELECTION_TTL_MS, projectActions, projectSelections, suggestedProjectLabel, suggestedProjectName } from '../app/main/project-bridge.ts';
import { addProject, loadProject, projectBudget } from '../src/core/project.ts';
import { parseBudget } from '../src/core/budget.ts';
import type { Budget } from '../src/core/budget.ts';
import { checkProject } from '../src/core/project-check.ts';
import { ensureHome } from '../src/core/paths.ts';
import { git } from '../src/core/worktree.ts';
import type { TestContext } from 'node:test';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { EventEmitter } from 'node:events';
import type { FSWatcher } from 'node:fs';

async function writeJson(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  await atomicJson(file, value);
}

async function registry(t: TestContext) {
  const home = await mkdtemp(join(tmpdir(), 'xa-desktop-unit-'));
  const previous = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });
  return home;
}
const job = (id: string, extra: Partial<Job> = {}): Job => ({
  id, batch: '', project: '测试', repo: '/unused', base: 'test', worktree: '/unused', branch: 'test', who: 'codex',
  model: 'test', effort: 'high', mode: 'read-only', kind: '实现', title: '测试', state: 'done',
  created: new Date().toISOString(), ended: new Date().toISOString(), ...extra,
});

test('buildView 只读登记处、兼容旧记录并仅暴露应用所需字段', async t => {
  const home = await registry(t);
  const empty = await buildView();
  assert.deepEqual(empty.jobs, []);
  assert.deepEqual(await readdir(home), []);
  const source = job('running', { state: 'running' }); // 没有存活进程，也不能在读取时落盘改状态。
  await writeJson(join(home, 'jobs/running/job.json'), source);
  await writeJson(join(home, 'batches/batch.json'), { id: 'batch', title: '题目', kind: '实现', started: source.created, base: 'test', jobs: ['running'] });
  await writeJson(join(home, 'config.json'), { board: { columns: { running: '#123456' } } });
  await writeAtomic(join(home, 'jobs/running/report.md'), '报告');
  const before = await readFile(join(home, 'jobs/running/job.json'), 'utf8');
  const view = await buildView();
  assert.equal(view.jobs[0].state, 'lost'); // 只在看板里显示成失联，记录不改。
  assert.equal(view.theme?.columns.running, '#123456');
  assert.equal(await readFile(join(home, 'jobs/running/job.json'), 'utf8'), before);
  assert.ok(!(await readdir(home)).includes('board'));
  assert.equal(view.jobs[0].summary, source.title);
  assert.equal(view.batches[0].summary, '题目');
  assert.equal(view.jobs[0].base, source.base);
  assert.deepEqual(Object.keys(view.jobs[0]).sort(), 'id batch project who model effort kind title state base started ended seconds typical check checkSkipped decision summary redo sleeps comments activity network realCheck rating timing plan termination'.split(' ').sort());
  // 旧记录没有 plan 字段也照常读出（兼容）：公开视图里老实写 null，界面据此判断要不要显示追溯信息。
  assert.equal(view.jobs[0].plan, null);
  // 旧记录没有 termination 字段（TASK-008 之前登记的）：收尾原因显示成 null，界面按 null 当“老记录”。
  assert.equal(view.jobs[0].termination, null);
  // 没有登记项目时规划是空对象；清单里出现没登记的项目也不凭空造规划。
  assert.deepEqual(view.plans, {});
});

test('公开视图带上任务规划的追溯元数据：记录里写了 Task ID 和 spec 就原样带出', async t => {
  const home = await registry(t);
  await writeJson(join(home, 'jobs/traced/job.json'), job('traced', { plan: { taskId: 'TASK-006', spec: 'docs/tasks/TASK-006.md' } }));
  const view = await buildView();
  assert.deepEqual(view.jobs[0].plan, { taskId: 'TASK-006', spec: 'docs/tasks/TASK-006.md' });
  assert.deepEqual(Object.keys(view.jobs[0].plan!).sort(), ['spec', 'taskId']);
});

test('桌面视图保留批次归并、失联、验收失败、旧决定默认负责人和 24 小时边界', async t => {
  const home = await registry(t), now = Date.now();
  const jobs = [job('run', { state: 'running', pid: process.pid }), job('wait-a', { batch: 'wait' }), job('wait-b', { batch: 'wait' }),
    job('lost', { state: 'lost' }), job('used', { decision: { kind: 'adopt' } }),
    job('old', { decision: { kind: 'drop' }, ended: new Date(now - 90_000_000).toISOString() }),
    job('check', { verify: { ok: false, steps: [] } })];
  for (const j of jobs) await writeJson(join(home, 'jobs', j.id, 'job.json'), j);
  await writeJson(join(home, 'batches/wait.json'), { id: 'wait', jobs: ['wait-a', 'wait-b'], started: jobs[0].created });
  const view = await buildView();
  const columns = derive(view);
  assert.equal(columns.running.length, 1);
  assert.equal(columns.attention.length, 3);
  assert.equal(columns.done.length, 1);
  assert.equal(view.jobs.find(j => j.id === 'used')?.decision?.by, 'lead');
});

test('图标协议拒绝路径穿越、编码、符号链接目录和文件，只读 PNG', async t => {
  const home = await registry(t);
  const icons = join(home, 'icons'); await mkdir(icons, { recursive: true });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  await writeAtomic(join(icons, 'codex.png'), png);
  assert.deepEqual(Buffer.from(await readIcon('xa-icon://icons/codex.png', home)), png);
  for (const url of ['xa-icon://icons/../secret.png', 'xa-icon://icons/%2e%2e/secret.png', 'xa-icon://icons/a%2fb.png',
    'xa-icon://other/codex.png', 'xa-icon://icons/codex.png?x', 'file:///secret.png', 'xa-icon://icons/x.svg']) {
    await assert.rejects(readIcon(url, home));
  }
  await writeAtomic(join(home, 'outside.png'), png);
  await symlink(join(home, 'outside.png'), join(icons, 'escape.png'));
  await assert.rejects(readIcon('xa-icon://icons/escape.png', home));
  await rm(icons, { recursive: true }); await symlink(home, icons);
  await assert.rejects(readIcon('xa-icon://icons/outside.png', home));
});

test('安全白名单：拒绝外部进程、子 frame 和页面伪造，只允许 HTTPS 外链', async () => {
  assert.deepEqual(securePreferences, { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true });
  assert.equal(httpsLink('https://example.invalid/page'), 'https://example.invalid/page');
  for (const url of ['http://example.invalid', 'javascript:alert(1)', 'file:///tmp/x', 'https://user:password@example.invalid']) assert.equal(httpsLink(url), null);
  const mainFrame = { url: 'file:///app/index.html' }, webContents = { mainFrame };
  const window = { webContents, isDestroyed: () => false } as unknown as BrowserWindow;
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  assert.equal(trustedSender(event, window, mainFrame.url), true);
  assert.equal(trustedSender(event, null, mainFrame.url), false);
  assert.equal(trustedSender({ ...event, sender: {} } as IpcMainInvokeEvent, window, mainFrame.url), false);
  assert.equal(trustedSender({ ...event, senderFrame: { url: mainFrame.url } } as IpcMainInvokeEvent, window, mainFrame.url), false);
  assert.equal(trustedSender(event, window, 'file:///other.html'), false);
  // 本地页面按文件比：转义写法不同、Windows 上大小写不同都是同一个文件；别的文件、带查询串或 #、别的协议都不认。
  const page = 'file:///C:/Users/RUNNER~1/AppData/Local/Temp/xa%20win/%E4%B8%AD%E6%96%87%20App%20&%20tools/captain-agents/resources/app.asar/out/renderer/index.html';
  const node = 'file:///C:/Users/RUNNER%7E1/AppData/Local/Temp/xa%20win/%E4%B8%AD%E6%96%87%20App%20&%20tools/captain-agents/resources/app.asar/out/renderer/index.html';
  assert.equal(samePage(page, node, true), true);
  assert.equal(samePage(page.replace('C:/Users', 'c:/users'), node, true), true);
  assert.equal(samePage(page.replace('C:/Users', 'c:/users'), node, false), false, 'macOS 上大小写不同算两个文件');
  for (const other of [page.replace('index.html', 'other.html'), page + '?x=1', page + '#a', page.replace('file:', 'https:'), 'file://host/C:/x/index.html', undefined]) assert.equal(samePage(other, node, true), false);
  assert.equal(samePage('file:///Users/a/%E4%B8%AD%E6%96%87/index.html', 'file:///Users/a/中文/index.html', false), true);
  const html = await readFile(resolve('app/renderer/index.html'), 'utf8');
  assert.ok(html.includes(productionCsp));
  assert.doesNotMatch(productionCsp, /unsafe-inline|unsafe-eval|https?:/);
});

test('窗口大小存在独立用户目录，损坏设置回退', async t => {
  const home = await registry(t), userData = join(home, 'electron');
  await saveBounds(userData, { x: 40, y: 50, width: 1000, height: 700 });
  assert.deepEqual(await loadBounds(userData), { x: 40, y: 50, width: 1000, height: 700 });
  await writeJson(join(userData, 'window.json'), { width: 10, height: 2 });
  assert.deepEqual(await loadBounds(userData), { width: 1120, height: 760 });
});

test('递归监视单元测试：合并连续变更，无窗口时不计算，关闭后不再推送', async t => {
  const home = await registry(t);
  let opened = false, reads = 0, published = 0;
  const errors: unknown[] = [];
  // 沙箱里的 macOS FSEvents 可能返回 EMFILE；这里用事件替身验证调度，真实 fs.watch 由 Electron 冒烟验证。
  const events = new Map<string, () => void>();
  let closed = 0;
  const close = await watchRegistry(() => opened, () => published++, error => errors.push(error), async () => { reads++; return buildView(); },
    (directory, options, changed) => {
      assert.equal(options.recursive, true); events.set(directory, changed);
      return Object.assign(new EventEmitter(), { close() { closed++; } }) as FSWatcher;
    });
  assert.deepEqual([...events.keys()], ['jobs', 'batches', 'cache', 'teams', 'chats'].map(dir => join(home, dir)));
  t.after(close);
  await writeJson(join(home, 'jobs/one/job.json'), job('one'));
  events.get(join(home, 'jobs'))!();
  await sleep(450); assert.equal(reads, 0);
  opened = true;
  for (let i = 0; i < 3; i++) {
    await writeJson(join(home, 'jobs/one/job.json'), job('one', { title: String(i) }));
    events.get(join(home, 'jobs'))!();
  }
  await until(async () => published, value => value === 1, 2000);
  assert.equal(reads, 1);
  await writeJson(join(home, 'cache/quota.json'), {});
  events.get(join(home, 'cache'))!();
  await until(async () => published, value => value === 2, 2000);
  await writeJson(join(home, 'batches/b.json'), { id: 'b', jobs: ['one'], started: new Date().toISOString() });
  events.get(join(home, 'batches'))!();
  await until(async () => published, value => value === 3, 2000);
  events.get(join(home, 'teams'))!();
  await until(async () => published, value => value === 4, 2000);
  events.get(join(home, 'chats'))!();
  await until(async () => published, value => value === 5, 2000);
  close();
  assert.equal(closed, 5);
  await writeJson(join(home, 'jobs/one/job.json'), job('one'));
  events.get(join(home, 'jobs'))!();
  await sleep(450); assert.equal(published, 5); assert.deepEqual(errors, []);
});

test('buildView：每件活带项目名和打分（只有当前一版、标签好坏由核心分好），项目名单合并登记处和任务里出现的，读取不落盘', async t => {
  const home = await registry(t);
  await writeJson(join(home, 'projects/画布.json'), { name: '画布', repo: '/unused' });
  await writeJson(join(home, 'projects/没活的项目.json'), { name: '没活的项目', repo: '/unused' });
  const at = new Date().toISOString();
  const rated = job('rated', { project: '派活工作台', rating: { score: 4, good: '一次做对', improve: '偏慢', tags: ['一次做对', '偏慢', '别的'], at, by: 'lead',
    previous: [{ score: 2, tags: ['需要返工'], at, by: 'lead' }] } });
  const external = job('external', { project: '画布', rating: { external: '网络不好', tags: [], at, by: 'lead' } });
  const plain = job('plain', { project: '画布' });
  for (const j of [rated, external, plain]) await writeJson(join(home, 'jobs', j.id, 'job.json'), j);
  const before = (await readdir(home, { recursive: true })).sort();
  const view = await buildView();
  assert.deepEqual(view.projects, [{ name: '没活的项目', label: '没活的项目', repo: '/unused', archived: false }, { name: '派活工作台', label: '派活工作台', repo: undefined, archived: false }, { name: '画布', label: '画布', repo: '/unused', archived: false }].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));
  const byId = (id: string) => view.jobs.find(j => j.id === id)!;
  assert.equal(byId('rated').project, '派活工作台'); assert.equal(byId('plain').project, '画布');
  assert.deepEqual(byId('rated').rating, { score: 4, good: '一次做对', improve: '偏慢', at,
    tags: [{ tag: '一次做对', kind: 'good' }, { tag: '偏慢', kind: 'bad' }, { tag: '别的', kind: 'other' }] }, '不带改分前的历史，不带 by');
  assert.deepEqual(byId('external').rating, { external: '网络不好', at, tags: [] });
  assert.equal(byId('plain').rating, null);
  assert.deepEqual((await readdir(home, { recursive: true })).sort(), before, '读取不写文件');
});
test('buildView：老记录没有 project 字段也不出错，项目名是空串', async t => {
  const home = await registry(t);
  const { project: _unused, ...old } = job('old'); void _unused;
  await writeJson(join(home, 'jobs/old/job.json'), old);
  const view = await buildView();
  assert.equal(view.jobs[0].project, ''); assert.deepEqual(view.projects, []);
});

test('设置校验：storage 开关和天数（7、14、30）都对才收，天数不对、缺字段、多字段、格式不对一律拒绝', () => {
  for (const days of slimDays) for (const slim of [true, false]) assert.deepEqual(settingsPatch({ storage: { slim, days } }), { storage: { slim, days } });
  assert.deepEqual(settingsPatch({ storage: { slim: false, days: 30 }, keepAwake: false }), { storage: { slim: false, days: 30 }, keepAwake: false });
  const bad: unknown[] = [
    { slim: true, days: 10 }, { slim: true, days: 0 }, { slim: true, days: -7 }, { slim: true, days: '14' }, { slim: true, days: 14.5 }, { slim: true, days: null }, { slim: true, days: 365 },
    { slim: 'yes', days: 14 }, { slim: 1, days: 14 }, { slim: true }, { days: 14 }, {},
    { slim: true, days: 14, extra: 1 }, { slim: true, days: 14, force: true },
    null, undefined, 'on', 14, true, [], [{ slim: true, days: 14 }], Object.create({ slim: true, days: 14 }),
  ];
  for (const storage of bad) assert.throws(() => settingsPatch({ storage }), /自动清理/, JSON.stringify(storage));
  assert.throws(() => settingsPatch({ storage: { slim: true, days: 14 }, slimDays: 14 }), /不认识/, '别的没见过的字段照旧拒绝');
  assert.throws(() => settingsPatch({ slim: true, days: 14 }), /不认识/);
  assert.equal(JSON.stringify(SLIM_CHOICES), JSON.stringify(slimDays), '设置页的天数选项和核心的 slimDays 是同一组');
});
test('设置校验：archivedProjects 须为合法项目名的数组，最多 200 个；不是数组、坏名字、超过 200 个、未知字段都拒绝', async () => {
  assert.deepEqual(settingsPatch({ archivedProjects: ['画布', '派活工作台'] }), { archivedProjects: ['画布', '派活工作台'] });
  assert.deepEqual(settingsPatch({ archivedProjects: [] }), { archivedProjects: [] });
  assert.deepEqual(settingsPatch({ archivedProjects: ['项目_A', 'canvas-1', '甲'] }), { archivedProjects: ['项目_A', 'canvas-1', '甲'] });
  assert.deepEqual(settingsPatch({ archivedProjects: ['a'.repeat(64), '项'.repeat(64)] }), { archivedProjects: ['a'.repeat(64), '项'.repeat(64)] });
  assert.deepEqual(settingsPatch({ archivedProjects: ['画布', '画布'] }), { archivedProjects: ['画布', '画布'] }, '重复的名字这里收下，写盘时由核心去重');
  assert.equal(settingsPatch({ archivedProjects: Array.from({ length: 200 }, (_, i) => 'n' + i) }).archivedProjects?.length, 200);
  assert.deepEqual(settingsPatch({ archivedProjects: ['画布'], keepAwake: false }), { archivedProjects: ['画布'], keepAwake: false });
  for (const value of [null, undefined, {}, '画布', 1, true, { length: 1, 0: '画布' }]) assert.throws(() => settingsPatch({ archivedProjects: value }), /归档名单/, JSON.stringify(value));
  const hole: unknown[] = []; hole[1] = '画布';
  for (const name of ['', '.', '..', 'a b', 'a/b', '../x', 'a.b', 'a'.repeat(65), '名 字', 1, null, undefined]) assert.throws(() => settingsPatch({ archivedProjects: [name] }), /名字不合法/, JSON.stringify(name));
  assert.throws(() => settingsPatch({ archivedProjects: hole }), /名字不合法/);
  assert.throws(() => settingsPatch({ archivedProjects: Array.from({ length: 201 }, (_, i) => 'n' + i) }), /最多 200/);
  assert.throws(() => settingsPatch({ archivedProjects: ['画布'], extra: 1 }), /不认识/);
  assert.throws(() => settingsPatch({ archived: ['画布'] }), /不认识/);
  const writes: unknown[] = [];
  const base = { keepAwake: true, notifications: true, appearance: 'system' as const, storage: { slim: true, days: 14 as const }, workers: effectiveWorkers(undefined) };
  const actions = settingsActions({ readSettings: async () => base, writeSettings: async patch => { writes.push(patch); }, getLogin: () => false, setLogin: () => {} }, async () => {});
  await actions.set([{ archivedProjects: ['画布', '派活工作台'] }]);
  assert.deepEqual(writes, [{ archivedProjects: ['画布', '派活工作台'] }]);
  await assert.rejects(actions.set([{ archivedProjects: '画布' }]), /归档名单/);
  await assert.rejects(actions.set([{ archivedProjects: ['a b'] }]), /名字不合法/);
  await assert.rejects(actions.set([{ archivedProjects: Array.from({ length: 201 }, (_, i) => 'n' + i) }]), /最多 200/);
  await assert.rejects(actions.set([{ archivedProjects: ['画布'], extra: 1 }]), /不认识/);
  assert.deepEqual(writes, [{ archivedProjects: ['画布', '派活工作台'] }], '校验没过不写');
});
test('设置保存：storage 写进去之后才立刻清理一次；保存失败、没改 storage 时不清理；读设置带着 storage', async () => {
  let cleaned = 0, fail = false;
  const base = { keepAwake: true, notifications: true, appearance: 'system' as const, storage: { slim: true, days: 14 as const }, workers: effectiveWorkers(undefined) };
  const writes: unknown[] = [];
  const actions = settingsActions({ readSettings: async () => base, writeSettings: async patch => { if (fail) throw new Error('存不了'); writes.push(patch); }, getLogin: () => false, setLogin: () => {}, storageChanged: () => { cleaned++; } }, async () => {});
  assert.deepEqual((await actions.get([])).storage, { slim: true, days: 14 });
  await actions.set([{ storage: { slim: false, days: 30 } }]);
  assert.deepEqual(writes, [{ storage: { slim: false, days: 30 } }]); assert.equal(cleaned, 1);
  await actions.set([{ notifications: false }]); assert.equal(cleaned, 1, '没改 storage 不清理');
  await assert.rejects(actions.set([{ storage: { slim: true, days: 10 } }]), /自动清理/); assert.equal(cleaned, 1); assert.equal(writes.length, 2, '校验没过不写');
  fail = true;
  await assert.rejects(actions.set([{ storage: { slim: true, days: 7 } }]), /存不了/); assert.equal(cleaned, 1, '保存失败不清理');
});
test('定时清理：启动 1 分钟后一次，之后每 6 小时一次；现在就清理；同时只跑一次；出错只交给日志；退出时清掉定时器', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  let runs = 0, release: (() => void) | undefined, fail = false, hold = false;
  const errors: unknown[] = [];
  const scheduler = slimScheduler({
    run: async () => { runs++; if (fail) throw new Error('清不了'); if (hold) await new Promise<void>(resolve => { release = resolve; }); },
    onError: error => { errors.push(error); },
  });
  assert.equal(SLIM_FIRST_MS, 60_000); assert.equal(SLIM_EVERY_MS, 6 * 3600_000);
  scheduler.start(); scheduler.start();
  t.mock.timers.tick(SLIM_FIRST_MS - 1); await settle(); assert.equal(runs, 0, '不到 1 分钟不跑');
  t.mock.timers.tick(1); await settle(); assert.equal(runs, 1, '启动 1 分钟后跑第一次');
  t.mock.timers.tick(SLIM_EVERY_MS - 1); await settle(); assert.equal(runs, 1);
  t.mock.timers.tick(1); await settle(); assert.equal(runs, 2, '之后每 6 小时一次');
  t.mock.timers.tick(SLIM_EVERY_MS); await settle(); assert.equal(runs, 3);
  await scheduler.now(); assert.equal(runs, 4, '改设置：立刻一次');
  // 正在跑时又改了设置：不并行，等这次跑完再补一次。
  hold = true;
  const first = scheduler.now(); await settle(); assert.equal(runs, 5);
  void scheduler.now(); void scheduler.now(); await settle(); assert.equal(runs, 5, '正在跑，不并行');
  hold = false; release!(); await first; await settle(); await settle(); assert.equal(runs, 6, '跑完后补一次，让新设置生效');
  // 出错：只交给 onError，不抛出、不影响下一次。
  fail = true; await scheduler.now(); assert.equal(errors.length, 1); assert.match(String(errors[0]), /清不了/);
  fail = false; await scheduler.now(); assert.equal(errors.length, 1);
  const after = runs;
  scheduler.stop();
  t.mock.timers.tick(SLIM_EVERY_MS * 3); await settle(); await scheduler.now(); assert.equal(runs, after, '退出后不再跑');
});
test('定时清理：退出前还没到 1 分钟，定时器也被清掉，一次都不跑', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let runs = 0;
  const scheduler = slimScheduler({ run: async () => { runs++; }, onError: () => {} });
  scheduler.start(); scheduler.stop();
  t.mock.timers.tick(SLIM_FIRST_MS + SLIM_EVERY_MS); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(runs, 0);
});

test('表现页的时间范围选项和核心 dashboard.ts 是同一组（窗口里不直接引核心那份）', () => {
  assert.deepEqual(RANGE_CHOICES.map(r => [r.id, r.label]), ranges.map(r => [r, rangeLabel[r]]));
});

test('派活限制：设置页的选项和核心是同一组；主进程只收上限以内、两项齐全的值', () => {
  assert.deepEqual(RUN_CHOICES, Array.from({ length: LIMIT_CAPS.maxRunning }, (_, i) => i + 1));
  assert.deepEqual(STOP_CHOICES, [...quotaStops]); assert.deepEqual(STOP_CHOICES, [50, 60, 70, 80, 90, null]);
  assert.deepEqual(settingsPatch({ limits: { maxRunning: 3, quotaStop: 60 } }), { limits: { maxRunning: 3, quotaStop: 60 } });
  assert.deepEqual(settingsPatch({ limits: { maxRunning: 12, quotaStop: 80 } }), { limits: { maxRunning: 12, quotaStop: 80 } });
  for (const bad of [{ maxRunning: 13, quotaStop: 80 }, { maxRunning: 0, quotaStop: 80 }, { maxRunning: 2.5, quotaStop: 80 }, { maxRunning: 3, quotaStop: 100 }, { maxRunning: 3, quotaStop: 55 }, { maxRunning: 3 }, { maxRunning: 3, quotaStop: 60, extra: 1 }, [3, 60], null]) {
    assert.throws(() => settingsPatch({ limits: bad }), JSON.stringify(bad));
  }
});

test('小队桥登记在白名单里，主进程先 guard 再校验；通知标题用题目', async () => {
  assert.equal(channels.teamSay, 'xa:team-say');
  assert.equal(channels.teamStop, 'xa:team-stop');
  const main = await readFile(resolve('app/main/index.ts'), 'utf8');
  assert.match(main, /ipcMain\.handle\(channels\.teamSay, async \(event, \.\.\.args: unknown\[\]\) => \{ guard\(event\); await teamBridge\('say', args\); \}\)/);
  assert.match(main, /ipcMain\.handle\(channels\.teamStop, async \(event, \.\.\.args: unknown\[\]\) => \{ guard\(event\); await teamBridge\('stop', args\); \}\)/);
  assert.match(main, /new Notification\(\{ title: noticeTitle\(notice\), body: notice.body \}\)/);
  assert.equal(noticeTitle({ key: 'k', title: '题目', body: '正文', target: { kind: 'team', id: 't' } }), '题目');
  assert.equal(noticeTitle({ key: 'k', title: '', body: '正文', target: { kind: 'team', id: 't' } }), '派活工作台');
  assert.equal(noticeTitle({ key: 'k', body: '正文', target: { kind: 'job', id: 'j' } }), '派活工作台');
});

test('小队桥：拒绝非字符串、空、超长和不合 safeName 的参数，不调用核心', async () => {
  const said: unknown[][] = [], stopped: unknown[] = [];
  const actions = teamActions({
    say: async (id, text, by) => { said.push([id, text, by]); },
    stop: async id => { stopped.push(id); },
    checkText: cleanComment,
  });
  const badSay: unknown[][] = [
    [], ['队'], ['队', '你好', '多'], [1, '你好'], [null, '你好'], [{}, '你好'], [true, '你好'],
    ['', '你好'], [' ', '你好'], ['.', '你好'], ['..', '你好'], ['../x', '你好'], ['a/b', '你好'], ['a b', '你好'], ['队。1', '你好'],
    ['x'.repeat(201), '你好'], ['队', 1], ['队', null], ['队', ''], ['队', '   '], ['队', 'a\u0000b'], ['队', '文'.repeat(501)],
  ];
  for (const args of badSay) await assert.rejects(actions('say', args), `不该收下 ${JSON.stringify(args)}`);
  const badStop: unknown[][] = [[], ['队', '多'], [1], [null], [''], ['..'], ['.'], ['x'.repeat(201)], ['a/b'], [' ']];
  for (const args of badStop) await assert.rejects(actions('stop', args), `不该停下 ${JSON.stringify(args)}`);
  assert.deepEqual(said, []); assert.deepEqual(stopped, []);
  await actions('say', ['a'.repeat(200), '  你好\n世界  ']);
  await actions('stop', ['队-1']);
  assert.deepEqual(said, [['a'.repeat(200), '你好\n世界', 'owner']]);
  assert.deepEqual(stopped, ['队-1']);
});

test('小队桥：同一队说话和收场互斥，失败后释放', async () => {
  let finish: (() => void) | undefined;
  const actions = teamActions({
    say: () => new Promise<void>(resolve => { finish = resolve; }),
    stop: async () => {},
    checkText: cleanComment,
  });
  const pending = actions('say', ['队', '一']);
  await Promise.resolve();
  await assert.rejects(actions('stop', ['队']), /正在处理/);
  await assert.rejects(actions('say', ['队', '二']), /正在处理/);
  await actions('stop', ['另一队']);
  finish!(); await pending;
  let fail = true;
  const again = teamActions({
    say: async () => { if (fail) throw new Error('失败'); },
    stop: async () => {},
    checkText: cleanComment,
  });
  await assert.rejects(again('say', ['队', '三']), /失败/);
  fail = false;
  await again('say', ['队', '四']);
  await again('stop', ['队']);
});

test('小队桥：主人的话写入频道，收场按签名调用 stopTeam', async t => {
  const home = await registry(t);
  const id = '1010-1200-pair';
  const record: Team = {
    id, mode: 'pair', project: 'xagents', repo: '/repo', base: 'abc', kind: '实现', title: '题目', summary: '说明', task: '题',
    writer: { who: 'grok', effort: 'high' }, reviewer: { who: 'deepseek', effort: 'high' },
    round: 2, phase: 'review', maxRounds: 3, maxMinutes: 60, state: 'running', created: '2026-10-10T00:00:00.000Z',
  };
  await writeJson(join(home, 'teams', id, 'team.json'), record);
  const actions = teamActions({ say: sayInTeam, stop: stopTeam, checkText: cleanComment });
  await actions('say', [id, '  主人说一句  ']);
  const list = (await readFile(join(home, 'teams', id, 'channel.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { from: string; kind: string; text: string; round: number });
  assert.equal(list.length, 1);
  assert.equal(list[0].from, 'owner'); assert.equal(list[0].kind, 'say'); assert.equal(list[0].text, '主人说一句'); assert.equal(list[0].round, 2);
  await actions('stop', [id]);
  assert.equal((JSON.parse(await readFile(join(home, 'teams', id, 'team.json'), 'utf8')) as Team).state, 'ended');
});

test('群聊桥参数先检查：类型、长度、安全名字、成员写法、白名单字段', async () => {
  const calls: unknown[] = [];
  const actions = chatActions({ create: async o => { calls.push(o); return { id: 'new-chat' }; }, say: async (...args) => { calls.push(args); }, stop: async id => { calls.push(id); }, rename: async (...args) => { calls.push(args); } });
  for (const args of [[], [null], [[]], [{ project: '../bad', members: ['grok:high'] }], [{ project: 'p', members: ['grok:high'], network: true }],
    [{ project: 'p', members: [] }], [{ project: 'p', members: ['grok:high:ro:fast'] }], [{ project: 'p', members: ['cursor-grok:max'] }],
    [{ project: 'p', members: ['not-a-worker:high'] }], [{ project: 'p', members: ['cursor-sonnet:high:fast'] }],
    [{ project: 'p', members: ['grok:high'], title: 'x'.repeat(101) }], [{ project: 'p', members: ['grok:high', 'grok:high'] }]]) await assert.rejects(actions('create', args));
  for (const args of [[1, 'text'], ['../bad', 'text'], ['x'.repeat(201), 'text'], ['id', null], ['id', ''], ['id', 'x'.repeat(2001)], ['id', 'a\tb'], ['id'], ['id', 'a', 'extra']]) await assert.rejects(actions('say', args));
  for (const args of [[], [null], ['../bad'], ['id', 'extra']]) await assert.rejects(actions('stop', args));
  assert.equal(calls.length, 0);
  assert.equal(await actions('create', [{ project: 'p', title: '群', members: ['grok:high:fast:ro'] }]), 'new-chat');
  // Cursor 的合法成员写法通过桥，交给核心。Windows 上不派 Cursor 由平台准入测试保证，不在这里按名字拒绝。
  assert.equal(await actions('create', [{ project: 'p', members: ['cursor-grok:high:fast', 'cursor-opus:high:ro'] }]), 'new-chat');
  assert.deepEqual(calls[1], { project: 'p', title: undefined, members: ['cursor-grok:high:fast', 'cursor-opus:high:ro'] });
  await actions('say', ['id', '  主人的话\r\n第二行  ']);
  assert.deepEqual(calls[2], ['id', '主人的话\n第二行', 'owner']);
  await actions('stop', ['id']); assert.equal(calls[3], 'id');
  // 改名：两个参数，群名 1–100 字、不能含控制字符，去掉首尾空白后交给核心
  for (const args of [['id'], ['id', ''], ['id', '   '], ['id', 'x'.repeat(101)], ['id', 'a\nb'], ['../bad', '名字'], ['id', 5], ['id', 'a', 'b']]) await assert.rejects(actions('rename', args));
  await actions('rename', ['id', '  新名字  ']); assert.deepEqual(calls[4], ['id', '新名字']);
  assert.equal(channels.chatRename, 'xa:chat-rename');
  assert.equal(channels.chatCreate, 'xa:chat-create'); assert.equal(channels.chatSay, 'xa:chat-say'); assert.equal(channels.chatStop, 'xa:chat-stop');
  const main = await readFile(new URL('../app/main/index.ts', import.meta.url), 'utf8');
  for (const action of ['Create', 'Say', 'Stop', 'Rename']) assert.match(main, new RegExp(`ipcMain\\.handle\\(channels\\.chat${action}, async \\(event, \\.\\.\\.args: unknown\\[\\]\\) => \\{ guard\\(event\\);`));
});

test('群聊桥同群并发拦截，失败后释放锁', async () => {
  let release!: () => void;
  const actions = chatActions({ create: async () => ({ id: 'new' }), say: async () => new Promise<void>(resolve => { release = resolve; }), stop: async () => { throw new Error('测试故障'); }, rename: async () => {} });
  const waiting = actions('say', ['id', '消息']);
  await assert.rejects(actions('stop', ['id']), /正在处理/);
  release(); await waiting;
  await assert.rejects(actions('stop', ['id']), /测试故障/);
  await assert.rejects(actions('stop', ['id']), /测试故障/);
});

test('规划派发桥参数先检查：白名单字段、项目标识、任务号、选手写法，非法请求不进核心', async () => {
  const calls: unknown[] = [];
  const actions = planActions({ dispatch: async input => { calls.push(input); return [{ id: 'job-1' }, { id: 'job-2' }]; } });
  for (const args of [[], [null], [[]], [{ project: 'p', taskId: 'TASK-001' }], [{ project: 'p', taskId: 'TASK-001', who: [], ro: true }],
    [{ project: 'p', taskId: 'TASK-001', who: ['codex:high'], ro: 'yes' }], [{ project: 'p', taskId: 'TASK-001', who: ['codex:high'], extra: 1 }],
    [{ project: '../bad', taskId: 'TASK-001', who: ['codex:high'] }], [{ project: 'p', taskId: 'task-001', who: ['codex:high'] }],
    [{ project: 'p', taskId: 'TASK-001', who: ['codex:high', 5] }], [{ project: 'p', taskId: 'TASK-001', who: ['codex:high'.padEnd(101, 'x')] }]]) {
    await assert.rejects(actions(args));
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(await actions([{ project: 'p', taskId: 'TASK-001', who: ['codex:high', 'grok:xhigh:fast'] }]), ['job-1', 'job-2']);
  assert.deepEqual(calls[0], { project: 'p', taskId: 'TASK-001', who: ['codex:high', 'grok:xhigh:fast'] });
  assert.deepEqual(await actions([{ project: 'p', taskId: 'TASK-002', who: ['codex:high'], ro: true }]), ['job-1', 'job-2']);
  assert.deepEqual(calls[1], { project: 'p', taskId: 'TASK-002', who: ['codex:high'], ro: true });
  assert.equal(channels.planDispatch, 'xa:plan-dispatch');
  // 主进程先验来源再交给专用动作、成功后发布新 View；preload 只转发这一个对象。
  const main = await readFile(resolve('app/main/index.ts'), 'utf8');
  assert.match(main, /ipcMain\.handle\(channels\.planDispatch, async \(event, \.\.\.args: unknown\[\]\) => \{\s*guard\(event\);\s*const ids = await planBridge\(args\);\s*publish\(await readDesktopView\(\)\);\s*return ids;\s*\}\)/);
  const preload = await readFile(resolve('app/preload/index.ts'), 'utf8');
  assert.match(preload, /planDispatch: input => ipcRenderer\.invoke\(channels\.planDispatch, input\)/);
});

test('规划派发桥同任务并发拦截，失败后释放锁', async () => {
  // 第一次派发故意悬着，验证同一任务此刻的第二次请求被拦；放行之后再派同一任务必须能正常走完（锁已释放）。
  let release!: () => void, calls = 0;
  const actions = planActions({ dispatch: async () => {
    calls++;
    if (calls === 1) return new Promise<{ id: string }[]>(resolve => { release = () => resolve([{ id: 'job' }]); });
    return [{ id: 'job' }];
  } });
  const waiting = actions([{ project: 'p', taskId: 'TASK-001', who: ['codex:high'] }]);
  await assert.rejects(actions([{ project: 'p', taskId: 'TASK-001', who: ['codex:high'] }]), /正在派发/);
  release(); assert.deepEqual(await waiting, ['job']);
  const again = await actions([{ project: 'p', taskId: 'TASK-001', who: ['codex:high'] }]);
  assert.deepEqual(again, ['job']);
});

test('打开 Task Spec 桥参数先检查：白名单字段、项目标识、路径类型与长度，非法请求不进核心', async () => {
  const calls: unknown[] = [];
  const actions = planSpecActions({ open: async input => { calls.push(input); } });
  for (const args of [[], [null], [[]], [{ project: 'p' }], [{ spec: 'docs/tasks/TASK-001.md' }], [{ project: 'p', spec: '' }],
    [{ project: 'p', spec: 5 }], [{ project: 'p', spec: 'docs/tasks/TASK-001.md', repo: '/etc/passwd' }],
    [{ project: 'p', spec: 'docs/tasks/TASK-001.md', extra: true }], [{ '../bad': 'p', project: 'p', spec: 'docs/tasks/TASK-001.md' }],
    [{ project: 'p', spec: `/abs/${'x'.repeat(300)}.md` }], [{ project: 'p', spec: 'docs/tasks/TASK-001.md' }, 1]]) {
    await assert.rejects(actions(args));
  }
  assert.equal(calls.length, 0);
  // 只把项目名和仓库内相对路径交给核心；窗口交不进任何路径字段。
  await actions([{ project: 'p', spec: 'docs/tasks/TASK-001.md' }]);
  assert.deepEqual(calls, [{ project: 'p', spec: 'docs/tasks/TASK-001.md' }]);
  assert.equal(channels.planSpec, 'xa:plan-spec');
  // 主进程先验来源，再交给核心解析真实文件（不是把窗口给的字符串直接丢给系统打开）。
  const main = await readFile(resolve('app/main/index.ts'), 'utf8');
  assert.match(main, /ipcMain\.handle\(channels\.planSpec, async \(event, \.\.\.args: unknown\[\]\) => \{ guard\(event\); await planSpecBridge\(args\); \}\)/);
  assert.match(main, /const file = await resolveTaskSpec\(input\.project, input\.spec\);\s*const failed = await shell\.openPath\(file\);/);
  const preload = await readFile(resolve('app/preload/index.ts'), 'utf8');
  assert.match(preload, /planOpenSpec: input => ipcRenderer\.invoke\(channels\.planSpec, input\)/);
});

// 项目登记桥（docs/tasks/TASK-001.md）：用真的临时 Git 仓库、真的核心 addProject/checkProject，只把系统选择器换成替身。
type ProjectCtx = Awaited<ReturnType<typeof context>>;
async function projectCore(t: TestContext, repository = true) {
  const c = await context(t, repository), before = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (before === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = before; });
  await ensureHome();
  return c;
}
function projectBridge(c: ProjectCtx, choose: () => Promise<string | null>, extra: Partial<Parameters<typeof projectActions>[0]> = {}, options: Parameters<typeof projectActions>[1] = {}) {
  const views: Awaited<ReturnType<typeof buildView>>[] = [];
  const actions = projectActions({
    chooseFolder: choose,
    realpath, git, addProject,
    checkProject: name => checkProject(name, { quick: true }),
    updated: async () => { views.push(await buildView()); },
    ...extra,
  }, options);
  return { actions, views };
}

test('建议项目名：只留合法字符，生成不了返回 null 交给主人填', () => {
  assert.equal(suggestedProjectName('repo with spaces'), 'repo-with-spaces');
  assert.equal(suggestedProjectName('我的 项目'), '我的-项目');
  assert.equal(suggestedProjectName('...hello...'), 'hello');
  assert.equal(suggestedProjectName('-foo-'), 'foo');
  assert.equal(suggestedProjectName('a'.repeat(64)), 'a'.repeat(64));
  for (const folder of ['', '.', '..', '///', '...', 'a'.repeat(65)]) assert.equal(suggestedProjectName(folder), null, JSON.stringify(folder));
  assert.equal(suggestedProjectLabel('repo with spaces'), 'repo with spaces');
  assert.equal(suggestedProjectLabel('  我的项目  '), '我的项目');
  for (const folder of ['', ' ', '名'.repeat(21), 'a\nb']) assert.equal(suggestedProjectLabel(folder), null, JSON.stringify(folder));
});

test('项目选择：取消返回 null、非 Git 拒绝、Git 仓库解析真实顶层并给出建议名和一次性令牌', async t => {
  const c = await projectCore(t);
  let next: string | null = c.repo;
  const { actions } = projectBridge(c, async () => next);
  const chosen = await actions.choose([], 1);
  assert.ok(chosen);
  assert.equal(chosen.repo, c.repo);
  assert.equal(chosen.name, 'repo-with-spaces');
  assert.equal(chosen.label, 'repo with spaces');
  assert.ok(chosen.selectionId.length >= 32);
  assert.equal(actions.selections.size, 1);
  // 选仓库里的子目录也解析到顶层。
  await mkdir(join(c.repo, 'src'));
  next = join(c.repo, 'src');
  assert.equal((await actions.choose([], 1))?.repo, c.repo);
  // 通过符号链接选进来，记住的是真实路径。
  const link = join(c.temp, 'repo-link');
  await symlink(c.repo, link, 'junction');
  next = link;
  assert.equal((await actions.choose([], 1))?.repo, c.repo);
  assert.equal(actions.selections.size, 3);
  // 取消不是错误，也不留令牌。
  next = null;
  assert.equal(await actions.choose([], 1), null);
  assert.equal(actions.selections.size, 3);
  // 不是 Git 仓库：中文错误，不留令牌。
  const plain = join(c.temp, 'plain'); await mkdir(plain);
  next = plain;
  await assert.rejects(actions.choose([], 1), /不是 Git 仓库/);
  for (const args of [[1], ['x'], [null]]) await assert.rejects(actions.choose(args, 1), /不需要参数/);
  assert.equal(actions.selections.size, 3);
});

test('选择令牌：伪造、别的窗口、过期、重复使用都不行；填错内容不白丢令牌', async t => {
  const c = await projectCore(t);
  let clock = 1_000_000, serial = 0;
  const selections = projectSelections({ now: () => clock, randomId: () => `token-${++serial}` });
  const { actions, views } = projectBridge(c, async () => c.repo, {}, { selections });
  const first = await actions.choose([], 7);
  assert.ok(first);
  await assert.rejects(actions.register(['token-999', { name: '项目' }], 7), /失效/);
  // 别的窗口拿不走、也不会把令牌消费掉。
  await assert.rejects(actions.register([first.selectionId, { name: '项目' }], 8), /失效/);
  assert.equal(actions.selections.size, 1);
  for (const input of [null, [], 'x', { name: 'bad name' }, { name: '项目', repo: '/etc' }]) {
    await assert.rejects(actions.register([first.selectionId, input], 7));
  }
  assert.equal(actions.selections.size, 1, '内容不合格不消费令牌');
  clock += PROJECT_SELECTION_TTL_MS + 1;
  await assert.rejects(actions.register([first.selectionId, { name: '项目' }], 7), /失效/);
  assert.equal(actions.selections.size, 0, '过期的令牌顺手清掉');
  // 用过一次就没了；登记成功后发布的新 View 里能看到这个项目。
  const second = await actions.choose([], 7);
  assert.ok(second);
  const registered = await actions.register([second.selectionId, { name: '项目' }], 7);
  assert.equal(registered.project.name, '项目');
  await assert.rejects(actions.register([second.selectionId, { name: '另一个' }], 7), /失效/);
  assert.equal(views.length, 1);
  assert.ok(views[0].projects.some(project => project.name === '项目'));
  // 窗口关掉（隐藏）只清自己的令牌，别的窗口的还在。
  const a = await actions.choose([], 7), b = await actions.choose([], 9);
  assert.ok(a && b);
  actions.selections.forget(7);
  await assert.rejects(actions.register([a.selectionId, { name: '另一个' }], 7), /失效/);
  await actions.register([b.selectionId, { name: '另一个' }], 9);
});

test('项目登记：只收 name/label 并沿用核心默认配置，同名不覆盖，命令行原来的覆盖行为不变', async t => {
  const c = await projectCore(t);
  const { actions, views } = projectBridge(c, async () => c.repo);
  const token = await actions.choose([], 1);
  assert.ok(token);
  const result = await actions.register([token.selectionId, { name: '我的项目', label: '我的项目' }], 1);
  assert.equal(result.checkError, null);
  assert.equal(result.check?.ok, true);
  assert.deepEqual(result.project, { name: '我的项目', label: '我的项目', repo: c.repo });
  const saved = JSON.parse(await readFile(join(c.home, 'projects/我的项目.json'), 'utf8'));
  assert.deepEqual({ ...saved, check: undefined }, { name: '我的项目', label: '我的项目', repo: c.repo,
    worktreeRoot: '.claude/worktrees', setup: [], verify: [], denyReadExtra: [], check: undefined });
  assert.deepEqual(saved.check, result.check);
  assert.equal(views.length, 1);
  // 同名项目不静默覆盖。
  const again = await actions.choose([], 1);
  assert.ok(again);
  await assert.rejects(actions.register([again.selectionId, { name: '我的项目', label: '新名字' }], 1), /已经登记过/);
  assert.equal((await loadProject('我的项目')).label, '我的项目');
  // 命令行走的核心 addProject 仍是原来的覆盖行为。
  await addProject('我的项目', c.repo, { label: '命令行改的' });
  assert.equal((await loadProject('我的项目')).label, '命令行改的');
});

test('项目登记：真实快速体检不过也保留登记，并发布新 View', async t => {
  const c = await projectCore(t, false);
  await c.git(['init', '-b', 'main']);
  const { actions, views } = projectBridge(c, async () => c.repo);
  const token = await actions.choose([], 1);
  assert.ok(token);
  const result = await actions.register([token.selectionId, { name: '没提交' }], 1);
  assert.equal(result.check?.ok, false);
  assert.equal(result.checkError, null);
  assert.ok(result.check!.items.some(item => item.id === 'git' && item.status === 'fail'));
  assert.equal((await loadProject('没提交')).repo, c.repo);
  assert.equal(views.length, 1);
});

test('项目登记：快速体检本身出错也不回滚登记，原因结构化交回', async t => {
  const c = await projectCore(t);
  const { actions, views } = projectBridge(c, async () => c.repo, { checkProject: async () => { throw new Error('体检读不了'); } });
  const token = await actions.choose([], 1);
  assert.ok(token);
  const result = await actions.register([token.selectionId, { name: '体检出错' }], 1);
  assert.equal(result.check, null);
  assert.match(result.checkError!, /体检读不了/);
  assert.equal((await loadProject('体检出错')).repo, c.repo);
  assert.equal(views.length, 1, '体检出错也发布新 View');
});

test('执行预算：旧登记缺省 20/5/120，登记时校验范围，非法的在派活前拒绝', async t => {
  const c = await projectCore(t);
  // 旧登记（TASK-008 之前写的）没有 budget 字段：按缺省 20/5/120 读，正常派活。
  await writeJson(join(c.home, 'projects/旧项目.json'), { name: '旧项目', repo: c.repo, worktreeRoot: '.worktrees', setup: [], verify: [], denyReadExtra: [] });
  assert.deepEqual(projectBudget(await loadProject('旧项目')), { stallMinutes: 20, graceMinutes: 5, maxMinutes: 120 });
  // 登记时写入合法预算，原样读回。
  await addProject('新项目', c.repo, { worktreeRoot: '.worktrees', budget: { stallMinutes: 10, graceMinutes: 2, maxMinutes: 30 } });
  assert.deepEqual((await loadProject('新项目')).budget, { stallMinutes: 10, graceMinutes: 2, maxMinutes: 30 });
  assert.deepEqual(projectBudget(await loadProject('新项目')), { stallMinutes: 10, graceMinutes: 2, maxMinutes: 30 });
  // 范围非法：停滞只能在 10–60 分钟，总上限只能在 30–240 分钟且必须大于停滞加宽限。
  const badBudgets = [
    { stallMinutes: 5, graceMinutes: 5, maxMinutes: 120 },
    { stallMinutes: 61, graceMinutes: 5, maxMinutes: 120 },
    { stallMinutes: 20, graceMinutes: 0, maxMinutes: 120 },
    { stallMinutes: 20, graceMinutes: 5, maxMinutes: 25 },
    { stallMinutes: 20, graceMinutes: 5, maxMinutes: 241 },
    { stallMinutes: 10, graceMinutes: 5, maxMinutes: 15 },
    { stallMinutes: 20.5, graceMinutes: 5, maxMinutes: 120 },
    '20,5,120', null, [],
  ];
  for (const [i, budget] of badBudgets.entries()) {
    await assert.rejects(addProject(`坏${i}`, c.repo, { worktreeRoot: '.worktrees', budget: budget as Budget }), /执行预算不合法/);
  }
  // 登记之后被手改坏：派活前 projectBudget 把关拒绝，不悄悄按缺省放行。
  const file = join(c.home, 'projects/新项目.json');
  await writeJson(file, { ...(await loadProject('新项目')), budget: { stallMinutes: 20, graceMinutes: 5, maxMinutes: 20 } });
  await assert.rejects(async () => projectBudget(await loadProject('新项目')), /执行预算不合法/);
  // 命令行写法："停滞,宽限,总上限"分钟。
  assert.deepEqual(parseBudget('10,2,30'), { stallMinutes: 10, graceMinutes: 2, maxMinutes: 30 });
  for (const text of ['10,2', 'a,b,c', '10,2,15', '5,2,30']) await assert.rejects(async () => parseBudget(text), /预算|--budget/);
});

test('项目登记参数：严格白名单，仓库路径交不进来，非法请求不进核心', async t => {
  const c = await projectCore(t);
  const calls: unknown[][] = [];
  const { actions } = projectBridge(c, async () => c.repo, {
    addProject: async (...args: unknown[]) => { calls.push(args); throw new Error('不该写'); },
    checkProject: async () => { throw new Error('不该体检'); },
    updated: async () => { throw new Error('不该发布'); },
  });
  const token = await actions.choose([], 1);
  assert.ok(token);
  const bad: unknown[] = [
    null, undefined, [], 'x', 1, true, Object.create({ name: '项目' }),
    { name: 1 }, { name: '' }, { name: '.' }, { name: '..' }, { name: '../外面' }, { name: 'a b' }, { name: 'a/b' }, { name: 'a'.repeat(65) },
    { name: '项目', label: 1 }, { name: '项目', label: '' }, { name: '项目', label: '名'.repeat(21) }, { name: '项目', label: 'a\nb' },
  ];
  for (const input of bad) {
    await assert.rejects(actions.register([token.selectionId, input], 1), String(JSON.stringify(input)).slice(0, 80));
    assert.equal(actions.selections.size, 1, `内容不合格不消费令牌：${String(JSON.stringify(input)).slice(0, 40)}`);
  }
  for (const args of [[], [token.selectionId], [token.selectionId, { name: '项目' }, 1], [1, { name: '项目' }], [null, { name: '项目' }]]) await assert.rejects(actions.register(args, 1));
  assert.deepEqual(calls, []);
  // 全部合格才交给核心；仓库路径来自令牌，只转 createOnly 和可选 label。
  await assert.rejects(actions.register([token.selectionId, { name: '项目', label: '显示名' }], 1), /不该写/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['项目', c.repo, { createOnly: true, label: '显示名' }]);
  await assert.rejects(actions.register([token.selectionId, { name: '项目' }], 1), /失效/);
});

test('项目登记参数：窗口交不进路径、命令、规则或仓库路径，拒绝且不消费选择令牌', async t => {
  const c = await projectCore(t);
  const calls: unknown[][] = [];
  const { actions } = projectBridge(c, async () => c.repo, {
    addProject: async (...args: unknown[]) => { calls.push(args); throw new Error('不该写'); },
    checkProject: async () => { throw new Error('不该体检'); },
    updated: async () => { throw new Error('不该发布'); },
  });
  const token = await actions.choose([], 1);
  assert.ok(token);
  // 每一项都用“形状合法”的值，确保被拒的原因是字段本身不允许，而不是值不合法。
  const forbidden: [string, unknown][] = [
    ['worktreeRoot', { name: '项目', worktreeRoot: '.worktrees' }],
    ['setup', { name: '项目', setup: ['npm ci'] }],
    ['verify', { name: '项目', verify: ['npm test'] }],
    ['denyReadExtra', { name: '项目', denyReadExtra: ['.env'] }],
    ['rules', { name: '项目', rules: '/tmp/rules.md' }],
    ['repo', { name: '项目', repo: c.repo }],
    ['未知字段', { name: '项目', extra: true }],
  ];
  for (const [field, input] of forbidden) {
    await assert.rejects(actions.register([token.selectionId, input], 1), /不认识的字段/, field);
    assert.equal(actions.selections.size, 1, `${field} 被拒后不能消费令牌`);
  }
  assert.deepEqual(calls, []);
  // 令牌还在：换一个只有 name/label 的合法内容仍能登记。
  await assert.rejects(actions.register([token.selectionId, { name: '项目' }], 1), /不该写/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['项目', c.repo, { createOnly: true }]);
});

test('项目选择令牌库：清过期的、随机碰撞有兜底、清空', () => {
  let clock = 0, serial = 0;
  const store = projectSelections({ now: () => clock, ttlMs: 100, randomId: () => `id-${++serial}` });
  assert.equal(store.add({ repo: '/repo', name: 'a', label: 'a', sender: 1 }), 'id-1');
  assert.equal(store.size, 1);
  clock = 101;
  assert.equal(store.add({ repo: '/repo', name: 'b', label: 'b', sender: 1 }), 'id-2');
  assert.equal(store.size, 1, '新增时清掉过期的');
  store.forget(2); assert.equal(store.size, 1, '别的窗口关闭不影响');
  store.forget(1); assert.equal(store.size, 0);
  const fixed = projectSelections({ randomId: () => 'same' });
  fixed.add({ repo: '/a', name: null, label: null, sender: 1 });
  assert.throws(() => fixed.add({ repo: '/b', name: null, label: null, sender: 1 }), /生成选择令牌/);
  fixed.clear(); assert.equal(fixed.size, 0);
});

test('项目登记桥：通道在白名单里，主进程先验来源再交给专用动作，预加载只开放这两个方法', async () => {
  assert.equal(channels.projectChoose, 'xa:project-choose');
  assert.equal(channels.projectRegister, 'xa:project-register');
  const main = await readFile(resolve('app/main/index.ts'), 'utf8');
  assert.match(main, /ipcMain\.handle\(channels\.projectChoose, \(event, \.\.\.args: unknown\[\]\) => \{ guard\(event\); return projects\.choose\(args, event\.sender\.id\); \}\)/);
  assert.match(main, /ipcMain\.handle\(channels\.projectRegister, \(event, \.\.\.args: unknown\[\]\) => \{ guard\(event\); return projects\.register\(args, event\.sender\.id\); \}\)/);
  assert.match(main, /dialog\.showOpenDialog\(parent, options\)/);
  assert.match(main, /properties: \['openDirectory'\]/);
  const preload = await readFile(resolve('app/preload/index.ts'), 'utf8');
  assert.match(preload, /projectChoose: \(\) => ipcRenderer\.invoke\(channels\.projectChoose\)/);
  assert.match(preload, /projectRegister: \(selectionId, input\) => ipcRenderer\.invoke\(channels\.projectRegister, selectionId, input\)/);
});
