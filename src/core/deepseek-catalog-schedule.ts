// 纯调度，不拥有网络、密钥、持久化或定时器。调用方仅在主人显式授权后传入
// 非密钥的连接标识+本地凭据版本；撤销时仍须中止网络，并在落盘前检查凭证。
export type CatalogRefreshTicket = Readonly<{ generation: number; serial: number; deadline: number }>;
export type CatalogRefreshState = { binding: string | null; generation: number; serial: number;
  pending: CatalogRefreshTicket | null; nextAt: number; failures: number; lastNow: number };
const INTERVAL = 60_000, TIMEOUT = 15_000, MAX_BACKOFF = 15 * 60_000;

export class CatalogRefreshSchedule {
  private binding: string | null = null;
  private generation = 0;
  private serial = 0;
  private pending: CatalogRefreshTicket | null = null;
  private nextAt = 0;
  private failures = 0;
  private lastNow = 0;

  constructor(stored?: unknown) {
    if (stored === undefined) return;
    const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER - MAX_BACKOFF;
    if (!object(stored) || Object.keys(stored).sort().join(',') !== 'binding,failures,generation,lastNow,nextAt,pending,serial'
      || (stored.binding !== null && (typeof stored.binding !== 'string' || !stored.binding.trim() || stored.binding.length > 500 || /[\u0000-\u001f\u007f]/u.test(stored.binding)))
      || !integer(stored.generation) || !integer(stored.serial) || !integer(stored.nextAt) || !integer(stored.lastNow)
      || !integer(stored.failures) || stored.failures > 5
      || (stored.pending !== null && (!object(stored.pending) || Object.keys(stored.pending).sort().join(',') !== 'deadline,generation,serial'
        || stored.binding === null || stored.pending.generation !== stored.generation || stored.pending.serial !== stored.serial || !integer(stored.pending.deadline)))) {
      throw new Error('模型刷新调度记录损坏，已拒绝自动刷新。');
    }
    const value = stored as unknown as CatalogRefreshState;
    this.binding = value.binding; this.generation = value.generation; this.serial = value.serial;
    this.pending = value.pending ? Object.freeze({ ...value.pending }) : null;
    this.nextAt = value.nextAt; this.failures = value.failures; this.lastNow = value.lastNow;
  }

  snapshot(): CatalogRefreshState {
    return { binding: this.binding, generation: this.generation, serial: this.serial,
      pending: this.pending ? { ...this.pending } : null, nextAt: this.nextAt, failures: this.failures, lastNow: this.lastNow };
  }
  currentTicket(): CatalogRefreshTicket | null { return this.pending; }

  private clock(now: number): void {
    if (!Number.isSafeInteger(now) || now < this.lastNow || now > Number.MAX_SAFE_INTEGER - MAX_BACKOFF) {
      throw new Error('模型刷新调度时间不合法或发生回退，已拒绝本次调度。');
    }
    this.lastNow = now;
  }

  // null为默认/关闭状态。同身份重复配置不清除在途请求或限频。
  configure(binding: string | null): void {
    if (binding !== null && (!binding.trim() || binding.length > 500 || /[\u0000-\u001f\u007f]/u.test(binding))) {
      throw new Error('模型刷新授权绑定不合法。');
    }
    if (binding === this.binding) return;
    this.binding = binding; this.generation++; this.pending = null; this.failures = 0;
    // 切换/关闭再开启不能绕过已有冷却。
  }

  private failed(now: number): void {
    this.failures = Math.min(this.failures + 1, 5);
    this.nextAt = now + Math.min(MAX_BACKOFF, INTERVAL * 2 ** (this.failures - 1));
    this.pending = null;
  }

  take(now: number): CatalogRefreshTicket | null {
    this.clock(now);
    if (this.pending && now >= this.pending.deadline) this.failed(now);
    if (this.binding === null || this.pending || now < this.nextAt) return null;
    const ticket = Object.freeze({ generation: this.generation, serial: ++this.serial, deadline: now + TIMEOUT });
    this.pending = ticket; this.nextAt = now + INTERVAL;
    return ticket;
  }

  // 只接受当前原始凭证；关闭/换连接后的旧结果、伪造复制品均不能被用于写目录。
  complete(ticket: CatalogRefreshTicket, success: boolean, now: number): boolean {
    this.clock(now);
    if (this.binding === null || this.pending !== ticket || ticket.generation !== this.generation) return false;
    if (now >= ticket.deadline) { this.failed(now); return false; }
    if (!success) { this.failed(now); return true; }
    this.pending = null; this.failures = 0;
    return true;
  }
}
