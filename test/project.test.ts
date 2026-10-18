import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addProject, loadProject, removeProject, updateProject, worktreePath } from '../src/core/project.ts';
import { ensureHome } from '../src/core/paths.ts';
import { context, exec, root } from './helpers.ts';
import { putChat, sampleChat } from './chat-helpers.ts';

test('副本路径逐层检查父目录：内部链接允许，嵌套链接不能逃出仓库', async t => {
  const c = await context(t, false);
  const project = { name: '测试', repo: c.repo, worktreeRoot: join('copies', 'nested'), setup: [], verify: [], denyReadExtra: [] };
  await mkdir(join(c.repo, 'copies'));
  await mkdir(join(c.repo, 'inside'));
  await symlink(join(c.repo, 'inside'), join(c.repo, 'copies', 'nested'), 'junction');
  assert.equal(await worktreePath(project, 'test'), join(c.repo, 'copies', 'nested', 'xa-test'));
  await rm(join(c.repo, 'copies', 'nested'));
  await symlink(c.temp, join(c.repo, 'copies', 'nested'), 'junction');
  await assert.rejects(worktreePath(project, 'test'), /符号链接指向了仓库外/);
  await assert.rejects(worktreePath(project, 'test/../../../../outside'), /副本目录必须在仓库内/);
});

for (const missing of [true, false]) {
  test(`自动识别项目跳过${missing ? '已删除的仓库目录' : '已不是 Git 仓库的目录'}`, async t => {
    const c = await context(t);
    assert.equal((await c.add()).code, 0);
    const stale = join(c.temp, 'stale');
    await mkdir(stale);
    const init = await exec('git', ['init', '-b', 'main', stale], c.temp, c.env);
    assert.equal(init.code, 0, init.stderr);
    const added = await c.cli(['project', 'add', 'a-stale', stale]);
    assert.equal(added.code, 0, added.stderr);
    await rm(missing ? stale : join(stale, '.git'), { recursive: true });
    const found = await exec(process.execPath, ['--input-type=module', '-e', `
      import { findProject } from ${JSON.stringify(pathToFileURL(join(root, 'src/core/project.ts')).href)};
      console.log((await findProject()).name);
    `], c.repo, c.env);
    assert.equal(found.code, 0, found.stderr);
    assert.equal(found.stdout.trim(), '测试');
  });
}

test('addProject：桌面登记用 createOnly 拒绝覆盖同名项目，命令行仍按原样覆盖', async t => {
  const c = await context(t), before = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (before === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = before; });
  await ensureHome();
  await addProject('测试', c.repo, { label: '第一次', worktreeRoot: '.worktrees', createOnly: true });
  assert.equal((await loadProject('测试')).label, '第一次');
  await assert.rejects(() => addProject('测试', c.repo, { label: '第二次', worktreeRoot: '.worktrees', createOnly: true }), /已经登记过/);
  assert.equal((await loadProject('测试')).label, '第一次', '同名项目没被覆盖');
  // 命令行原来就会重新登记并覆盖，行为保持不变。
  await addProject('测试', c.repo, { label: '第二次', worktreeRoot: '.worktrees' });
  assert.equal((await loadProject('测试')).label, '第二次');
});

// 造一件指定状态的任务记录（docs/tasks/TASK-003.md 移除登记的拒止条件用）。
const at = new Date().toISOString();
async function putJob(home: string, repo: string, id: string, project: string, extra: Record<string, unknown> = {}) {
  await mkdir(join(home, 'jobs', id), { recursive: true });
  await writeFile(join(home, 'jobs', id, 'job.json'), JSON.stringify({
    id, batch: `批-${id}`, project, repo, base: 'abc', worktree: repo, branch: `xa/${id}`,
    who: 'codex', model: 'm', effort: 'high', mode: 'workspace-write', kind: '实现', title: `题目 ${id}`, summary: '测试',
    state: 'done', created: at, started: at, ended: at, seconds: 60, ...extra,
  }));
}
async function home(t: TestContext) {
  const c = await context(t);
  const before = process.env.XAGENTS_HOME;
  process.env.XAGENTS_HOME = c.home;
  t.after(() => { if (before === undefined) delete process.env.XAGENTS_HOME; else process.env.XAGENTS_HOME = before; });
  await ensureHome();
  return c;
}

