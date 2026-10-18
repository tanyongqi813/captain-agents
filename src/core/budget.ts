// 执行预算与停滞判定（docs/tasks/TASK-008.md、docs/decisions/ADR-001-bounded-autonomy.md）。
// 只写纯逻辑：不读文件、不起进程，看管循环（runner.ts）每轮把观测喂进来，时钟可注入，测试能快进。
import { sleptSeconds } from './duration.ts';
import type { Sleep } from './duration.ts';

// 缺省：停滞 20 分钟、宽限 5 分钟、单次硬上限 120 分钟。旧项目登记没有这一字段时按缺省读。
export type Budget = { stallMinutes: number; graceMinutes: number; maxMinutes: number };
export const DEFAULT_BUDGET: Budget = { stallMinutes: 20, graceMinutes: 5, maxMinutes: 120 };

// 校验并规范化一份预算；不合法就抛中文错误。登记项目、派活前都用它把关，
// 题目、选手报告和环境变量都到不了这里，放宽不了预算。
export function checkBudget(value: unknown): Budget {
  const bad = (why: string) => { throw new Error(`执行预算不合法：${why}`); };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) bad('须写成 { "stallMinutes": 停滞分钟, "graceMinutes": 宽限分钟, "maxMinutes": 总上限分钟 }。');
  const raw = value as Record<string, unknown>;
  for (const key of ['stallMinutes', 'graceMinutes', 'maxMinutes']) if (!Number.isInteger(raw[key])) bad(`${key} 必须是整数分钟。`);
  const stallMinutes = raw.stallMinutes as number, graceMinutes = raw.graceMinutes as number, maxMinutes = raw.maxMinutes as number;
  if (stallMinutes < 10 || stallMinutes > 60) bad('停滞时限只允许 10–60 分钟。');
  if (graceMinutes < 1 || graceMinutes > 60) bad('宽限只允许 1–60 分钟。');
  if (maxMinutes < 30 || maxMinutes > 240) bad('单次总上限只允许 30–240 分钟。');
  if (maxMinutes <= stallMinutes + graceMinutes) bad('单次总上限必须大于停滞加宽限。');
  return { stallMinutes, graceMinutes, maxMinutes };
}

// 一次采集喂进来的观测。信号 = 结构化活动时间与日志（run.log/stderr.log）大小或修改时间变化里最新的一个；
// 长时间工具调用的“开始事件”不算新信号，照样会被停滞门槛逮住，最终还有硬上限兜底。
export type BudgetInput = {
  now: number;                       // 时钟（毫秒，可注入）
  startedAt: number;                 // 这件活开跑的时间（毫秒）
  sleeps: Sleep[];                   // 已记录的休眠时段（扣除）
  lastActivityAt: number | null;     // 结构化活动最后时间（毫秒）；取不到是 null
  logChangedAt: number | null;       // 日志最后增长/变化时间（毫秒）；读不到元数据是 null
};
export type BudgetState = {
  // 预警快照已写下时的时钟和当时的信号时间；没有预警是 null。
  warnedAt: number | null;
  warnedSignalAt: number;
};
export const initialBudgetState = (): BudgetState => ({ warnedAt: null, warnedSignalAt: 0 });
export type BudgetEvent = 'stall-warning' | 'stalled' | 'timed-out' | null;
export type BudgetResult = { state: BudgetState; event: BudgetEvent; cleared: boolean };

const awake = (from: number, to: number, sleeps: Sleep[]) => Math.max(0, (to - from) / 1000 - sleptSeconds(sleeps, from, to));

// 停滞判定的状态机：达到停滞门槛写一次预警，固定宽限；期间有新信号就解除，宽限结束仍无变化才算停滞。
// 单次总时限是硬上限，任何时候先到都直接超时。返回新状态和这一 tick 的事件，不读写任何文件。
export function budgetTick(budget: Budget, previous: BudgetState, input: BudgetInput): BudgetResult {
  const signal = Math.max(input.lastActivityAt ?? Number.NEGATIVE_INFINITY, input.logChangedAt ?? Number.NEGATIVE_INFINITY, input.startedAt);
  // 硬上限：从开跑起算，扣休眠。不依赖任何信号，日志元数据全读不到也能兜底。
  if (awake(input.startedAt, input.now, input.sleeps) >= budget.maxMinutes * 60) {
    return { state: previous, event: 'timed-out', cleared: false };
  }
  // 预警之后来了更新的信号（新活动或日志增长）：解除预警，从这次信号重新算停滞。
  if (previous.warnedAt !== null && signal > previous.warnedSignalAt) {
    return { state: { warnedAt: null, warnedSignalAt: 0 }, event: null, cleared: true };
  }
  if (previous.warnedAt === null) {
    // 还没到停滞门槛：照常跑。
    if (awake(signal, input.now, input.sleeps) < budget.stallMinutes * 60) return { state: previous, event: null, cleared: false };
    return { state: { warnedAt: input.now, warnedSignalAt: signal }, event: 'stall-warning', cleared: false };
  }
  // 已有预警：固定宽限（从预警那一刻算，扣休眠），结束仍无新信号就停。
  if (awake(previous.warnedAt, input.now, input.sleeps) < budget.graceMinutes * 60) return { state: previous, event: null, cleared: false };
  return { state: previous, event: 'stalled', cleared: false };
}

// “停滞,宽限,总上限”分钟（如 20,5,120）解析成预算；格式不对或超范围给中文错误。登记项目时把关用。
export function parseBudget(text: string): Budget {
  const parts = text.split(',').map(part => part.trim());
  if (parts.length !== 3 || parts.some(part => !/^\d+$/.test(part))) throw new Error('--budget 请写成“停滞,宽限,总上限”的分钟数，例如 --budget 20,5,120。');
  return checkBudget({ stallMinutes: Number(parts[0]), graceMinutes: Number(parts[1]), maxMinutes: Number(parts[2]) });
}
