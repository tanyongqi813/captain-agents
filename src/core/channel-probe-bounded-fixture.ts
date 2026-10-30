// 固定内部辅助进程，仍然仅离线替身。不是应用启动/定时入口或真实调用授权。
import { mkdtemp, mkdir, writeFile, rm, realpath, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeCommand } from './node-runtime.ts';
import { readSettings } from './settings.ts';
import { readQuotaCache } from './quota.ts';
import { writeJson } from './fsx.ts';
import { issueProbeApproval, runApprovedChannelProbe } from './channel-probe-consent.ts';
import { workerProbeFixtureIntent, runWorkerProbeFixture } from './channel-probe-worker-fixture.ts';
import { PROBE_FILE, PROBE_CONTENT, runPreparedChannelProbe } from './channel-probe.ts';
import { alive, processSince } from './platform.ts';

const entry = fileURLToPath(import.meta.url);
type Scenario = 'normal' | 'prepare_hang';
type Request = { root: string; choice: string; source: string; fake: string; scenario: Scenario; nonce: string };
export async function runBoundedWorkerProbeFixture(store: string, token: string | null, choice: string,
  options: { timeoutMs?: number; signal?: AbortSignal; scenario?: Scenario } = {}) {
  const timeoutMs = options.timeoutMs ?? 90000, scenario = options.scenario ?? 'normal';
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90000 || !['normal', 'prepare_hang'].includes(scenario)) throw new Error('离线总时限参数不合法。');
  const intent = workerProbeFixtureIntent(choice), source = process.env.XAGENTS_HOME!, fake = process.env.XAGENTS_FAKE_WORKER!;
  const controller = new AbortController(), onCancel = () => controller.abort(), onTerm = () => controller.abort();
  options.signal?.addEventListener('abort', onCancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  process.on('SIGTERM', onTerm);
  let root: string | undefined, retainRoot = false;
  try {
    const report = await runApprovedChannelProbe(store, token, intent, { trigger: 'manual' }, async (_intent, expected) => {
      if (controller.signal.aborted) throw new Error('离线总流程已取消。');
      root = await realpath(await mkdtemp(join(tmpdir(), 'xagents-probe-envelope-')));
      const home = join(root, 'home'); await mkdir(home);
      await writeFile(join(root, PROBE_FILE), PROBE_CONTENT + '\n', { mode: 0o600 });
      const nonce = randomUUID();
      await writeJson(join(root, '.probe-owner.json'), { pid: process.pid, since: processSince(process.pid), nonce });
      const request: Request = { root, choice, source, fake, scenario, nonce };
      const launch = nodeCommand([entry, '--offline-helper'], { HOME: home, USERPROFILE: home, TMPDIR: root, TMP: root, TEMP: root,
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) });
      // timer在spawn辅助进程前建立；所有账户快照读取/运行包准备都在子级。
      return runPreparedChannelProbe({ folder: root, command: launch, env: launch.env, stdin: JSON.stringify(request) }, { ...expected, timeoutMs, signal: controller.signal });
    });
    let cleanupCheckpoint: string | null = null;
    if (report.cleanupFailed) {
      // 未确认停干净时保留上下文；恢复资料只写本地，不复制原始输出/凭据。
      retainRoot = true; cleanupCheckpoint = randomUUID();
      await writeJson(join(store, `probe-cleanup-${cleanupCheckpoint}.json`), {
        schema: 1, root, reason: 'tree_cleanup_failed', at: new Date().toISOString()
      });
    }
    return { mode: 'offline_fixture' as const, scope: 'helper_preparation_and_execution' as const, cleanupCheckpoint,
      cancelled: controller.signal.aborted, realModelCalled: false as const, amountHardLimit: null,
      // 这是辅助流程首事件/结果，不是实际模型工具时间。内层未知阶段不伪造。
      report };
  } finally {
    options.signal?.removeEventListener('abort', onCancel); process.off('SIGTERM', onTerm);
    if (root && !retainRoot) await rm(root, { recursive: true, force: true });
  }
}

async function helper() {
  if (process.argv.length !== 3 || process.argv[2] !== '--offline-helper') throw new Error('只接受内部离线协议。');
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk.toString(); if (Buffer.byteLength(raw) > 8192) throw new Error('内部协议过大。'); }
  const r = JSON.parse(raw) as Request;
  if (!r || Object.keys(r).sort().join(',') !== 'choice,fake,nonce,root,scenario,source' || !isAbsolute(r.root) || !isAbsolute(r.fake)
    || !isAbsolute(r.source) || typeof r.choice !== 'string' || !['normal', 'prepare_hang'].includes(r.scenario)
    || await realpath(process.cwd()) !== await realpath(r.root)) throw new Error('内部离线范围不匹配。');
  // 仅确认外层拥有的临时目录，不把内部协议当成对不可信代码的鉴权。
  const owner = JSON.parse(await readFile(join(r.root, '.probe-owner.json'), 'utf8'));
  if (!owner || owner.pid !== process.ppid || owner.nonce !== r.nonce || !alive(owner.pid, owner.since)) throw new Error('内部离线目录没有匹配的外层拥有者。');
  await writeJson(join(r.root, '.probe-helper.json'), { pid: process.pid, since: processSince(process.pid), at: new Date().toISOString() });
  console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
  if (r.scenario === 'prepare_hang') { setInterval(() => {}, 1000); return; }
  process.env.XAGENTS_HOME = r.source;
  process.env.XAGENTS_FAKE_WORKER = r.fake;
  const settings = await readSettings(), quota = await readQuotaCache({ custom: false });
  if (!quota) throw new Error('缺离线额度快照。');
  const registry = join(r.root, 'registry'); await mkdir(registry); await mkdir(join(registry, 'cache'));
  await writeJson(join(registry, 'config.json'), { workers: settings.workers, models: settings.models, limits: settings.limits });
  await writeJson(join(registry, 'cache', 'quota.json'), quota);
  process.env.XAGENTS_HOME = registry;
  const approval = join(r.root, 'approval');
  // 父级已经消费原审批；仅委托此拥有范围中的离线单次子调用，绝不是授予真实权限。
  const token = await issueProbeApproval(approval, workerProbeFixtureIntent(r.choice), { actor: 'owner', trigger: 'manual' });
  const result = await runWorkerProbeFixture(approval, token, r.choice, 'offline_fixture', { root: r.root, inheritedGroup: true });
  console.log(JSON.stringify({ type: 'result', result: result.report.outcome === 'success' ? PROBE_CONTENT : null }));
  if (result.report.outcome !== 'success') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === entry) {
  helper().catch(() => { process.stderr.write('离线辅助流程失败。\n'); process.exitCode = 1; });
}
