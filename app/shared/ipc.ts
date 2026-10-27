import type { View } from '../../src/core/view-types.ts';
import type { ProjectCheck } from '../../src/core/project-check.ts';
import type { WorkersPolicy } from '../../src/core/policy.ts';
import type { Appearance, Limits, Storage } from '../../src/core/settings.ts';
import type { DeepseekEndpoint } from '../../src/core/deepseek-settings.ts';
import type { ConnectAi, ConnectStatus } from '../../src/core/intro.ts';
import type { Effort } from '../../src/core/roster.ts';

// 唯一的 IPC 白名单；没有通用文件、命令或任意 IPC 入口。
export const channels = {
  cliStatus: 'xa:cli-status', cliInstall: 'xa:cli-install', places: 'xa:places', openPlace: 'xa:open-place', isolationFix: 'xa:isolation-fix',
  appInfo: 'xa:app-info', onUpdate: 'xa:update', updateCheck: 'xa:update-check',
  updateDownload: 'xa:update-download', updateRestart: 'xa:update-restart', setAutoUpdateCheck: 'xa:auto-update-check',
  getView: 'xa:get-view', view: 'xa:view', open: 'xa:open',
  projectChoose: 'xa:project-choose', projectRegister: 'xa:project-register',
  projectChooseRules: 'xa:project-choose-rules', projectOpen: 'xa:project-open',
  projectUpdate: 'xa:project-update', projectRemove: 'xa:project-remove', projectCheck: 'xa:project-check',
  planDispatch: 'xa:plan-dispatch', planSpec: 'xa:plan-spec',
  autopilotStart: 'xa:autopilot-start', autopilotStop: 'xa:autopilot-stop',
  feishuStatus: 'xa:feishu-status', feishuConnect: 'xa:feishu-connect', feishuTest: 'xa:feishu-test', feishuDisconnect: 'xa:feishu-disconnect',
  decide: 'xa:decide', redo: 'xa:redo', stop: 'xa:stop', comment: 'xa:comment',
  teamSay: 'xa:team-say', teamStop: 'xa:team-stop',
  chatCreate: 'xa:chat-create', chatSay: 'xa:chat-say', chatStop: 'xa:chat-stop', chatRename: 'xa:chat-rename',
  settingsGet: 'xa:settings-get', settingsSet: 'xa:settings-set',
  deepseekLogin: 'xa:deepseek-login', deepseekModels: 'xa:deepseek-models',
  quotaRefresh: 'xa:quota-refresh', copyIntro: 'xa:copy-intro',
  connectStatus: 'xa:connect-status', connect: 'xa:connect', disconnect: 'xa:disconnect',
  networkAllowed: 'xa:network-allowed',
  modelsRefresh: 'xa:models-refresh', modelsKeep: 'xa:models-keep', modelsAdd: 'xa:models-add',
} as const;
export type UpdateState =
  | { phase: 'off'; reason: string }
  | { phase: 'idle'; checked: string | null }
  | { phase: 'checking' }
  | { phase: 'available'; version: string; notes: string; size: number }
  | { phase: 'downloading'; version: string; received: number; size: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; message: string };
export type CliStatus = 'installed' | 'missing' | 'other' | 'unavailable';
export type FeishuStatus = { connected: boolean; protected: boolean; target?: string; issue?: string;
  lastTest?: { at: string; ok: boolean; error?: string }; pending: number | null; lastSuccess: string | null; deliveryIssue: string | null };
// 程序装在哪、数据（登记处）放在哪：只供设置页显示和“打开文件夹”。
export type Places = { app: string; data: string };
export type AppInfo = { version: string; update: UpdateState; autoCheck: boolean };
// team：通知点开时跳到小队。只把目标交给窗口，界面怎么打开由看板那件活接。
export type Destination = { kind: 'job' | 'batch' | 'team' | 'chat'; id: string } | { kind: 'settings' };
// 项目登记（docs/tasks/TASK-001.md）：repo 只给主人看；窗口登记时只能交回 selectionId，交不进任何仓库路径。
// name、label 是后台按仓库文件夹名给出的建议；null 表示没法安全生成，界面要主人自己填。
export type ProjectChoice = { selectionId: string; repo: string; name: string | null; label: string | null };
// 窗口只能交这两个字段。worktreeRoot、setup[]、verify[]、denyReadExtra[]、rules 含路径、命令或后续文件读取能力，
// 不从这条桥接收；登记时由核心 addProject 用默认配置（见 docs/tasks/TASK-001.md 的设计和评审记录）。
export type ProjectRegisterInput = { name: string; label?: string };
// 只回传登记后的名字、显示名和仓库（仓库已由 projectChoose 展示过）；高级配置留给后续受控任务。
export type RegisteredProject = { name: string; label: string; repo: string };
// 规划派发（docs/tasks/TASK-006.md）：窗口只能交项目标识、Task ID、按“选手:强度[:fast]”写好的选择和只读开关。
// 核心重新读规划文件做权威校验（只有真正可执行的 READY 任务能派发），再交给现有派发流程。
export type PlanDispatchInput = { project: string; taskId: string; who: string[]; ro?: boolean };
export type AutopilotInput = { project: string; taskId: string; writer: string; reviewer: string;
  policy: 'short' | 'standard' | 'long'; permission: 'workspace-write'; network: boolean; leadReview?: boolean };
