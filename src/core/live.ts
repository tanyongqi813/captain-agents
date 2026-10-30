import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { StreamParser, LogTail } from './activity.ts';
import { jobDir } from './paths.ts';
import { updateJob, readJob } from './job.ts';
import type { Job } from './job.ts';
import { changedFiles, worktreeMissing } from './worktree.ts';
import { CursorProgressObserver } from './execution-progress.ts';
import { sleptSeconds } from './duration.ts';

// 串行调用 sample/persist，避免慢磁盘上的两次采集互相覆盖。
export class LiveProgress {
  parser: StreamParser;
  private tail = new LogTail();
  private job: Job;
  private lastCount: number;
  private lastWrite: number;
  private sampledAt: string;
  private savedRevision = 0;
  private files?: number;
  private dirty = false;
  private promptBytes?: number;
  private observation?: CursorProgressObserver;
  private observationStarted: number;

  constructor(job: Job, now = Date.now()) {
    this.job = job; this.parser = new StreamParser(job.who, job.worktree);
    this.lastCount = this.lastWrite = now;
    this.sampledAt = new Date(now).toISOString();
    this.observationStarted = now;
    if (this.parser.format === 'cursor') this.observation = new CursorProgressObserver({ at: now, asleepMs: 0 }, randomBytes(32).toString('hex'));
  }
  setPromptBytes(bytes: number) { this.promptBytes = bytes; }
  async sample(final = false, now = Date.now()) {
    const at = new Date(now).toISOString();
    const previous = this.parser.timing(undefined, this.sampledAt);
    await this.tail.read(join(jobDir(this.job.id), 'run.log'), this.parser, at);
    if (final) this.parser.finish(at);
    if (this.observation) {
      try {
        const latest = await readJob(this.job.id);
        await this.observation.sample(join(jobDir(this.job.id), 'run.log'), {
          at: now, asleepMs: Math.round(sleptSeconds(latest.sleeps, this.observationStarted, now) * 1000),
        }, final);
      } catch { this.observation.invalidate(); }
    }
    this.sampledAt = at;
    if (this.parser.timing(undefined, at).toolSeconds !== previous.toolSeconds) this.dirty = true;
    if (final || now - this.lastCount >= 30_000) {
      this.lastCount = now;
      // 副本不在时保留上次的数字，不让这一轮的进度跟着丢。
      if (!(await worktreeMissing(this.job))) { this.files = await changedFiles(this.job); this.dirty = true; }
    }
  }
  apply(job: Job) {
    const parsed = this.parser.result();
    job.activity = parsed.activity;
    job.lastActivityAt = parsed.lastActivityAt;
    job.usage = parsed.usage;
    job.timing = this.parser.timing(job.sleeps, this.sampledAt);
    job.dispatchTrace = this.parser.trace(this.promptBytes ?? job.dispatchTrace?.promptBytes);
    if (this.files !== undefined) job.changedFiles = this.files;
  }
  // 只供只读诊断；旧看管/持久化不消费候选阈值，不保存会话盐。
  observationSnapshot() { return this.observation?.snapshot() ?? null; }
  async persist(now?: number) {
    if ((now ?? Date.now()) - this.lastWrite < 5000 || (!this.dirty && this.savedRevision === this.parser.revision)) return false;
    await updateJob(this.job.id, j => this.apply(j));
    // 等锁、落盘耗时也计入间隔，不能在上次写完后立刻再写。
    this.lastWrite = now ?? Date.now(); this.savedRevision = this.parser.revision; this.dirty = false;
    return true;
  }
}
