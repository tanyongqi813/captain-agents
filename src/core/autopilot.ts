import { mkdir, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { paths, safeName } from './paths.ts';
import { readJson, writeJson, withLock, hasCode } from './fsx.ts';
import { stamp } from './ids.ts';
import { findProject } from './project.ts';
import { readSettings } from './settings.ts';
import { checkChoice } from './policy.ts';
import { selection } from './workers.ts';
import { readyTask } from './plan-dispatch.ts';
import { checkSplitGraph, isDiagnosisAction, isOwnerCode, MAX_SPLIT_DEPTH, ownerReasons } from './autopilot-diagnosis.ts';
import type { DiagnosisAction, OwnerCode, SplitNode } from './autopilot-diagnosis.ts';
import type { Job } from './job.ts';

// 无人看守（有界自治）的执行登记。设计见 docs/decisions/ADR-001-bounded-autonomy.md 与 docs/tasks/TASK-009.md。
// 全局状态单独落盘在 ~/.xagents/autopilots/<编号>/run.json，不塞进 Job 或 Batch：
// 一件活的记录是"这一次派活"，一台无人看守的记录是"整台执行走到哪了"，两者的寿命和更新频率都不一样。
//
// 这里只管登记与判定，不启动任何外部工作（推进器在 autopilot-engine.ts）。三条硬规矩：
// 1. 所有"读 → 改 → 写"都在这一台执行自己的锁里做（withLock + 先写临时文件再改名）。
// 2. 每次外部动作先领一个动作令牌（action.token）并落盘，再动手；改状态时要带着当前令牌回来，对不上就拒绝。
// 3. 任何预算（时长、尝试、节点、已知用量）用完只能转 needs_owner 或收尾，不许继续调外部动作。

export type AutopilotState =
  // 骨架的九个状态。前六个是"还在走"，后三个是"已经停下"。
  | 'planning' | 'executing' | 'reviewing' | 'verifying' | 'diagnosing' | 'recovering'
  | 'completed' | 'needs_owner' | 'stopped';

export const AUTOPILOT_STATES: readonly AutopilotState[] = [
  'planning', 'executing', 'reviewing', 'verifying', 'diagnosing', 'recovering', 'completed', 'needs_owner', 'stopped',
];
// 还在走的状态：推进器只在这些状态里干活。
export const ACTIVE_STATES: readonly AutopilotState[] = ['planning', 'executing', 'reviewing', 'verifying', 'diagnosing', 'recovering'];
export const ENDED_STATES: readonly AutopilotState[] = ['completed', 'needs_owner', 'stopped'];
export const isActiveState = (state: string): state is AutopilotState => ACTIVE_STATES.includes(state as AutopilotState);
export const isEndedState = (state: string): state is AutopilotState => ENDED_STATES.includes(state as AutopilotState);

// 状态的中文说法只在核心写一份，命令行和错误提示都用它。
export const stateNames: Record<AutopilotState, string> = {
  planning: '准备中', executing: '在干', reviewing: '等审查', verifying: '等验收',
  diagnosing: '在诊断', recovering: '等恢复', completed: '已完成', needs_owner: '等主人', stopped: '已停止',
};

// 预算项名称只在这里定义一次，登记、推进器、命令行都用它，免得各说各话。
export type BudgetLimit = 'minutes' | 'attempts' | 'nodes' | 'usage';
export const budgetNames: Record<BudgetLimit, string> = {
  minutes: '运行时长', attempts: '尝试次数', nodes: '子节点数', usage: '已有用量',
};

// 首版只接受三个策略预设（主人的话：时长/尝试/节点都只给三档，不接受任意数字）。
export type AutopilotPolicyId = 'short' | 'standard' | 'long';
export type AutopilotPolicy = { id: AutopilotPolicyId; minutes: number; attempts: number; nodes: number };
export const POLICY_IDS: readonly AutopilotPolicyId[] = ['short', 'standard', 'long'];
export const PRESETS: Record<AutopilotPolicyId, AutopilotPolicy> = {
  short: { id: 'short', minutes: 60, attempts: 4, nodes: 3 },
  standard: { id: 'standard', minutes: 240, attempts: 10, nodes: 6 },
  long: { id: 'long', minutes: 480, attempts: 16, nodes: 10 },
};
// 细拆深度最大 2；单个节点的 continue 和 retry 各最多 1 次（ADR-001 第 4 条、TASK-009 的设计）。
export const MAX_DEPTH = 2;
export const MAX_CONTINUES_PER_NODE = 1;
export const MAX_RETRIES_PER_NODE = 1;
// 同一个节点最多请几次诊断：留一点余量（失败 → 诊断 → 补做 → 又失败），但绝不让 AI 无限来回。
export const MAX_DIAGNOSES_PER_NODE = 3;

// 待确认的外部动作：先落这个再动手。jobs 只在外部动作真的启动后才写；
// 崩溃恢复时"有令牌没 jobs"要靠外部证据（任务记录里的同一个令牌）判断有没有启动过。
// phase：这个动作是写手在干（execute）还是请负责人 AI 诊断（diagnose）；旧登记没有这一字段，按 execute 读。
// mode：诊断决定"补做"时是 continue（叫醒上一轮那件活，保住副本里的改动），其余是 execute（从起点新派）。
export type AutopilotAction = {
  token: string; node: string; attempt: number; at: string; jobs?: string[];
  phase?: 'execute' | 'diagnose' | 'review'; mode?: 'execute' | 'continue' | 'retry'; prompt?: string;
  retrySource?: string[];
  // 补做要叫醒哪几件活、各叫到第几轮（mode=continue 才有）。先落盘再动手：崩溃后靠它分清"只预留"和"真的叫醒了"，
  // 不会把旧一轮的结果认成新一轮（docs/tasks/TASK-010.md 评审第 5 条）。
  resume?: { job: string; round: number }[];
};
export type AutopilotOutcome = 'done' | 'failed' | 'blocked';
export type AutopilotAttempt = {
  node: string; attempt: number; token: string; at: string; jobs?: string[];
  outcome?: AutopilotOutcome; note?: string;
  // 这一次尝试花掉的用量（只记这一次实际用掉的，旧登记没有这一字段，按 0 算）。
  // job.usage 是"当前这一轮"的用量（续轮开始时清空，归过档的取轮记录），所以这里不再相减。
  usage?: { read: number; cached: number; out: number };
  patch?: string;
};
export type AutopilotNode = { id: string; depth: number; state: 'pending' | 'running' | 'passed' | 'failed' | 'split'; attempts: number; continues: number; retries: number; parent?: string; task?: SplitNode };
export type AutopilotReview = { token: string; node: string; at: string; candidate: string; jobs?: string[]; verdict?: 'pass' | 'changes' | 'unclear'; usage?: { read: number; cached: number; out: number } };
export type AutopilotFlow = {
  version: 1; reviewer: string; accepted: string;
  candidate?: { hash: string; node: string; jobs: string[] };
  reviews: AutopilotReview[];
  verifyStarted?: string;
  verification?: { ok: boolean; at: string; seconds: number; steps: { cmd: string; ok: boolean; exit: number | null; summary: string }[] };
};

// 一次诊断（docs/tasks/TASK-010.md）：证据指纹、请的是哪一件负责人任务、最后决定和原因码。
// 指纹 + 动作相同就是循环；code 是给主人看的结构化原因（TASK-013 拿它发通知，不再调 AI 编文字）。
export type AutopilotDiagnosis = {
  node: string; attempt: number; at: string; token: string; fingerprint: string;
  // 这一次证据里"没被接受的改动"文件数：决定 retry 能不能走（有改动不许从头重做）。
  changes?: number;
  action?: DiagnosisAction; code?: OwnerCode; note?: string; jobs?: string[];
  // 这次诊断本身花掉的用量（也占整台执行的预算）。
  usage?: { read: number; cached: number; out: number };
};
// 诊断给出的候选子任务图（TASK-010 只存，不执行；执行见 TASK-011）。
export type AutopilotSplit = { at: string; source: string; nodes: SplitNode[] };

export type AutopilotRun = {
  id: string;
  version: 1;
  // 起点：项目、仓库、分支起点提交（照创建那一刻的登记抄下来，之后改登记不影响这一台）。
  project: string; repo: string; base: string;
  // 任务：只来自 TASK-006 的核心权威校验入口（docs/TASK_LIST.md + Task Spec），不认任何界面带来的内容。
  taskId: string; spec: string;
  // 主人的选择范围：选手写法（选手:强度[:fast]）、联网与读写快照。策略只存预设。
  who: string[];
  network: boolean; ro: boolean;
  policy: AutopilotPolicy;
  state: AutopilotState;
  reason?: string;            // 停下时给主人看的中文原因
  limit?: BudgetLimit;        // 转 needs_owner 时，是哪一项预算先到
  // 转 needs_owner 的结构化原因码和不超过 300 字的补充说明（旧登记没有，读作空）。
  ownerCode?: OwnerCode; ownerNote?: string;
  // 需要主人时那一条通知事件的稳定编号：和转 needs_owner 在同一次受锁改写里写下，一台执行只有一条。
  // 正文由原因码生成（TASK-013），这里只留编号，用来做到"同一件事不重复通知"。
  ownerEvent?: string;
  created: string; updated: string; ended?: string;
  // 预算核算：运行时长按秒累计（推进器每轮扣掉电脑休眠），尝试与节点按次数，用量按任务记录里已知的数字。
  elapsedSeconds: number;
  sleeps: number;
  attemptCount: number;
  nodeCount: number;
  usage?: { read: number; cached: number; out: number };
  usageLimit?: number;        // 已知用量的上限（有才判），没有就只累计不拦
  action?: AutopilotAction;
  nodes: AutopilotNode[];
  flow?: AutopilotFlow;
  attempts: AutopilotAttempt[];
  // 诊断历史与细拆候选（TASK-010 新增；旧登记没有这两个字段，读作空）。
  diagnoses?: AutopilotDiagnosis[];
  split?: AutopilotSplit;
  // 诊断决定"补做/重试"后，下一次写手尝试要带上的补充题目；动作一开就搬到 action 里，写手用不着再读诊断。
  nextPrompt?: { node: string; mode: 'continue' | 'retry'; prompt: string };
  // 推进器（隔离外的后台进程）。
  pid?: number; pidSince?: number;
};

export type AutopilotStartOptions = {
  project: string;
  taskId: string;
  who: string[];
  policy?: string;
  ro?: boolean;
  reviewer?: string;
};

const RUN_MAX_BYTES = 2 * 1024 * 1024;

export const autopilotsDir = () => join(paths().home, 'autopilots');
// 全局登记锁：查重、分配编号、建目录、写初始登记必须在同一把锁里做完。
// 编号唯一挡不住"同一任务建两台"，那要靠这把锁把"扫描 → 判断 → 分配 → 落盘"串成一个动作。
export const registryLockDir = () => join(autopilotsDir(), '.registry');
export const autopilotDir = (id: string) => join(autopilotsDir(), safeName(id));
export const runFile = (id: string) => join(autopilotDir(id), 'run.json');
// 这台执行的动作锁（跨进程）：把"复核权威状态与令牌 → 查证据 → 真的派出去 → 写回任务号"串成一段互斥。
// 进程内的 Set 只挡同进程误用，挡不住另一个推进器进程；真正的排他靠这把文件锁（属主进程死了能被回收）。
export const actionLockDir = (id: string) => join(autopilotDir(id), '.action');

// 平台自己生成的编号：0918-1530-auto、0918-1530-auto-2。
const ID_SHAPE = /^\d{4}-\d{4}-auto(?:-\d+)?$/;
// 选手写法：选手:强度[:fast]，三段以内，不带空格冒号。
const WHO_SHAPE = /^[^\s:]{1,64}(?::[^\s:]{1,32}){0,2}$/;

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value;
const isWhen = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
// 计数与秒数一律要求有限、非负；整数项还必须是整数（NaN、Infinity 在 JSON 里会变成 null，同样在这里被挡下）。
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isCount = (value: unknown): value is number => isNumber(value) && Number.isInteger(value);
const isIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 64 && value.every(item => isText(item, 200));
const isRelative = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 400 && !isAbsolute(value)
  && !value.split(/[\\/]/).some(part => part === '..');

// 旧记录、手改坏的记录、被放宽过预算的记录一律失败关闭：宁可报错让主人看，也不按半份或放宽的登记继续推进。
// 这里一个字段都不"顺手修好"：要恢复就请主人从备份恢复或删掉重来。
export function parseRun(value: unknown, id: string): AutopilotRun {
  return assertRun(value, id);
}

export function assertRun(value: unknown, id: string, prefix = `无人看守 ${id} 的登记文件不对`): AutopilotRun {
  const bad = (why: string): never => { throw new Error(`${prefix}：${why}。请从备份恢复或删掉后重新启动。`); };
  if (typeof id !== 'string' || !ID_SHAPE.test(id)) throw bad('目录名不是平台生成的编号');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('不是对象');
  const run = value as Record<string, unknown>;
  if (run.version !== 1) throw bad('版本不认识');
  if (run.id !== id) throw bad(`编号和目录对不上（登记里是 ${JSON.stringify(run.id)}）`);
  if (!isText(run.project, 200)) throw bad('项目名无效');
  if (!isText(run.repo, 4096) || !isAbsolute(run.repo)) throw bad('仓库路径无效');
  if (typeof run.base !== 'string' || !/^[0-9a-f]{7,64}$/.test(run.base)) throw bad('起点提交无效');
  if (typeof run.taskId !== 'string' || !/^TASK-\d{1,6}$/.test(run.taskId)) throw bad('任务编号无效');
  if (!isRelative(run.spec)) throw bad('任务说明路径无效');
  if (typeof run.state !== 'string' || !AUTOPILOT_STATES.includes(run.state as AutopilotState)) throw bad('状态不认识');
  // 选手范围：数组形状、数量、每一项的写法都要对。
  const who = run.who;
  if (!Array.isArray(who)) throw bad('选手范围不是 1–6 位');
  if (who.length < 1 || who.length > 6) throw bad('选手范围不是 1–6 位');
  for (const item of who) if (typeof item !== 'string' || !WHO_SHAPE.test(item)) throw bad('选手写法不对');
  if (typeof run.network !== 'boolean') throw bad('联网快照不是真假值');
  if (typeof run.ro !== 'boolean') throw bad('只读快照不是真假值');
  // 策略只认三个预设，而且数值必须和预设逐项一致：手改数字等于放宽预算，一律不认。
  const policy = run.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw bad('策略不认识');
  const chosen = policy as Record<string, unknown>;
  const policyId = String(chosen.id);
  if (!(POLICY_IDS as readonly string[]).includes(policyId)) throw bad('策略不认识');
  const preset = PRESETS[policyId as AutopilotPolicyId];
  if (chosen.minutes !== preset.minutes || chosen.attempts !== preset.attempts || chosen.nodes !== preset.nodes) {
    throw bad(`${policyId} 预设的数值被改过（应为 ${preset.minutes} 分钟 / ${preset.attempts} 次尝试 / ${preset.nodes} 个节点）`);
  }
  // 时间。
  if (!isWhen(run.created)) throw bad('创建时间无效');
  if (!isWhen(run.updated)) throw bad('更新时间无效');
  if (run.ended !== undefined && !isWhen(run.ended)) throw bad('结束时间无效');
  if (isWhen(run.created) && isWhen(run.updated) && Date.parse(run.updated) < Date.parse(run.created)) throw bad('更新时间早于创建时间');
  // 预算核算用的数字。
  if (!isNumber(run.elapsedSeconds)) throw bad('运行时长无效');
  if (!isNumber(run.sleeps)) throw bad('休眠时长无效');
  if (!isCount(run.attemptCount)) throw bad('尝试次数无效');
  if (!isCount(run.nodeCount)) throw bad('节点数无效');
  if (run.usage !== undefined) {
    const usage = run.usage;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) throw bad('用量记录无效');
    const spent = usage as Record<string, unknown>;
    if (!isNumber(spent.read) || !isNumber(spent.cached) || !isNumber(spent.out)) throw bad('用量记录无效');
  }
  if (run.usageLimit !== undefined && !(isNumber(run.usageLimit) && run.usageLimit > 0)) throw bad('用量上限无效');
  // 推进器进程号：有就得是整数（0 或负数算"没有合法进程号"，交给恢复流程处理，不当成坏记录）。
  // 出生时间只在 Windows 上才有（macOS 那边 processSince 一律 undefined），所以它单独出现才算坏。
  if (run.pid !== undefined && (typeof run.pid !== 'number' || !Number.isInteger(run.pid))) throw bad('推进器进程号无效');
  if (run.pidSince !== undefined) {
    if (run.pid === undefined) throw bad('有推进器启动时间却没有进程号');
    if (!isNumber(run.pidSince)) throw bad('推进器启动时间无效');
  }
  // 待确认的动作。
  if (run.action !== undefined) {
    const action = run.action;
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw bad('待确认动作无效');
    const pending = action as Record<string, unknown>;
    if (!isText(pending.token, 200)) throw bad('动作令牌无效');
    if (!isText(pending.node, 200)) throw bad('动作节点无效');
    if (!isCount(pending.attempt) || pending.attempt < 1) throw bad('动作尝试序号无效');
    if (!isWhen(pending.at)) throw bad('动作时间无效');
    if (pending.jobs !== undefined && !isIds(pending.jobs)) throw bad('动作任务号无效');
    if (pending.phase !== undefined && !['execute', 'diagnose', 'review'].includes(String(pending.phase))) throw bad('动作类型不认识');
    if (pending.phase === 'review' && !run.flow) throw bad('审查动作缺少闭环登记');
    if (pending.mode !== undefined && pending.mode !== 'execute' && pending.mode !== 'continue' && pending.mode !== 'retry') throw bad('动作方式不认识');
    if (pending.retrySource !== undefined && (!isIds(pending.retrySource) || !pending.retrySource.length)) throw bad('重试来源无效');
    if (pending.mode === 'retry' && pending.retrySource === undefined) throw bad('重试缺少来源');
    if (pending.prompt !== undefined && !isText(pending.prompt, 1200)) throw bad('动作里的补充题目无效');
    if (pending.mode === 'continue' && pending.prompt === undefined) throw bad('补做的动作缺少补充题目');
    if (pending.resume !== undefined) {
      if (pending.mode !== 'continue') throw bad('只有补做的动作才记续接意图');
      if (!Array.isArray(pending.resume) || !pending.resume.length || pending.resume.length > 12) throw bad('续接意图无效');
      for (const item of pending.resume) {
        const row = item as Record<string, unknown> | null;
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw bad('续接意图无效');
        if (!isText(row.job, 200) || !isCount(row.round) || row.round < 2) throw bad('续接意图无效');
      }
    }
  }
  // 节点：深度、状态、三个计数都要在范围内。
  const nodes = run.nodes;
  if (!Array.isArray(nodes)) throw bad('缺少节点记录');
  if (!nodes.length) throw bad('缺少节点记录');
  for (const item of nodes) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad('节点记录不是对象');
    const node = item as Record<string, unknown>;
    if (!isText(node.id, 200)) throw bad('节点编号无效');
    if (!isCount(node.depth) || node.depth > MAX_DEPTH) throw bad(`节点深度超过 ${MAX_DEPTH}`);
    if (typeof node.state !== 'string' || !['pending', 'running', 'passed', 'failed', 'split'].includes(node.state)) throw bad('节点状态不认识');
    if (node.parent !== undefined && (!isText(node.parent, 200) || !nodes.some(n => n?.id === node.parent))) throw bad('父节点无效');
    if (node.task !== undefined) {
      try { checkSplitGraph([{ ...(node.task as SplitNode), deps: [] }]); } catch { throw bad('子节点题目无效'); }
      if ((node.task as SplitNode).id !== node.id || !Array.isArray((node.task as SplitNode).deps)
        || (node.task as SplitNode).deps.some(dep => !nodes.some(n => n?.id === dep))) throw bad('子节点依赖无效');
    }
    if (!isCount(node.attempts)) throw bad('节点尝试次数无效');
    if (!isCount(node.continues) || node.continues > MAX_CONTINUES_PER_NODE) throw bad('节点续做次数超过上限');
    if (!isCount(node.retries) || node.retries > MAX_RETRIES_PER_NODE) throw bad('节点重试次数超过上限');
  }
  // 尝试记录：令牌、序号、结局都要对。
  const attempts = run.attempts;
  if (!Array.isArray(attempts)) throw bad('缺少尝试记录');
  for (const item of attempts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad('尝试记录不是对象');
    const attempt = item as Record<string, unknown>;
    if (!isText(attempt.node, 200)) throw bad('尝试的节点编号无效');
    if (!isCount(attempt.attempt) || attempt.attempt < 1) throw bad('尝试序号无效');
    if (!isText(attempt.token, 200)) throw bad('尝试令牌无效');
    if (!isWhen(attempt.at)) throw bad('尝试时间无效');
    if (attempt.jobs !== undefined && !isIds(attempt.jobs)) throw bad('尝试的任务号无效');
    if (attempt.outcome !== undefined && (typeof attempt.outcome !== 'string' || !['done', 'failed', 'blocked'].includes(attempt.outcome))) throw bad('尝试结局不认识');
    if (attempt.note !== undefined && !isText(attempt.note, 500)) throw bad('尝试备注无效');
    if (attempt.patch !== undefined && (typeof attempt.patch !== 'string' || !/^[a-f0-9]{64}$/.test(attempt.patch))) throw bad('尝试补丁快照无效');
    if (attempt.usage !== undefined) {
      const spent = attempt.usage;
      if (!spent || typeof spent !== 'object' || Array.isArray(spent)) throw bad('尝试用量记录无效');
      const row = spent as Record<string, unknown>;
      if (!isNumber(row.read) || !isNumber(row.cached) || !isNumber(row.out)) throw bad('尝试用量记录无效');
    }
  }
  if (attempts.length !== run.attemptCount) throw bad(`尝试次数和记录对不上（${attempts.length} 条记录 / 计数 ${String(run.attemptCount)}）`);
  if (nodes.length !== run.nodeCount) throw bad(`节点数和记录对不上（${nodes.length} 条记录 / 计数 ${String(run.nodeCount)}）`);
  if (new Set(nodes.map(n => n.id)).size !== nodes.length) throw bad('节点编号重复');
  if (run.flow !== undefined) {
    const flow = run.flow as AutopilotFlow;
    const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    if (!flow || flow.version !== 1 || !isText(flow.reviewer, 100) || !WHO_SHAPE.test(flow.reviewer) || !hash(flow.accepted)
      || !Array.isArray(flow.reviews) || flow.reviews.length > PRESETS.long.attempts || who.length !== 1 || run.ro) throw bad('闭环登记无效');
    try { if (selection(flow.reviewer).who === selection(String(who[0])).who) throw new Error(); } catch { throw bad('审查者必须独立选择'); }
    if (flow.candidate && (!hash(flow.candidate.hash) || !nodes.some(n => n.id === flow.candidate!.node) || !isIds(flow.candidate.jobs) || !flow.candidate.jobs.length)) throw bad('候选补丁无效');
    for (const review of flow.reviews) {
      if (!review || !isText(review.token, 200) || !isWhen(review.at) || !nodes.some(n => n.id === review.node) || !hash(review.candidate)
        || review.jobs !== undefined && !isIds(review.jobs) || review.verdict !== undefined && !['pass', 'changes', 'unclear'].includes(review.verdict)) throw bad('审查记录无效');
      if (review.usage && (!isNumber(review.usage.read) || !isNumber(review.usage.cached) || !isNumber(review.usage.out))) throw bad('审查用量无效');
    }
    if (flow.verification && (typeof flow.verification.ok !== 'boolean' || !isWhen(flow.verification.at) || !isNumber(flow.verification.seconds)
      || !Array.isArray(flow.verification.steps) || flow.verification.steps.some(s => !s || typeof s.cmd !== 'string' || typeof s.ok !== 'boolean'
        || typeof s.summary !== 'string' || s.exit !== null && !Number.isInteger(s.exit)))) throw bad('闭环验收记录无效');
    if (flow.verifyStarted !== undefined && !isWhen(flow.verifyStarted)) throw bad('验收启动记录无效');
    const visiting = new Set<string>(), visited = new Set<string>();
    const walk = (id: string, depth: number) => {
      if (depth > nodes.length || visiting.has(id)) throw bad('节点依赖有环');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dep of nodes.find(n => n.id === id)!.task?.deps ?? []) walk(dep, depth + 1);
      visiting.delete(id); visited.add(id);
    };
    for (const node of nodes) {
      walk(node.id, 0);
      if (node.parent && nodes.find(n => n.id === node.parent)!.depth + 1 !== node.depth) throw bad('父节点深度不一致');
    }
  }
  // 状态对应的不变量：结束状态必须有结束时间，没结束的不能有；结束之后不能再挂着待确认动作。
  const state = run.state as AutopilotState;
  if (state === 'completed' && run.flow) {
    const flow = run.flow as AutopilotFlow;
    if (!flow.verification?.ok || flow.candidate || nodes.some(n => n.state !== 'passed')
      || nodes.some(n => !nodes.some(c => c.parent === n.id) && !flow.reviews.some(r => r.node === n.id && r.verdict === 'pass'))) throw bad('缺少已通过的独立审查和最终验收');
  }
  const ended = run.ended !== undefined;
  if (isEndedState(state) && !ended) throw bad(`${state} 状态缺少结束时间`);
  if (!isEndedState(state) && ended) throw bad(`${state} 状态不该有结束时间`);
  if (run.action !== undefined && !isActiveState(state)) throw bad('已经结束的登记还挂着待确认动作');
  if (run.limit !== undefined) {
    if (state !== 'needs_owner') throw bad('预算上限标记只属于 needs_owner');
    if (!Object.hasOwn(budgetNames, String(run.limit))) throw bad('预算项不认识');
  }
  if (run.reason !== undefined && !isText(run.reason, 500)) throw bad('原因文字无效');
  if ((state === 'needs_owner' || state === 'stopped') && run.reason === undefined) throw bad(`${state} 状态缺少原因`);
  // 结构化原因码与补充说明：只属于 needs_owner；旧登记没有这两个字段，照常读。
  if (run.ownerCode !== undefined && !isOwnerCode(run.ownerCode)) throw bad('原因码不认识');
  if (run.ownerCode !== undefined && state !== 'needs_owner') throw bad('原因码只属于 needs_owner');
  if (run.ownerNote !== undefined) {
    if (state !== 'needs_owner') throw bad('原因补充只属于 needs_owner');
    if (!isText(run.ownerNote, 300)) throw bad('原因补充无效');
  }
  if (run.ownerEvent !== undefined) {
    if (state !== 'needs_owner') throw bad('通知事件号只属于 needs_owner');
    if (!isText(run.ownerEvent, 100)) throw bad('通知事件号无效');
  }
  // 诊断历史（TASK-010）：指纹、动作、原因码都在白名单里，长度受控。
  if (run.diagnoses !== undefined) {
    if (!Array.isArray(run.diagnoses)) throw bad('诊断记录不是数组');
    if (run.diagnoses.length > 64) throw bad('诊断记录条数超过上限');
    for (const item of run.diagnoses) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad('诊断记录不是对象');
      const row = item as Record<string, unknown>;
      if (!isText(row.node, 200)) throw bad('诊断的节点编号无效');
      if (!isCount(row.attempt) || row.attempt < 1) throw bad('诊断的尝试序号无效');
      if (!isWhen(row.at)) throw bad('诊断时间无效');
      if (!isText(row.token, 200)) throw bad('诊断令牌无效');
      if (typeof row.fingerprint !== 'string' || !/^[0-9a-f]{16}$/.test(row.fingerprint)) throw bad('诊断指纹无效');
      if (row.changes !== undefined && !isCount(row.changes)) throw bad('诊断里的改动数无效');
      if (row.action !== undefined && !isDiagnosisAction(row.action)) throw bad('诊断动作不认识');
      if (row.code !== undefined && !isOwnerCode(row.code)) throw bad('诊断原因码不认识');
      if (row.note !== undefined && !isText(row.note, 600)) throw bad('诊断说明无效');
      if (row.jobs !== undefined && !isIds(row.jobs)) throw bad('诊断任务号无效');
      if (row.usage !== undefined) {
        const spent = row.usage as Record<string, unknown> | null;
        if (!spent || typeof spent !== 'object' || Array.isArray(spent)) throw bad('诊断用量记录无效');
        if (!isNumber(spent.read) || !isNumber(spent.cached) || !isNumber(spent.out)) throw bad('诊断用量记录无效');
      }
    }
  }
  // 细拆候选图：只认五个字段、不循环、深度受控（同一个校验器，不在别处另写一份）。
  if (run.split !== undefined) {
    const split = run.split;
    if (!split || typeof split !== 'object' || Array.isArray(split)) throw bad('细拆记录无效');
    const row = split as Record<string, unknown>;
    if (!isWhen(row.at)) throw bad('细拆时间无效');
    if (row.source !== undefined && !isText(row.source, 200)) throw bad('细拆来源无效');
    try { checkSplitGraph(row.nodes); } catch (error) { throw bad(`细拆候选图${(error as Error).message}`); }
  }
  // 待用的补充题目：还在走的时候才能挂着。
  if (run.nextPrompt !== undefined) {
    const row = run.nextPrompt as Record<string, unknown> | null;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw bad('待用的补充题目无效');
    if (!isText(row.node, 200)) throw bad('待用的节点编号无效');
    if (row.mode !== 'continue' && row.mode !== 'retry') throw bad('待用的补充题目方式不认识');
    if (!isText(row.prompt, 1200)) throw bad('待用的补充题目无效');
    if (isEndedState(state)) throw bad('已经结束的登记还挂着待用的补充题目');
  }
  return run as AutopilotRun;
}

