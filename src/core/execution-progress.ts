// 仅观察证据；候选阈值不是停机授权。调用者提供会话salt及可信累计休眠时间。
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

export type ProgressClock = { at: number; asleepMs: number };
export type ProgressEvent =
  | { kind: 'init' | 'error' | 'reconnect' | 'unknown' }
  | { kind: 'result'; id: string; success: boolean }
  | { kind: 'start'; id: string; operation: 'read' | 'edit' | 'command' | 'unknown'; path?: string }
  | { kind: 'end'; id: string; success: boolean | null };
type Tool = { id: string; from: number; operation: 'read' | 'edit' | 'command' | 'unknown'; fingerprint: string | null };
export type ProgressState = {
  clock: ProgressClock; awakeMs: number; firstEventMs: number | null; progressMs: number | null;
  errors: number; reconnects: number; unknown: number; incomplete: boolean;
  active: Tool[]; seen: string[]; reads: { fingerprint: string; at: number }[];
};
const LIMIT = 128, SEEN = 512, WINDOW = 300_000;
const validTime = (n: number) => Number.isSafeInteger(n) && n >= 0;
const boundedCount = (n: number) => Math.min(Number.MAX_SAFE_INTEGER, n + 1);
function checkClock(c: ProgressClock) {
  if (!validTime(c.at) || !validTime(c.asleepMs)) throw new Error('观察时钟无效。');
}
export function initialProgress(clock: ProgressClock): ProgressState {
  checkClock(clock);
  return { clock: { ...clock }, awakeMs: 0, firstEventMs: null, progressMs: null,
    errors: 0, reconnects: 0, unknown: 0, incomplete: false, active: [], seen: [], reads: [] };
}
function digest(salt: string, value: string) {
  if (!/^[a-f0-9]{32,128}$/.test(salt)) throw new Error('需要独立会话摘要盐。');
  return createHash('sha256').update(salt).update('\0').update(value).digest('hex');
}
const validId = (s: string) => typeof s === 'string' && s.length > 0 && s.length <= 1024;
export function advanceProgress(previous: ProgressState, clock: ProgressClock, event?: ProgressEvent, salt = ''): ProgressState {
  checkClock(clock);
  const wall = clock.at - previous.clock.at, sleep = clock.asleepMs - previous.clock.asleepMs;
  if (wall < 0 || sleep < 0 || sleep > wall) throw new Error('观察时钟回退或休眠范围无效。');
  const s: ProgressState = { ...previous, clock: { ...clock }, awakeMs: previous.awakeMs + wall - sleep,
    active: previous.active.map(t => ({ ...t })), seen: [...previous.seen],
    reads: previous.reads.filter(r => previous.awakeMs + wall - sleep - r.at <= WINDOW).map(r => ({ ...r })) };
  if (!event) return s; // 字节增长/mtime只有时钟，没有进展事件。
  if (event.kind === 'unknown') { s.unknown = boundedCount(s.unknown); return s; }
  if ((event.kind === 'start' || event.kind === 'end' || event.kind === 'result') && !validId(event.id)) {
    s.unknown = boundedCount(s.unknown); return s;
  }
  if (s.firstEventMs === null) s.firstEventMs = s.awakeMs;
  if (event.kind === 'error') s.errors = boundedCount(s.errors);
  else if (event.kind === 'reconnect') s.reconnects = boundedCount(s.reconnects);
  else if (event.kind === 'start' || event.kind === 'end' || event.kind === 'result') {
    if (!validId(event.id)) { s.unknown = boundedCount(s.unknown); return s; }
    const id = digest(salt, event.id), key = `${event.kind}:${id}`;
    if (s.seen.includes(key)) return s;
    s.seen.push(key);
    if (s.seen.length > SEEN) { s.seen.shift(); s.incomplete = true; }
    if (event.kind === 'start') {
      // 完成先到或已淘汰过的调用不反向编造新的开始。
      if (s.seen.includes(`end:${id}`) || s.active.some(t => t.id === id)) return s;
      const fingerprint = event.operation === 'read' && typeof event.path === 'string' && event.path.length > 0 && event.path.length <= 4096
        ? digest(salt, `read\0${event.path}`) : null;
      if (s.active.length === LIMIT) { s.incomplete = true; return s; }
      s.active.push({ id, from: s.awakeMs, operation: event.operation, fingerprint });
      if (fingerprint) {
        s.reads.push({ fingerprint, at: s.awakeMs });
        if (s.reads.length > LIMIT) { s.reads.shift(); s.incomplete = true; }
      }
    } else if (event.kind === 'end') {
      const tool = s.active.find(t => t.id === id);
      if (!tool) { s.unknown = boundedCount(s.unknown); return s; }
      s.active = s.active.filter(t => t.id !== id);
      if (event.success === true && tool.operation === 'edit') s.progressMs = s.awakeMs;
    } else if (event.success) s.progressMs = s.awakeMs;
  }
  return s;
}
export function progressEvidence(s: ProgressState) {
  const counts = new Map<string, number>();
  for (const r of s.reads) counts.set(r.fingerprint, (counts.get(r.fingerprint) ?? 0) + 1);
  return { firstEventWaitCandidate: s.firstEventMs === null && s.awakeMs >= 90_000,
    unfinishedReadCandidates: s.active.filter(t => t.operation === 'read' && s.awakeMs - t.from >= 180_000).map(t => t.id),
    repeatedReadCandidates: [...counts].filter(([, n]) => n >= 5).map(([fingerprint, count]) => ({ fingerprint, count })),
    sinceProgressMs: s.progressMs === null ? null : s.awakeMs - s.progressMs,
    implementationProgressKnown: s.progressMs !== null, incomplete: s.incomplete, stopAuthorized: false as const };
}

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
// 只适配已知Cursor结构；不从散文、shell命令或文件mtime推断成功/重连/进展。
export function cursorProgressEvent(value: unknown): ProgressEvent {
  const row = object(value);
  if (row.type === 'system' && row.subtype === 'init') return { kind: 'init' };
  if (row.type === 'tool_call' && typeof row.call_id === 'string') {
    const calls = object(row.tool_call);
    const entries = Object.entries(calls).filter(([k]) => k.endsWith('ToolCall'));
    if (entries.length !== 1) return { kind: 'unknown' };
    const [name, raw] = entries[0], call = object(raw), args = object(call.args);
    if (row.subtype === 'started') return { kind: 'start', id: row.call_id,
      operation: name === 'readToolCall' ? 'read' : name === 'editToolCall' ? 'edit' : name === 'shellToolCall' ? 'command' : 'unknown',
      ...(typeof args.path === 'string' ? { path: args.path } : {}) };
    if (row.subtype === 'completed') {
      const result = object(call.result);
      const success = result.success;
      return { kind: 'end', id: row.call_id, success: success !== null && typeof success === 'object' && !Array.isArray(success) && !Object.hasOwn(result, 'error') ? true
        : Object.hasOwn(result, 'error') && !Object.hasOwn(result, 'success') ? false : null };
    }
  }
  if (row.type === 'result' && row.subtype === 'success' && row.is_error === false && typeof row.request_id === 'string')
    return { kind: 'result', id: `result:${row.request_id}`, success: true };
  // 错误类型可观察，但不猜未知供应商重连协议；无唯一ID的result不当新进展。
  if (row.type === 'error') return { kind: 'error' };
  return { kind: 'unknown' };
}

