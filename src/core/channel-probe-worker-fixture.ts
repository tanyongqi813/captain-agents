// 仅离线组合验收：不读登录、不查询网络额度、不提供真实模式或自动消费者。
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { selection } from './workers.ts';
import { isolationOf } from './roster.ts';
import { readSettings, extraDenyRead } from './settings.ts';
import { checkChoice } from './policy.ts';
import { checkListed, listedProviders } from './listed.ts';
import { readQuotaCache, checkQuota } from './quota.ts';
import { prepareRun } from './run-package.ts';
import { workerEnv } from './env.ts';
import { externalEnvironment } from './node-runtime.ts';
import { jobDir } from './paths.ts';
import { runApprovedChannelProbe } from './channel-probe-consent.ts';
import { PROBE_CONTENT, PROBE_FILE, runPreparedChannelProbe } from './channel-probe.ts';
import type { Job } from './job.ts';
import { relativeInside } from './platform.ts';

export function workerProbeFixtureIntent(value: string) {
  const chosen = selection(value), fake = process.env.XAGENTS_FAKE_WORKER, registry = process.env.XAGENTS_HOME;
  if (!fake || !isAbsolute(fake) || !registry || !isAbsolute(registry) || isolationOf(chosen.who) !== 'cursor')
    throw new Error('这里只允许已明确设置临时登记处的Cursor离线替身，不支持真实运行。');
  return { command: { file: process.execPath, args: ['worker-probe-offline-v1', value, fake, registry] }, model: chosen.model, version: null };
}

export async function runWorkerProbeFixture(store: string, token: string | null, value: string, mode: 'offline_fixture', scope?: { root: string; inheritedGroup: true }) {
  if (mode !== 'offline_fixture' || !token) throw new Error('离线诊断需要本次手动单次审批。');
  const intent = workerProbeFixtureIntent(value), chosen = selection(value), fake = process.env.XAGENTS_FAKE_WORKER;
  if (scope && (!isAbsolute(scope.root) || !relativeInside(scope.root, process.env.XAGENTS_HOME!))) throw new Error('离线拥有范围不匹配。');
  let folder: string | undefined, ownedJob: string | undefined;
  try {
    // 准备不消费审批；策略/额度准备失败零执行，不偷偷查询真实账户。
    const settings = await readSettings(); checkChoice(settings.workers, chosen);
    checkListed(await listedProviders(), [chosen]);
    const quota = await readQuotaCache({ custom: false });
    if (!quota) throw new Error('离线诊断缺本地额度快照。');
    checkQuota(quota, [chosen], false, settings.limits.quotaStop);
    folder = await realpath(await mkdtemp(join(scope?.root ?? tmpdir(), 'xagents-worker-probe-')));
    const home = join(folder, 'home'); await mkdir(home);
    // 全新自有仓库：禁用户配置、模板及钩子；不提交、不访问原项目。
    const empty = join(home, 'empty-git-template'); await mkdir(empty);
    const config = join(home, 'empty-git-config'); await writeFile(config, '', { mode: 0o600 });
    await promisify(execFile)('git', ['-c', `core.hooksPath=${empty}`, 'init', `--template=${empty}`, folder], {
      cwd: folder, timeout: 5000, maxBuffer: 8192, windowsHide: true,
      env: { HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config,
        GIT_CONFIG_SYSTEM: config, GIT_TERMINAL_PROMPT: '0',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    });
    await writeFile(join(folder, PROBE_FILE), PROBE_CONTENT + '\n', { mode: 0o600 });
    const prompt = `只读取当前目录的 ${PROBE_FILE}，不要修改文件或读取其他文件。只返回文件首行，不续接，不重试。`;
    const id = `probe_${randomUUID()}`; ownedJob = jobDir(id);
    const job: Job = { ...chosen, id, batch: id, project: id, repo: folder, worktree: folder, base: 'offline', branch: 'offline',
      mode: 'read-only', kind: '测量', title: '离线读取诊断', summary: '只读取固定诊断小文件', state: 'queued', created: new Date().toISOString() };
    const prepared = await prepareRun(job, prompt, { denyReadExtra: [], denyReadHome: await extraDenyRead() });
    const cmd = prepared.actual;
    // 当前仅Cursor替身；不能悄悄丢弃另一通道的pass/stdin/login要求后称真实兼容。
    if (cmd.login !== 'cursor' || cmd.pass?.length || cmd.stdin !== 'ignore' || process.env.XAGENTS_FAKE_WORKER !== fake)
      throw new Error('离线准备契约不匹配。');
    const env = externalEnvironment(workerEnv({ HOME: home, USERPROFILE: home, TMPDIR: folder, TMP: folder, TEMP: folder,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, cmd.env, cmd.unset));
    const report = await runApprovedChannelProbe(store, token, intent, { trigger: 'manual' }, (_intent, expected) =>
      runPreparedChannelProbe({ folder: folder!, command: cmd, env, ...(scope ? { inheritedGroup: true as const } : {}) }, expected));
    return { mode: 'offline_fixture' as const, realModelCalled: false as const, amountHardLimit: null, report };
  } catch { throw new Error('离线诊断未完成；未运行真实通道，不自动重试。'); }
  finally {
    // 只删除本函数新建且持有的随机目录，不接管其他任务/主仓文件。
    const cleanup = await Promise.allSettled([ownedJob, folder].filter((p): p is string => !!p).map(p => rm(p, { recursive: true, force: true })));
    if (cleanup.some(r => r.status === 'rejected')) throw new Error('离线拥有目录未能全部清理。');
  }
}