export async function readAutopilot(id: string): Promise<AutopilotRun> {
  let text: unknown;
  try { text = await readJson<unknown>(runFile(id)); }
  catch (e) {
    if (hasCode(e, 'ENOENT')) throw new Error(`找不到无人看守 ${id}。请先运行 xagents autopilot list。`);
    throw e;
  }
  return parseRun(text, id);
}

// 只读列表：单条损坏不拖垮整份列表，但会把它记在 broken 里让调用方报出来。
export async function listAutopilots(): Promise<{ runs: AutopilotRun[]; broken: string[] }> {
  let entries;
  try { entries = await readdir(autopilotsDir(), { withFileTypes: true }); }
  catch (e) { if (hasCode(e, 'ENOENT')) return { runs: [], broken: [] }; throw e; }
  const runs: AutopilotRun[] = [], broken: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try { runs.push(await readAutopilot(entry.name)); }
    catch (e) {
      if (hasCode(e, 'ENOENT')) continue;
      if (e instanceof SyntaxError || (e instanceof Error && e.message.startsWith('无人看守'))) { broken.push(entry.name); continue; }
      throw e;
    }
  }
  runs.sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id));
  return { runs, broken };
}

// 改登记一律在锁里"读 → 改 → 写"；写的是先写临时文件再改名（writeJson 内部就是）。
// 写之前按同一套规矩再校验一遍：坏记录不许进盘，NaN、被改宽的预算、不自洽的计数都拦在写入口。
export async function updateAutopilot(id: string, fn: (run: AutopilotRun) => void | Promise<void>): Promise<AutopilotRun> {
  return withLock(autopilotDir(id), async () => {
    const run = await readAutopilot(id);
    await fn(run);
    run.updated = new Date().toISOString();
    const text = JSON.stringify(run, null, 2) + '\n';
    if (text.length > RUN_MAX_BYTES) throw new Error(`无人看守 ${id} 的登记超过 ${RUN_MAX_BYTES / 1024} KB，拒绝写入。`);
    assertRun(JSON.parse(text), id, `无人看守 ${id} 这次要写进去的登记不对`);
    await writeJson(runFile(id), run);
    return run;
  });
}