export class CursorProgressStream {
  private pending = '';
  private dropping = false;
  private state: ProgressState;
  private readonly salt: string;
  constructor(clock: ProgressClock, salt: string) { digest(salt, ''); this.salt = salt; this.state = initialProgress(clock); }
  feed(chunk: string, clock: ProgressClock) {
    this.state = advanceProgress(this.state, clock);
    // 按字符扫描，不把任意长度chunk附加到内部缓存；UTF-8解码由既有LogTail负责。
    for (const c of chunk) {
      if (c === '\n') {
        if (!this.dropping) {
          let event: ProgressEvent;
          try { event = cursorProgressEvent(JSON.parse(this.pending)); } catch { event = { kind: 'unknown' }; }
          this.state = advanceProgress(this.state, clock, event, this.salt);
        }
        this.pending = ''; this.dropping = false;
      } else if (!this.dropping) {
        this.pending += c;
        if (this.pending.length > 8192) { this.pending = ''; this.dropping = true; this.state.incomplete = true; }
      }
    }
  }
  snapshot() { return structuredClone(this.state); }
  markIncomplete() { this.state.incomplete = true; }
  finish(clock: ProgressClock) {
    this.state = advanceProgress(this.state, clock);
    // 真正EOF才调用；不闭合未完成工具，也不把截断JSON认成事件。
    if (!this.dropping && this.pending.trim()) {
      try { this.state = advanceProgress(this.state, clock, cursorProgressEvent(JSON.parse(this.pending)), this.salt); }
      catch { this.state.incomplete = true; }
    }
    this.pending = ''; this.dropping = false;
  }
  get bufferedCharacters() { return this.pending.length; }
}

// 独立偏移，不借旧StreamParser.finish补全工具；失败只影响影子证据。
export class CursorProgressObserver {
  private stream: CursorProgressStream;
  private decoder = new StringDecoder('utf8');
  private offset = 0;
  private identity: string | undefined;
  private unavailable = false;
  private backlog = false;
  private ended = false;
  constructor(clock: ProgressClock, salt: string) { this.stream = new CursorProgressStream(clock, salt); }
  invalidate() { this.unavailable = true; this.stream.markIncomplete(); }
  async sample(file: string, clock: ProgressClock, final = false) {
    if (this.unavailable || this.ended) return;
    let fd;
    try {
      this.stream.feed('', clock);
      fd = await open(file, 'r');
      const info = await fd.stat(), identity = `${info.dev}:${info.ino}`;
      if (!info.isFile() || (this.identity !== undefined && identity !== this.identity) || info.size < this.offset) {
        this.invalidate(); return;
      }
      this.identity = identity;
      const buffer = Buffer.alloc(64 * 1024), edge = Math.min(info.size, this.offset + 256 * 1024);
      while (this.offset < edge) {
        const { bytesRead } = await fd.read(buffer, 0, Math.min(buffer.length, edge - this.offset), this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        this.stream.feed(this.decoder.write(buffer.subarray(0, bytesRead)), clock);
      }
      this.backlog = this.offset < info.size;
      if (final && !this.backlog) {
        this.stream.feed(this.decoder.end(), clock); this.stream.finish(clock); this.ended = true;
      }
    } catch (e) {
      if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT' && this.identity === undefined && !final)) this.invalidate();
    } finally { await fd?.close().catch(() => this.invalidate()); }
  }
  snapshot() {
    return { state: this.stream.snapshot(), evidence: progressEvidence(this.stream.snapshot()),
      unavailable: this.unavailable, backlog: this.backlog, ended: this.ended, bytesObserved: this.offset };
  }
}
