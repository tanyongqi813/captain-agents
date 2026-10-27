import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { View } from '../src/core/view-types.ts';
import type { Job } from '../src/core/job.ts';
import { alive } from '../src/core/platform.ts';

export const root = resolve(import.meta.dirname, '..');
export const fixture = join(root, 'test/fixtures/worker.ts');

// 自治集成测试的历史夹具升级为正式派发契约；只作用于测试临时仓库。
// 保留原目标、验收、状态和依赖，不能在生产代码中为旧项目自动伪造 Capsule。
export async function upgradeAutopilotFixture(repo: string) {
  const { parseTaskList, parseTaskSpec, TASK_SECTIONS, CAPSULE_SECTIONS } = await import('../src/core/task-plan.ts');
  const list = join(repo, 'docs/TASK_LIST.md');
  const rows = parseTaskList(await readFile(list, 'utf8'));
  const table = ['# 功能任务清单', '', '| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 | 当前执行 |', '|---|---|---|---|---|---|---|'];
  for (const row of rows) {
    const target = join(repo, 'docs', row.link);
    const raw = await readFile(target, 'utf8').catch(() => '');
    const parsed = parseTaskSpec(raw);
    const status = parsed.status ?? row.status, priority = parsed.priority ?? row.priority ?? 'P1', difficulty = parsed.difficulty ?? row.difficulty ?? 'Medium';
    const ready = status === 'READY';
    table.push(`| [${row.id}](${row.link}) | ${row.title} | ${status} | ${priority || 'P1'} | ${difficulty || 'Medium'} | ${parsed.deps.map(d => d.id).join(', ') || 'none'} | ${ready ? 'attempt-01' : 'none'} |`);
    if (!raw || parsed.depsError) continue;
    let body = raw.replace(/^#.*\n/, '');
    for (const section of TASK_SECTIONS) if (!body.includes(`## ${section}\n`)) body += `\n## ${section}\n\n测试约定。\n`;
    const deps = parsed.deps.map(d => `${d.id}[${d.accepted.join('|')}]`).join(', ') || 'none';
    await writeFile(target, `# ${row.id} — ${row.title}\n\n- handoff_contract: \`1\`\n- status: \`${status}\`\n- priority: \`${priority || 'P1'}\`\n- difficulty: \`${difficulty || 'Medium'}\`\n- dependencies: \`${deps}\`\n- current_attempt: \`${ready ? '01' : 'none'}\`\n${body}`);
    if (ready) {
      const dir = join(repo, 'docs/execution', row.id); await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'attempt-01.md'), [`# Execution Capsule — ${row.id} / attempt-01`, '', '- handoff_contract: `1`', '- capsule_schema: `2`', '- dispatch_state: `READY`',
        `- planning_source: \`docs/tasks/${row.id}.md\``, `- task_id: \`${row.id}\``, '- attempt: `01`', '- revision_reason: `initial`',
        `- priority: \`${priority || 'P1'}\``, `- difficulty: \`${difficulty || 'Medium'}\``, '- required_planning_lookup: `none`', '',
        ...CAPSULE_SECTIONS.flatMap(section => [`## ${section}`, '', section.startsWith('源码锚点') ? '1. `base.txt` — 测试仓库起点。' : section === '本轮唯一目标' ? parsed.goal || '完成替身任务。' : '仅用于离线替身测试。', ''])].join('\n'));
    }
  }
  await writeFile(list, table.join('\n') + '\n');
}
// Windows 上不按记下的进程号补刀：号回收得很快，过后再按号结束会误伤别的测试的进程。
export function killLeftover(pid: number | undefined) {
  if (!pid || process.platform === 'win32') return;
  try { process.kill(pid, 'SIGKILL'); } catch { /* 已经没了 */ }
}
export async function until<T>(fn: () => Promise<T>, accept: (value: T) => boolean = Boolean, timeout = 12000): Promise<T> {
  const end = Date.now() + timeout;
  while (true) {
    const value = await fn();
    if (accept(value)) return value;
    if (Date.now() >= end) throw new Error(`等待条件超时，最后结果：${JSON.stringify(value)}`);
    await sleep(25);
  }
}
export async function exec(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
export async function context(t: TestContext, repository = true) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'xagents-test-')));
  const home = join(temp, 'registry'), repo = join(temp, 'repo with spaces');
  await mkdir(home); await mkdir(repo);
  await mkdir(join(temp, 'user-home'));
  const env = { ...process.env, XAGENTS_TRASH: join(temp, 'trash'), XAGENTS_HOME: home, CODEX_HOME: join(temp, 'codex-config'), XAGENTS_CAFFEINATE: join(temp, 'no-caffeinate'), XAGENTS_FAKE_WORKER: fixture, XAGENTS_APPLICATIONS: join(temp, 'Applications'), XAGENTS_MAX_RUNNING: '6', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: '测试', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: '测试', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  Reflect.deleteProperty(env, 'XAGENTS_SRT');
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, cwd = repo) => exec(process.execPath, [join(root, 'src/cli/cli.ts'), ...args], cwd, { ...env, ...(['guide', 'connect'].includes(args[0]) ? { HOME: join(temp, 'user-home') } : {}), ...extra });
  const git = async (args: string[]) => {
    const r = await exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], repo, env);
    assert.equal(r.code, 0, r.stderr); return r.stdout.trim();
  };
  const jobs = async (): Promise<Job[]> => {
    const names = await readdir(join(home, 'jobs')).catch(() => []);
    const rows = await Promise.all(names.filter(n => !n.startsWith('.')).map(async n => {
      try { return JSON.parse(await readFile(join(home, 'jobs', n, 'job.json'), 'utf8')); } catch { return null; }
    }));
    return rows.filter(Boolean);
  };
  t.after(async () => {
    // Windows 上进程号回收得很快：已经结束的活，记录里的进程号早就不是它的了，照着去结束会误伤同时在跑的别的测试
    // （流水线上实测到：随机某条测试里的活突然“失联”）。所以那里只收还没结束的活，而且按进程树加创建时间来认。
    const windows = process.platform === 'win32';
    const live = async () => (await jobs()).filter(job => !windows || ['queued', 'running'].includes(job.state));
    for (const job of await live()) {
      if (windows) {
        const { killTree } = await import('../src/core/platform.ts');
        try { killTree(job.setupPid, 'SIGKILL', job.setupSince); } catch {}
        try { killTree(job.workerPid, 'SIGKILL', job.workerSince); } catch {}
      } else {
        try { if (job.setupPid) process.kill(-job.setupPid, 'SIGKILL'); } catch {}
        try { if (job.workerPid) process.kill(-job.workerPid, 'SIGKILL'); } catch {}
      }
      try { if (alive(job.pid, job.pidSince)) process.kill(job.pid!, 'SIGTERM'); } catch {}
    }
    await sleep(150);
    for (const job of await live()) { try { if (alive(job.pid, job.pidSince)) process.kill(job.pid!, 'SIGKILL'); } catch {} }
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  let base = '';
  if (repository) {
    await git(['init', '-b', 'main']);
    await writeFile(join(repo, 'base.txt'), '起点\n');
    await git(['add', 'base.txt']);
    const tree = await git(['write-tree']);
    base = await git(['commit-tree', tree, '-m', '测试起点']);
    await git(['update-ref', 'refs/heads/main', base]);
  }
  const task = join(temp, 'task.md'); await writeFile(task, '本题只运行测试替身。\n');
  const add = (extra: string[] = []) => cli(['project', 'add', '测试', repo, '--worktree-root', '.worktrees', ...extra]);
  return { temp, home, repo, env, cli, git, jobs, task, add, base };
}

// 在独立进程读取指定测试登记处，避免并发测试互相覆盖环境变量。
export async function desktopView(home: string): Promise<View> {
  const result = await exec(process.execPath, ['--input-type=module', '-e',
    "import { buildView } from './src/core/view.ts'; console.log(JSON.stringify(await buildView()));"], root,
    { ...process.env, XAGENTS_HOME: home, CODEX_HOME: join(home, 'codex-config'), XAGENTS_FAKE_WORKER: fixture });
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout) as View;
}