export async function guardAutopilotJob(job: Pick<Job, 'autopilot'>): Promise<void> {
  if (job.autopilot && isActiveState((await readAutopilot(job.autopilot.run)).state)) {
    throw new Error('无人看守还在推进，不能单独清理、拍板或验收其中的任务；请先停止整台执行。');
  }
}

// 带令牌改状态：这是"推进器互斥"的落点——两个推进器同时动手时，只有一个的令牌还是当前的，另一个被拒绝。
export async function transition(id: string, token: string | undefined, fn: (run: AutopilotRun) => void | Promise<void>): Promise<AutopilotRun> {
  return updateAutopilot(id, async run => {
    if (!isActiveState(run.state)) throw new Error(`无人看守 ${id} 已经停在 ${run.state}，不能再推进。`);
    if (token !== undefined && run.action?.token !== token) {
      throw new Error(`无人看守 ${id} 的动作令牌已经换人（当前 ${run.action?.token ?? '无'}），这一步作废。`);
    }
    if (token !== undefined) delete run.action;
    await fn(run);
  });
}

function policyOf(value: string | undefined): AutopilotPolicy {
  if (value === undefined) return PRESETS.standard;
  if (!(POLICY_IDS as readonly string[]).includes(value)) {
    throw new Error(`策略只接受 short（短任务）、standard（标准）、long（长任务）三种预设，不接受别的写法或任意数字。`);
  }
  return PRESETS[value as AutopilotPolicyId];
}

