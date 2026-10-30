import type { Activity, Batch, DispatchTrace, Job, Rating, Timing, Who } from './job.ts';
import type { Stat } from './stats.ts';
import type { Profile, TagKind } from './profiles.ts';
import type { Provider } from './quota.ts';
import type { Effort } from './roster.ts';
import type { WorkersPolicy } from './policy.ts';
import type { Limits, Storage } from './settings.ts';
import type { DashboardSlice } from './dashboard.ts';
import type { ChannelMessage, ReviewItem, TeamPhase, TeamReason, TeamState } from './team.ts';
import type { TaskPlan } from './task-plan.ts';
import type { AutopilotState } from './autopilot.ts';
import type { LeadReviewAction } from './lead-review.ts';

export type ViewAutopilot = {
  id: string; project: string; taskId: string; state: AutopilotState; active: boolean; managed: boolean;
  created: string; ended: string | null; reason: string | null; writer: string; reviewer: string | null; network: boolean;
  budget: { policy: string; minutesLeft: number; attemptsLeft: number; nodesLeft: number };
  nodes: { id: string; state: string; parent: string | null; deps: string[]; title: string | null }[];
  attempts: { node: string; attempt: number; at: string; outcome: string | null; jobs: string[]; patch: string | null }[];
  diagnoses: { node: string; at: string; action: string | null; note: string | null }[];
  reviews: { node: string; at: string; verdict: string | null; jobs: string[] }[];
  verification: { ok: boolean; at: string; steps: { ok: boolean; summary: string }[] } | null;
  patch: string | null;
  // 只带已验证的最后决定摘要；不包含原胶囊、令牌、候选绑定或执行能力。旧 View 可缺省。
  leadReview?: { decision: { action: LeadReviewAction; at: string; reason: string; capsuleCount: number } | null } | null;
  notification: 'pending' | 'retry' | 'delivered' | 'handled' | 'expired' | 'paused' | 'exhausted' | 'unknown' | null;
};

export type Column = 'running' | 'attention' | 'done';
// 设置页“项目”里一个已登记项目的当前配置（docs/tasks/TASK-003.md）：编辑弹窗按它预填，界面不自己读登记处。
export type ViewProject = { name: string; label: string; repo: string | null; archived: boolean;
  config: { worktreeRoot: string; setup: string[]; verify: string[]; denyReadExtra: string[]; rules: string | null } | null };