test('updateProject：只改提交的字段，体检结果、验收基线和未知兼容字段原样保留', async t => {
  const c = await home(t);
  await addProject('演示', c.repo, { worktreeRoot: '.worktrees' });
  const file = join(c.home, 'projects', '演示.json');
  const current = JSON.parse(await readFile(file, 'utf8'));
  current.check = { at: 'x', seconds: 1, items: [], ok: true };
  current.baseline = { at: 'x', ok: true, steps: [] };
  current.futureField = { keep: 'me' };
  await writeFile(file, JSON.stringify(current));
  const saved = await updateProject('演示', { label: '新名字', verify: ['npm test'] });
  assert.equal(saved.label, '新名字');
  assert.equal(saved.worktreeRoot, '.worktrees', '没提交的字段不变');
  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(after.verify, ['npm test']);
  assert.deepEqual(after.check, current.check, '体检结果保留');
  assert.deepEqual(after.baseline, current.baseline, '验收基线保留');
  assert.deepEqual(after.futureField, { keep: 'me' }, '未知字段保留');
  // rules：写真实文件、再清除。
  await writeFile(join(c.repo, 'RULES.md'), '# 规矩\n');
  await updateProject('演示', { rules: join(c.repo, 'RULES.md') });
  assert.equal((await loadProject('演示')).rules, await realpath(join(c.repo, 'RULES.md')));
  await updateProject('演示', { rules: null });
  assert.equal((await loadProject('演示')).rules, undefined);
  // 命令行原来的 setProjectLabel 通道不受影响。
});

test('updateProject：绝对路径、..、空项、坏显示名和不存在的项目都被核心拒绝，登记不变', async t => {
  const c = await home(t);
  await addProject('演示', c.repo, { worktreeRoot: '.worktrees' });
  await assert.rejects(() => updateProject('演示', { worktreeRoot: '/tmp/outside' }), /相对路径/);
  await assert.rejects(() => updateProject('演示', { worktreeRoot: '../outside' }), /相对路径/);
  await assert.rejects(() => updateProject('演示', { worktreeRoot: '.' }), /相对路径/);
  await assert.rejects(() => updateProject('演示', { denyReadExtra: ['/etc/passwd'] }), /相对路径/);
  await assert.rejects(() => updateProject('演示', { denyReadExtra: ['ok.txt', 'a/../../b'] }), /相对路径/);
  await assert.rejects(() => updateProject('演示', { setup: ['npm ci', '  '] }), /空项/);
  await assert.rejects(() => updateProject('演示', { verify: 'npm test' as unknown as string[] }), /列表/);
  await assert.rejects(() => updateProject('演示', { label: '' }), /显示名/);
  await assert.rejects(() => updateProject('演示', { rules: join(c.repo, '不存在.md') }), /找不到规则文件/);
  await assert.rejects(() => updateProject('没登记', { label: 'x' }), /没有登记/);
  const after = await loadProject('演示');
  assert.equal(after.worktreeRoot, '.worktrees');
  assert.deepEqual(after.setup, []);
});

test('removeProject：有排队/运行的活、残留选手进程或开放群聊时拒绝；结束的活、关闭的群不阻止', async t => {
  const c = await home(t);
  // 拒绝：排队中的活。
  await addProject('活跃', c.repo, { worktreeRoot: '.worktrees' });
  await putJob(c.home, c.repo, 'j-queued', '活跃', { state: 'queued', started: undefined, ended: undefined });
  await assert.rejects(() => removeProject('活跃'), /排队或运行中/);
  // 拒绝：残留选手进程（失联任务，workerPid 还活着）。
  await addProject('残留', c.repo, { worktreeRoot: '.worktrees' });
  await putJob(c.home, c.repo, 'j-lost', '残留', { state: 'lost', ended: undefined, workerPid: process.pid, workerSince: Date.now() - 1000 });
  await assert.rejects(() => removeProject('残留'), /选手进程/);
  // 拒绝：开放群聊；关掉群聊就能移除。
  await addProject('群聊', c.repo, { worktreeRoot: '.worktrees' });
  await putChat(c.home, sampleChat('chat-open', { project: '群聊' }));
  await assert.rejects(() => removeProject('群聊'), /群聊/);
  await putChat(c.home, sampleChat('chat-open', { project: '群聊', state: 'closed', closed: at }));
  // 允许：结束的活和关闭的群聊只是历史。
  await addProject('干净', c.repo, { worktreeRoot: '.worktrees' });
  await putJob(c.home, c.repo, 'j-done', '干净');
  await putChat(c.home, sampleChat('chat-closed', { project: '干净', state: 'closed', closed: at }));
  const removed = await removeProject('干净');
  assert.equal(removed.name, '干净');
  // 只删登记文件：仓库、任务记录、群聊记录都在。
  await assert.rejects(() => readFile(join(c.home, 'projects', '干净.json')), /ENOENT/);
  assert.equal(JSON.parse(await readFile(join(c.home, 'jobs', 'j-done', 'job.json'), 'utf8')).id, 'j-done');
  assert.equal((await readChatFor(c.home, 'chat-closed')).state, 'closed');
  // 移除之后台账里没了，再移除报没有登记。
  await assert.rejects(() => removeProject('干净'), /没有登记/);
  // 关闭群聊后的“群聊”项目也能移除。
  await removeProject('群聊');
  assert.equal(await realpath(c.repo) !== '', true, '仓库没被动过');
});

async function readChatFor(home: string, id: string) {
  return JSON.parse(await readFile(join(home, 'chats', id, 'chat.json'), 'utf8')) as { state: string };
}