// 创建：所有校验都在写文件之前做完。任务是否真的可执行只由 TASK-006 的权威入口判断。
const reserveAutopilot = async (now: Date): Promise<string> => {
  const prefix = `${stamp(now)}-auto`;
  for (let n = 1; ; n++) {
    const id = n === 1 ? prefix : `${prefix}-${n}`;
    try { await mkdir(autopilotDir(id)); return id; }
    catch (e) { if (!hasCode(e, 'EEXIST')) throw e; }
  }
};

export async function createAutopilot(options: AutopilotStartOptions, now = new Date()): Promise<AutopilotRun> {
  if (!options || typeof options !== 'object') throw new Error('无人看守的启动参数格式不对。');
  if (typeof options.project !== 'string') throw new Error('请用 --project 指定已登记的项目。');
  const projectName = safeName(options.project);
  if (typeof options.taskId !== 'string' || !/^TASK-\d{1,6}$/.test(options.taskId)) {
    throw new Error('任务编号要写成 TASK-数字，请从项目规划里选一项可执行的任务。');
  }
  const policy = policyOf(options.policy);
  if (!Array.isArray(options.who) || !options.who.length) throw new Error('请用 --who 指定至少一位选手。');
  if (options.who.length > 6) throw new Error('无人看守的选手范围最多 6 位，请删掉几位。');
  if (options.who.some(item => typeof item !== 'string' || item.length > 100)) throw new Error('选手写法不对，请写成 选手:强度[:fast]。');
  if (options.ro !== undefined && typeof options.ro !== 'boolean') throw new Error('--ro 只能表示只读，不能带值。');
  if (options.reviewer !== undefined && (typeof options.reviewer !== 'string' || !WHO_SHAPE.test(options.reviewer)
    || options.who.length !== 1 || options.ro || selection(options.reviewer).who === selection(options.who[0]).who)) {
    throw new Error('自动审查闭环必须明确选择一位可写执行者和另一位只读审查者。');
  }

  const project = await findProject(projectName).catch(error => {
    // 没登记的项目给中文说法，不把 ENOENT 抛给主人。
    if (hasCode(error, 'ENOENT')) throw new Error(`没有登记叫 ${projectName} 的项目，请先运行 xagents project add。`);
    throw error;
  });
  const settings = await readSettings();
  if (settings.archivedProjects.includes(project.name)) throw new Error('这个项目已归档，请先取消归档再启动无人看守。');
  // 选手范围必须在 roster 与主人策略之内（收窄可以，放宽不行）；真正的派活还会再校验一次。
  const choices = options.who.map(item => selection(item));
  for (const choice of choices) checkChoice(settings.workers, choice);
  if (options.reviewer) checkChoice(settings.workers, selection(options.reviewer));
  // 权威校验：重新读项目的任务规划，只有 TASK-006 判定为可执行的任务才能启动。
  const { task } = await readyTask(project.name, options.taskId);
  const base = await projectBase(project.repo);
  if (!/^[0-9a-f]{7,64}$/.test(base)) throw new Error('这个项目的起点提交读不出来（仓库可能还没有提交），请先在仓库里提交一次。');
  const createdAt = now.toISOString();

  // 一把全局锁把四件事串成一个动作：扫描已有登记 → 判同一任务有没有活跃执行 → 分配编号 → 建目录写初始登记。
  // 只靠"目录编号不重复"挡不住同一任务建两台：两个并发启动会都跳过查重。
  return withLock(registryLockDir(), async () => {
    const { runs } = await listAutopilots();
    const duplicate = runs.find(run => isActiveState(run.state) && run.project === project.name && run.taskId === task.id);
    if (duplicate) throw new Error(`这个任务已经有一台无人看守在推进（${duplicate.id}），请先 stop 或等它结束。`);
    const id = await reserveAutopilot(now);
    const run: AutopilotRun = {
      id, version: 1,
      project: project.name, repo: project.repo, base,
      taskId: task.id, spec: task.spec ?? `docs/tasks/${task.id}.md`,
      who: [...options.who], network: settings.networkAllowed, ro: options.ro === true,
      policy: { ...policy }, state: 'planning',
      created: createdAt, updated: createdAt,
      elapsedSeconds: 0, sleeps: 0,
      attemptCount: 0, nodeCount: 1,
      nodes: [{ id: task.id, depth: 0, state: 'pending', attempts: 0, continues: 0, retries: 0 }],
      attempts: [],
      ...(options.reviewer ? { flow: { version: 1 as const, reviewer: options.reviewer,
        accepted: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', reviews: [] } } : {}),
    };
    assertRun(JSON.parse(JSON.stringify(run)), id, `无人看守 ${id} 这次要写进去的登记不对`);
    await writeJson(runFile(id), run);
    return run;
  });
}

async function projectBase(repo: string): Promise<string> {
  const { git } = await import('./worktree.ts');
  try { return (await git(repo, ['rev-parse', '--verify', 'refs/heads/main^{commit}'])).trim(); }
  catch { return (await git(repo, ['rev-parse', 'HEAD'])).trim(); }
}

// 预算核算：时长按累计秒数（已扣休眠），尝试、节点按次数，用量按任务记录里已知的数字。
// 外部 AI 尝试的总数：写手的每一轮 + 每一次负责人诊断。预设里的"4/10/16 次"是这台执行能调用 AI 的总次数，
// 诊断同样花额度和时间，所以必须一起算（docs/tasks/TASK-010.md 评审第 2 条）。写手序号仍单独存在 attemptCount 里。
export function aiAttempts(run: AutopilotRun): number {
  return run.attemptCount + (run.diagnoses?.length ?? 0) + (run.flow?.reviews.length ?? 0);
}
export function budgetUsed(run: AutopilotRun): { minutes: number; attempts: number; nodes: number; usage: number } {
  const usage = run.usage ? run.usage.read + run.usage.cached + run.usage.out : 0;
  return { minutes: run.elapsedSeconds / 60, attempts: aiAttempts(run), nodes: run.nodeCount, usage };
}

// 哪一项预算先到就返回哪一项；都没到返回 null。判定用 >=：到了上限就不许再动外部工作。
export function exceededBudget(run: AutopilotRun): BudgetLimit | null {
  const used = budgetUsed(run);
  if (used.minutes >= run.policy.minutes) return 'minutes';
  if (used.attempts >= run.policy.attempts) return 'attempts';
  if (used.nodes >= run.policy.nodes) return 'nodes';
  if (run.usageLimit !== undefined && used.usage >= run.usageLimit) return 'usage';
  return null;
}

// 动手前最后一道预算复核：只看时长和已知用量。
// 尝试数、节点数是这一步刚记上去的，不能拿"刚记的数"把这一次动手卡住（那会把最后一次机会白白吃掉）。
export function dispatchBudget(run: AutopilotRun): BudgetLimit | null {
  const used = budgetUsed(run);
  if (used.minutes >= run.policy.minutes) return 'minutes';
  if (run.usageLimit !== undefined && used.usage >= run.usageLimit) return 'usage';
  return null;
}

export type AutopilotEvent =
  | { kind: 'intent' }
  | { kind: 'started' }
  | { kind: 'done' }
  | { kind: 'reviewed' }
  | { kind: 'verified' }
  | { kind: 'failed'; note?: string }
  | { kind: 'retry' }
  // 诊断给出的"补做"：diagnosing → executing，节点上的 continues 由调用方加。
  | { kind: 'continue' }
  // 诊断给出的"转验收"：diagnosing → verifying。
  | { kind: 'verify' }
  // 有界结束：带结构化原因码（TASK-013 拿它发通知）。
  | { kind: 'owner'; code: OwnerCode; note?: string }
  | { kind: 'budget'; limit: BudgetLimit }
  | { kind: 'blocked'; note: string }
  | { kind: 'lost'; note: string }
  // 恢复过的登记接回：phase=diagnose 时接回"在诊断"，否则接回"在干"。
  | { kind: 'resume'; phase?: 'execute' | 'diagnose' }
  | { kind: 'stop'; note?: string };

// 转 needs_owner 的中文原因：固定模板 + 可选的一句补充（补充不超过 300 字，总长再卡 500）。
export function ownerReason(code: OwnerCode, note?: string): string {
  const text = note ? `${ownerReasons[code]}（${note}）` : ownerReasons[code];
  const chars = [...text];
  return chars.length > 500 ? chars.slice(0, 500).join('') : text;
}

// 状态机骨架：只做转移和记账，不启动任何外部工作。非法转移返回 false，调用方按失败关闭处理。
export function advance(run: AutopilotRun, event: AutopilotEvent, now = new Date()): boolean {
  const at = now.toISOString();
  const stop = (state: AutopilotState, note: string, limit?: BudgetLimit) => {
    run.state = state; run.reason = note; run.ended = at;
    if (limit) run.limit = limit; else delete run.limit;
    delete run.action; delete run.ownerCode; delete run.ownerNote; delete run.nextPrompt;
    // 需要主人时同一次改写里就写下事件编号：结束状态再也推不动，所以一台执行只会有一个。
    if (state === 'needs_owner') run.ownerEvent = newToken(); else delete run.ownerEvent;
  };
  switch (event.kind) {
    case 'intent':
      // 记下意图：状态进 executing，动作令牌由调用方写进 run.action。还在走的状态都能开下一步。
      if (!isActiveState(run.state)) return false;
      run.state = 'executing';
      return true;
    case 'started':
      return run.state === 'executing';
    case 'done':
      if (run.state !== 'executing') return false;
      run.state = 'reviewing';
      return true;
    case 'reviewed':
      // 骨架还没接审查；留着这条转移供后续任务用，现在没有推进器会发它。
      if (run.state !== 'reviewing') return false;
      run.state = 'verifying';
      return true;
    case 'verified':
      if (run.state !== 'verifying') return false;
      run.state = 'completed'; run.ended = at;
      delete run.reason; delete run.limit; delete run.action; delete run.ownerCode; delete run.ownerNote;
      return true;
    case 'failed':
      if (run.state !== 'executing' && run.state !== 'verifying') return false;
      run.state = 'diagnosing';
      if (event.note) run.reason = event.note;
      return true;
    case 'retry':
      if (run.state !== 'diagnosing') return false;
      if (exceededBudget(run)) return false;
      run.state = 'executing'; delete run.reason;
      return true;
    case 'continue':
      if (run.state !== 'diagnosing') return false;
      if (exceededBudget(run)) return false;
      run.state = 'executing'; delete run.reason;
      return true;
    case 'verify':
      if (run.state !== 'diagnosing') return false;
      run.state = 'verifying'; delete run.reason;
      return true;
    case 'owner': {
      if (isEndedState(run.state)) return false;
      stop('needs_owner', ownerReason(event.code, event.note));
      run.ownerCode = event.code;
      if (event.note) run.ownerNote = event.note;
      return true;
    }
    case 'budget':
      if (isEndedState(run.state)) return false;
      stop('needs_owner', `${budgetNames[event.limit]}预算用完了（${run.policy.id} 预设：${run.policy.minutes} 分钟 / ${run.policy.attempts} 次尝试 / ${run.policy.nodes} 个节点），平台不再自动动手，请主人接手。`, event.limit);
      return true;
    case 'blocked':
      if (isEndedState(run.state)) return false;
      stop('needs_owner', event.note);
      return true;
    case 'lost':
      // 推进器不在了：先记成 recovering，等下一次启动接着走，不当成失败。
      if (!isActiveState(run.state) || run.state === 'recovering') return false;
      run.state = 'recovering'; run.reason = event.note;
      return true;
    case 'resume':
      if (run.state !== 'recovering') return false;
      run.state = event.phase === 'diagnose' ? 'diagnosing' : 'executing'; delete run.reason;
      return true;
    case 'stop':
      if (isEndedState(run.state)) return false;
      stop('stopped', event.note ?? '主人收手了。');
      return true;
    default:
      return false;
  }
}

// 令牌：每次外部动作一个新值。测试里可以用固定值，生产一律随机。
export const newToken = () => randomUUID();

// 这台执行还能不能再试一次：先看预算，再看这个节点上的 retry 次数。
export function canRetry(run: AutopilotRun, node: string): boolean {
  const target = run.nodes.find(item => item.id === node);
  if (!target) return false;
  if (target.retries >= MAX_RETRIES_PER_NODE) return false;
  return exceededBudget(run) === null;
}

// 这个节点还能不能补做（continue）：同样先看预算，再看节点上的 continues 次数。
export function canContinue(run: AutopilotRun, node: string): boolean {
  const target = run.nodes.find(item => item.id === node);
  if (!target) return false;
  if (target.continues >= MAX_CONTINUES_PER_NODE) return false;
  return exceededBudget(run) === null;
}

// 旧登记没有 diagnoses 字段：统一从这里读，调用方不用到处写 ?? []。
export const diagnosesOf = (run: AutopilotRun): AutopilotDiagnosis[] => run.diagnoses ?? [];

// 这个节点还能请几次诊断。到了就转 needs_owner，不许 AI 反复来回。
export function diagnosesLeft(run: AutopilotRun, node: string): number {
  const used = diagnosesOf(run).filter(item => item.node === node).length;
  return Math.max(0, MAX_DIAGNOSES_PER_NODE - used);
}