// 负责人打的分（只带当前这一版，不带改分前的历史）；标签的好坏由核心分好（src/core/profiles.ts），界面不自己分。
export type ViewRating = {
  score?: Rating['score']; good?: string; improve?: string; external?: string; at: string;
  tags: { tag: string; kind: TagKind }[];
};
export type ViewJob = Pick<Job, 'id' | 'batch' | 'project' | 'who' | 'model' | 'effort' | 'fast' | 'kind' | 'title' | 'summary' | 'state' | 'base'> & {
  autopilot?: { run: string };
  // seconds：已结束的活扣掉电脑休眠后的用时；typical：同一选手、同一类活、做完了的至少 3 件时的通常用时（秒），否则 null。
  started: string; ended: string | null; seconds: number | null; typical: number | null;
  check: { ok: boolean; label: string; note: string } | null;
  // 负责人写明的免验理由（xagents verify --skip）；有它就没有 check。
  checkSkipped: { reason: string; at: string } | null;
  decision: NonNullable<Job['decision']> | null;
  redo: NonNullable<Job['redo']> | null; sleeps: NonNullable<Job['sleeps']>;
  comments: NonNullable<Job['comments']>;
  // 派出时总开关开着才有联网标签。
  network: boolean;
  realCheck: { needed: boolean; steps: string[]; result: { ok: boolean; note: string; at: string; shotCount: number } | null; skipped: { reason: string; at: string } | null } | null;
  rating: ViewRating | null;
  // 任务台账追溯（docs/tasks/TASK-006.md）：从规划派发的活有 Task ID 和 spec 路径；别的活是 null。
  plan: { taskId: string; spec: string } | null;
  // 收尾原因（docs/tasks/TASK-008.md）：手动停、停滞、总超时、看管异常；旧记录没有这一字段，界面显示成 null。
  termination: 'manual' | 'stalled' | 'timed_out' | 'process_error' | null;
  activity: Activity[];
  // 每一步的时间；老任务没有记录时为 null。给人看的话用 src/core/duration.ts 的 describeTiming。
  timing: Timing | null;
  dispatchTrace?: DispatchTrace & { usage: Job['usage'] | null };
  moneyStopAt?: string;
};
// 设置“选手与模型 → 管理模型”用的数据（docs/design-models.md）。每个通道一组；models = 最近发现的名单 ∪ 这个通道已有的选手。
// kept：主人保留着（会出现在选手表里）；builtin：内置选手；fresh：主人上次保存选择之后新冒出来的（标“新”）；
// manual：手动添加；gone：保留着、但最近一次成功问到的名单里已经没有（手动添加的免查）。discoverable：这个通道会不会自动发现（DeepSeek 不会）。
export type ModelChannel = 'codex' | 'grok' | 'cursor' | 'kimi' | 'deepseek';
export type ViewModel = {
  model: string; who: Who; shown: string; description: string | null; efforts: Effort[]; fast: boolean;
  kept: boolean; builtin: boolean; manual: boolean; fresh: boolean; gone: boolean;
};
export type ViewModels = {
  at: string | null;
  channels: { channel: ModelChannel; name: string; icon: string; discoverable: boolean; at: string | null; error: string | null; models: ViewModel[] }[];
};
// 协作页的一个项目群（docs/ui-spec.md 第 17 节）。成员的活仍在 jobs 里（带 chat），工作卡的进度从那里读。
// members[].state：working 正在动手；queued 排队等；idle 空闲。messages：最近 300 条，旧的在前。
// pendingLead：给负责人的、还没处理的话有几条（主人看得到负责人还欠几句回复）。
export type ViewChat = {
  id: string; project: string; title: string; state: 'open' | 'closed'; created: string; closed: string | null;
  members: { who: Who; readOnly: boolean; job: string | null; state: 'working' | 'queued' | 'idle' }[];
  messages: import('./chat.ts').ChatMessage[];
  pendingLead: number; hopLimit: number;
};
// 小队自己的任务看板上的一张卡（docs/design-team.md 第 15 节、docs/ui-spec.md 第 17 节）。
// n = 0 是“交付”本身；n ≥ 1 是审查意见，编号跨轮不变（审查沿用上一轮编号，新意见往后接着编）。
// column：todo 待处理、doing 进行中、review 待复核、done 完成。holder：卡上的头像，现在该谁推动它；没人推动是 null。
// note：卡底一句事实（“提出”“在改”“已改”“不改：……”“复核通过”“第 1 轮交付”……）。
// history：这一条的来龙去脉，旧的在前（谁、第几轮、说了什么），文字是纯文字。
export type TeamTaskColumn = 'todo' | 'doing' | 'review' | 'done';
export type TeamTask = {
  n: number; kind: 'deliver' | 'must' | 'suggest' | 'question'; text: string;
  column: TeamTaskColumn; holder: 'writer' | 'reviewer' | null; note: string;
  round: number; updated: number;
  history: { round: number; from: 'writer' | 'reviewer'; text: string }[];
};
// 看板上的一支小队（第一版只有搭档审改）。队员的活仍在 jobs 里（带 team），界面按 writer / reviewer 取用。
// items：最近一轮审查的意见，带写手的逐条回复；channel：频道（最多最近 200 条，旧的在前）。
// lastLine：卡片底部那一行“名字：内容”，只取队员的报告和负责人、主人的话（不取平台事件），没有就是 null。
export type ViewTeam = {
  id: string; mode: 'pair'; project: string; title: string; summary: string; kind: string;
  state: TeamState; reason: TeamReason | null; note: string | null;
  round: number; maxRounds: number; phase: TeamPhase; maxMinutes: number;
  started: string; ended: string | null;
  writer: string | null; reviewer: string | null;
  writerWho: Who; reviewerWho: Who;
  items: ReviewItem[];
  lastLine: { from: 'writer' | 'reviewer' | 'lead' | 'owner'; text: string; at: string } | null;
  channel: ChannelMessage[];
  // 主人在频道里说的、负责人还没处理的话有几条（卡片角上的留言小圆点）。
  pendingOwner: number;
  // 小队自己的任务看板：交付在最前，其余按编号。
  tasks: TeamTask[];
};
export type View = {
  updated: string;
  settings: { keepAwake: boolean; notifications: boolean; storage: Storage; limits: Limits; workers: WorkersPolicy; networkAllowed?: boolean };
  // 自动清理旧日志的账：清过几件、一共腾出多少字节、现在按设置的天数有几件到期待清（清理关着也照算）。
  storage: { slimmedJobs: number; freedBytes: number; due: number };
  // 表现页的仪表盘：每个时间范围 × （全部项目 + 每个项目）各一份，界面按筛选取用，不自己算。
  dashboard: DashboardSlice[];
  unlisted: { name: string; reason: string }[];
  roster: { who: Who; name: string; model: string; efforts: Effort[]; fastSupported: boolean }[];
  selfcheck: { ok: boolean | null; at: string | null; note: string };
  // at：这家额度的数据时间；failed：这次没查到（bars 里是上一次的数据，at 也是上一次的时间）。
  // extraUsage 只有 Kimi 可能有：加油包（独立付费）元数据，只作文字展示，不画百分比、不进额度环、不影响派发。
  quota: { name: string; icon: Provider; plan: string | null; at: string | null; failed?: true; failureReason?: string; extraUsage?: { enabled: boolean | null; spent: number | null; monthlyLimit: number | null; balance: number | null; currency: string | null } | null; bars: {
    label: string; used: number | null; approx?: boolean; reset: string | null;
  }[] }[];
  quotaAt: string | null;
  moneyBudget?: import('./money-budget.ts').MoneyStatus | null;
  stats: Stat[];
  profiles: Profile[];
  workers: Record<Who, { name: string; model: string; icon: string; badge?: string }>;
  // 项目名单：登记处里的项目，加上任务里出现过但没登记的；label 是给人看的名字（现在就是项目名）。
  // repo 只有登记过的项目有（从登记文件读）；只在任务里出现过的项目没有这一字段，界面不显示路径行。
  // archived：主人归档了这个项目（设置里的 archivedProjects）；已完成列和历史页的“全部”不再显示它，在跑、在验收的照常显示。
  // config：已登记项目当前的高级配置（docs/tasks/TASK-003.md 设置页编辑用）；只在任务里出现过、没登记的项目是 null。
  projects: ViewProject[];
  // 每个已登记项目的任务规划（docs/TASK_LIST.md 识别结果，src/core/task-plan.ts），key 是项目名。
  // 没有台账的项目是 { present: false }；某个项目规划损坏只反映在它自己的 diagnostics 里，不拖垮看板。
  plans: Record<string, TaskPlan>;
  autopilots?: ViewAutopilot[];
  autopilotProblem?: string | null;
  jobs: ViewJob[];
  batches: Batch[];
  teams: ViewTeam[];
  chats: ViewChat[];
  models: ViewModels;
  theme?: { columns: Partial<Record<Column, string>> };
};
