// 显式诊断核心：没有默认通道、自动入口或凭据读取。调用方负责真实命令的单独授权。
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { assertTreeControl, treeSpawn, processSince, killTree, isWindows } from './platform.ts';

export const PROBE_FILE = 'probe-input.txt';
export const PROBE_CONTENT = 'probe-read-v1';
export type ProbeReport = {
  outcome: 'success' | 'failed' | 'timeout' | 'output_limit' | 'launch_failed';
  startedAt: string; endedAt: string; exitCode: number | null;
  firstEventMs: number | null; toolStartedMs: number | null; toolCompletedMs: number | null; resultMs: number | null;
  resultVerified: boolean; bytes: number; cleanupFailed: boolean;
  model: string | null; version: string | null; usage: null;
};

type ProbeOptions = { timeoutMs?: number; maxBytes?: number; expectedModel?: string | null; expectedVersion?: string | null; signal?: AbortSignal;
  authorizeSpawn?: (start: () => void) => Promise<void> };
type ProbeCommand = { file: string; args: string[] };
// 仅可信准备层调用；目录、环境及stdin均由准备层负责，不是对不可信代码的隔离授权。
export type PreparedProbe = { folder: string; command: ProbeCommand; env: NodeJS.ProcessEnv; stdin?: string; inheritedGroup?: true };
export const runPreparedChannelProbe = (prepared: PreparedProbe, options: ProbeOptions = {}) => runProbe(prepared.command, options, prepared);
// 通用入口仍只有最小环境；不会默默继承准备路径或父凭据。
export const runChannelProbe = (command: ProbeCommand, options: ProbeOptions = {}) => runProbe(command, options);
async function runProbe(command: ProbeCommand, options: ProbeOptions, prepared?: PreparedProbe): Promise<ProbeReport> {
  const timeoutMs = options.timeoutMs ?? 90000, maxBytes = options.maxBytes ?? 65536;
  if (!isAbsolute(command.file) || !Array.isArray(command.args) || command.args.length > 128
    || command.args.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90000
    || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536) throw new Error('诊断参数不合法。');
  assertTreeControl();
  const signal = options.signal, authorizeSpawn = options.authorizeSpawn, inheritedGroup = prepared?.inheritedGroup === true && !isWindows;
  if (signal?.aborted) throw new Error('诊断已取消，未启动。');
  // 预期值不是实际身份。只接受init事件精确核对，并复制在任何await之前。
  const expectedModel = options.expectedModel, expectedVersion = options.expectedVersion;
  const safeMetadata = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160
    && /^[\w .+/:()-]+$/.test(value) && !/bearer|api[_-]?key|secret|sk-/i.test(value);
  if ((expectedModel != null && !safeMetadata(expectedModel)) || (expectedVersion != null && !safeMetadata(expectedVersion))) throw new Error('诊断身份预期不合法。');
  // 在任何await之前冻结可信命令及环境，异步准备不能改掉此次实际启动内容。
  command = { file: command.file, args: [...command.args] };
  const preparedEnv = prepared ? { ...prepared.env } : undefined, stdin = prepared?.stdin;
  if (prepared && (!isAbsolute(prepared.folder) || (stdin !== undefined && (typeof stdin !== 'string' || Buffer.byteLength(stdin) > 8192 || stdin.includes('\0'))))) throw new Error('诊断准备参数不合法。');
  const folder = prepared?.folder ?? await mkdtemp(join(tmpdir(), 'xagents-channel-probe-'));
  try {
    const home = join(folder, 'home');
    if (prepared) {
      if (!(await lstat(join(folder, PROBE_FILE))).isFile() || await readFile(join(folder, PROBE_FILE), 'utf8') !== PROBE_CONTENT + '\n') throw new Error('诊断固定文件不匹配。');
    } else {
      await mkdir(home);
      await writeFile(join(folder, PROBE_FILE), PROBE_CONTENT + '\n', { mode: 0o600 });
    }
    const began = performance.now();
    const report: ProbeReport = { outcome: 'failed', startedAt: new Date().toISOString(), endedAt: '', exitCode: null,
      firstEventMs: null, toolStartedMs: null, toolCompletedMs: null, resultMs: null, resultVerified: false,
      bytes: 0, cleanupFailed: false, model: null, version: null, usage: null };
    return await new Promise<ProbeReport>((resolve, reject) => {
      let expired = false, launched = false, gateFailure: (() => void) | undefined;
      const finishWaiting = (outcome: ProbeReport['outcome']) => {
        if (launched || expired) return; expired = true;
        clearTimeout(waiting); signal?.removeEventListener('abort', waitCancel);
        report.outcome = outcome; report.endedAt = new Date().toISOString(); resolve(report);
      };
      const waitCancel = () => finishWaiting('failed');
      const waiting = setTimeout(() => finishWaiting('timeout'), timeoutMs);
      signal?.addEventListener('abort', waitCancel, { once: true });
      const start = () => {
      if (launched || expired) throw new Error('诊断启动门已使用或过期。');
      if (signal?.aborted) { finishWaiting('failed'); return; }
      const remaining = timeoutMs - (performance.now() - began);
      if (remaining <= 0) { finishWaiting('timeout'); return; }
      clearTimeout(waiting); signal?.removeEventListener('abort', waitCancel); launched = true;
      const child = spawn(command.file, [...command.args], { cwd: folder, shell: false, ...(inheritedGroup ? {} : treeSpawn()),
        env: preparedEnv ?? { HOME: home, USERPROFILE: home, TMPDIR: folder, TMP: folder, TEMP: folder,
          ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
      if (stdin !== undefined) { child.stdin?.on('error', () => {}); child.stdin?.end(stdin); }
      let since: number | undefined, exitedAt: number | undefined, done = false, stopping = false, pending = '';
      const decoder = new StringDecoder('utf8');
      let fallback: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        // 继承组只用于外层已拥有的离线helper；子孙最终由外层组长统一回收。
        try { if (inheritedGroup) child.kill('SIGKILL'); else killTree(child.pid, 'SIGKILL', since, exitedAt); }
        catch { report.cleanupFailed = true; child.kill('SIGKILL'); }
      };
      const finish = () => {
        if (done) return; done = true;
        clearTimeout(timer); if (fallback) clearTimeout(fallback);
        signal?.removeEventListener('abort', cancel);
        child.stdout?.destroy(); child.stderr?.destroy();
        report.endedAt = new Date().toISOString();
        if (!stopping) report.outcome = report.exitCode === 0 && report.resultVerified && !report.cleanupFailed ? 'success' : 'failed';
        resolve(report);
      };
      const stop = (outcome: ProbeReport['outcome']) => {
        if (stopping || done) return;
        stopping = true; report.outcome = outcome; cleanup();
        fallback = setTimeout(finish, 250);
      };
      gateFailure = () => stop('launch_failed');
      const timer = setTimeout(() => stop('timeout'), remaining);
      const cancel = () => stop('failed');
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const line = (raw: string) => {
        let event: unknown; try { event = JSON.parse(raw); } catch { return; }
        if (!event || typeof event !== 'object' || Array.isArray(event)) return;
        const e = event as Record<string, unknown>, elapsed = performance.now() - began;
        if (typeof e.type !== 'string') return;
        report.firstEventMs ??= elapsed;
        if (e.type === 'system' && e.subtype === 'init') {
          if (safeMetadata(e.model) && e.model === expectedModel) report.model = e.model;
          if (safeMetadata(e.version) && e.version === expectedVersion) report.version = e.version;
        }
        if (e.type === 'tool_call' && e.subtype === 'started') report.toolStartedMs ??= elapsed;
        if (e.type === 'tool_call' && e.subtype === 'completed') report.toolCompletedMs ??= elapsed;
        if (e.type === 'result') { report.resultMs ??= elapsed; report.resultVerified ||= e.result === PROBE_CONTENT; }
      };
      const count = (chunk: Buffer): boolean => {
        report.bytes = Math.min(maxBytes + 1, report.bytes + chunk.length);
        if (report.bytes > maxBytes) { stop('output_limit'); return false; }
        return !stopping && !done;
      };
      child.stdout!.on('data', (chunk: Buffer) => {
        if (!count(chunk)) return;
        pending += decoder.write(chunk);
        let end: number;
        while ((end = pending.indexOf('\n')) >= 0) {
          if (Buffer.byteLength(pending.slice(0, end)) > 8192) { stop('output_limit'); return; }
          line(pending.slice(0, end)); pending = pending.slice(end + 1);
        }
        if (Buffer.byteLength(pending) > 8192) stop('output_limit');
      });
      child.stderr!.on('data', (chunk: Buffer) => { count(chunk); }); // 原始内容不留存。
      child.once('spawn', () => { try { since = processSince(child.pid); } catch { stop('launch_failed'); } });
      child.once('error', () => stop('launch_failed')); // 不暴露命令或带凭据的系统错误。
      child.once('exit', code => { report.exitCode = code; exitedAt = Date.now(); cleanup(); });
      child.once('close', () => {
        if (!stopping) { pending += decoder.end(); if (pending) line(pending); }
        finish();
      });
      };
      const failed = (error: unknown) => {
        clearTimeout(waiting); signal?.removeEventListener('abort', waitCancel);
        if (gateFailure) gateFailure(); else { expired = true; reject(error); }
      };
      try { if (authorizeSpawn) void authorizeSpawn(start).catch(failed); else start(); }
      catch (error) { failed(error); }
    });
  } finally { if (!prepared) await rm(folder, { recursive: true, force: true }); }
}