// 打开 Task Spec（docs/tasks/TASK-006.md）：窗口只交已登记项目名和 TASK-005 解析出来的仓库内相对路径
// （docs/tasks/TASK-数字.md）；主进程按登记处的仓库重新解析，绝对路径、任意文件一律拒绝。
export type PlanSpecInput = { project: string; spec: string };
// check：快速体检的结构化结果；check 没跑成时是 null，原因在 checkError。体检失败不影响已完成的登记。
export type ProjectRegistration = { project: RegisteredProject; check: ProjectCheck | null; checkError: string | null };
// 项目管理（docs/tasks/TASK-003.md）：编辑登记时窗口只能交这些字段；窗口永远交不进仓库路径。
// worktreeRoot、denyReadExtra 是仓库内相对路径；setup、verify 是命令；rules 只能是 null（清除）或规则文件选择令牌。
export type ProjectUpdateInput = { label?: string; worktreeRoot?: string; setup?: string[]; verify?: string[]; denyReadExtra?: string[]; rules?: string | null };
// 规则文件选择：展示路径给主人看，真实路径只凭一次性令牌在登记时换回。
export type ProjectFileChoice = { selectionId: string; path: string };
export const defaultColumns = { running: '#2f6bd8', attention: '#64748b', done: '#2c8a55' };
export type Settings = { keepAwake: boolean; notifications: boolean; appearance: Appearance; storage: Storage; limits: Limits; columns?: Record<string, string>; openAtLogin: boolean; workers: WorkersPolicy; networkAllowed: boolean; deepseek?: DeepseekEndpoint };
// archivedProjects：整份归档名单替换。界面从 View.projects[].archived 算出名单再交过来，不从设置里读这份名单。
// 联网的两项不走补丁，只能用下面专门的两个函数。
export type SettingsPatch = Partial<Omit<Settings, 'workers' | 'networkAllowed'>> & { workers?: WorkersPolicy; archivedProjects?: string[] };
export type XaBridge = {
  // 命令行（docs/design-update.md 第 3 节）：终端里的 xagents 是不是这个应用装的那一份。
  // unavailable：开发版，不提供安装；other：~/.local/bin/xagents 已经有别的（比如开发者自己链到源码目录的）。
  cliStatus(): Promise<CliStatus>;
  // 安装启动脚本；已有别的 xagents 时必须带 replace: true 才替换（界面先让人确认）。返回装完后的状态。
  cliInstall(replace: boolean): Promise<CliStatus>;
  // 位置（docs/ui-spec.md 第 10 节）：两处固定的位置；打开时只收 'app' 或 'data'，窗口传不进路径。
  // 隔离（只在 Windows 上，docs/ui-spec.md 第 10 节）：没装好就先装（系统弹管理员确认框，主人点“是”），然后自检；结果随看板数据推回来。不带参数。
  isolationFix(): Promise<void>;
  places(): Promise<Places>;
  openPlace(which: keyof Places): Promise<void>;
  appInfo(): Promise<AppInfo>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
  updateCheck(): Promise<UpdateState>;
  updateDownload(): Promise<void>;
  updateRestart(): Promise<void>;
  setAutoUpdateCheck(on: boolean): Promise<AppInfo>;
  decide(id: string, kind: 'adopt' | 'drop'): Promise<void>;
  redo(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  comment(id: string, text: string): Promise<void>;
  // 主人在小队频道说一句（1–500 字，规则同留言）；收场调用核心的 stopTeam。
  teamSay(id: string, text: string): Promise<void>;
  teamStop(id: string): Promise<void>;
  // 项目群聊（docs/design-team.md 第 16 节）：建群（返回群号）、以主人身份说话、停下正在动手的。
  chatCreate(options: { project: string; title?: string; members: string[] }): Promise<string>;
  chatSay(id: string, text: string): Promise<void>;
  chatStop(id: string): Promise<void>;
  // 改群名（1–100 字，不能含控制字符）。
  chatRename(id: string, title: string): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(patch: SettingsPatch): Promise<Settings>;
  // 只把主人新输入的 DeepSeek 密钥交给核心凭据库；不提供读回。
  deepseekLogin(key: string): Promise<void>;
  deepseekModels(endpoint: DeepseekEndpoint, key?: string): Promise<string[]>;
  // 选手联网（docs/design-network.md）：只有总开关，返回整份新设置；核心校验，不合格报中文原因。
  setNetworkAllowed(on: boolean): Promise<Settings>;
  onOpen(callback: (destination: Destination) => void): () => void;
  // 重新查一遍各家额度；不收参数。刚刷新过或正在刷新时会报错，说明原因。
  refreshQuota(): Promise<void>;
  // 把给其他 AI 的对接提示词（src/core/intro.ts 那一份）放进剪贴板；不收参数，窗口复制不了别的内容。
  copyIntro(): Promise<void>;
  // 接入 AI（docs/design-connect.md）：读各家状态；接入或撤下一家，参数只认 CONNECT_AIS 里的名字，返回各家的新状态。
  connectStatus(): Promise<ConnectStatus[]>;
  connect(ai: ConnectAi): Promise<ConnectStatus[]>;
  disconnect(ai: ConnectAi): Promise<ConnectStatus[]>;
  // 选手模型（docs/design-models.md）：重新问各家有哪些模型；这一家保留哪些模型（整份替换，只认名单里的或已有的）。
  modelsRefresh(): Promise<void>;
  // 整份替换时遗漏手动模型会保持原状态；dropManual 明确取消保留，仍保留历史记录。
  modelsKeep(channel: string, models: string[], dropManual?: string[]): Promise<void>;
  // 只有 Codex 通道能手动添加；不问接口，不提供快速版。
  modelsAdd(channel: string, model: string, efforts: Effort[]): Promise<void>;
  getView(): Promise<View>;
  onView(callback: (view: View) => void): () => void;
  // 项目登记（docs/tasks/TASK-001.md）：原生目录选择，取消返回 null；只返回展示数据和一次性令牌。
  projectChoose(): Promise<ProjectChoice | null>;
  // 只认本窗口、仍有效、没用过的令牌；仓库路径只来自后台记住的那次选择。成功后发布新 View。
  projectRegister(selectionId: string, input: ProjectRegisterInput): Promise<ProjectRegistration>;
  // 项目管理（docs/tasks/TASK-003.md）：全部按已登记项目名由后台解析，窗口交不进任何仓库路径。
  // 打开仓库目录（系统访达/资源管理器）；不存在或未登记报中文原因。
  projectOpen(name: string): Promise<void>;
  // 编辑登记：只改提交的字段，体检结果、验收基线和未知字段原样保留；rules 只收 null 或规则文件选择令牌。
  projectUpdate(name: string, patch: ProjectUpdateInput): Promise<void>;
  // 只移除登记（删登记文件），不碰仓库、任务、历史和 Git 数据；有排队/运行的活、残留进程或开放群聊时拒绝。
  projectRemove(name: string): Promise<void>;
  // 快速/完整体检：返回结构化结果；同一项目体检进行中会拒绝重入，不同项目可并行。
  projectCheck(name: string, kind: 'quick' | 'full'): Promise<ProjectCheck>;
  // 规则文件选择（编辑登记用）：系统文件选择器，取消返回 null；展示路径给主人看，真实路径只凭一次性令牌带回。
  projectChooseRules(): Promise<ProjectFileChoice | null>;
  // 规划派发（docs/tasks/TASK-006.md）：返回新任务号；失败给后台的中文原因。成功后发布新 View。
  planDispatch(input: PlanDispatchInput): Promise<string[]>;
  // 打开 Task Spec（docs/tasks/TASK-006.md）：只交项目名和仓库内相对路径，主进程解析出真实文件再打开；
  // 路径不合法或仓库里没有就报中文原因。窗口没有打开任意文件的入口。
  planOpenSpec(input: PlanSpecInput): Promise<void>;
  autopilotStart(input: AutopilotInput): Promise<string>;
  autopilotStop(id: string): Promise<void>;
  feishuStatus(): Promise<FeishuStatus>;
  feishuConnect(input: { webhook: string; secret?: string }): Promise<FeishuStatus>;
  feishuTest(): Promise<FeishuStatus>;
  feishuDisconnect(): Promise<FeishuStatus>;
};
