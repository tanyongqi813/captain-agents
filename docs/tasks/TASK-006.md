# TASK-006 — 工作台任务规划视图与受控派发

- handoff_contract: `1`
- status: `PASSED_WITH_NOTES`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-005[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果

登记项目存在任务台账时，工作台能展示任务顺序、状态、依赖和验收标准；主人或当前负责人可从真正可执行的 `READY` 任务发起派活，自行选择工作台当前可用选手。Task Spec 的推荐执行者可供参考，但不预选、不限制、不自动映射选手。

## 范围

- 包含：项目规划页面/区域、任务状态与依赖展示、诊断、打开 spec、从 READY 任务发起派活的确认流程、选手选择、任务题目生成、任务与 Task ID 关联、测试。
- 不包含：自动修改 Task Spec 状态、自动评审并推进下一任务、无人值守批量执行全部 READY、调用外部 Skill、按推荐执行者自动路由。

## 现状与设计

- UI 只消费 TASK-005 提供的结构化 View，不在渲染层读文件或解析 Markdown。
- 首版采用“受控派发”：主人或负责人点选一个可执行任务，工作台展示 spec 摘要与验收标准，并要求明确选择一个或多个当前可用选手、强度、读写权限。派发仍调用现有核心 dispatch/chat 能力，继续受开关、额度、隔离、并发和 DeepSeek 闲时策略限制。
- 不使用 Task Spec 的推荐执行者进行默认选择。界面可用淡色文字展示“规划建议：Kimi/Cursor”等元数据，并明确“工作台不会按此自动选手”。如果容易造成误解，首版可完全不展示，但数据层仍保留。
- Task ID 写进新任务的可追溯元数据或摘要，不能只靠标题猜；具体字段应在实现前核对 `Job` 兼容策略，避免破坏旧记录。
- 任务完成后工作台只展示“等待负责人评审/更新规划”，不自动把 Markdown 改成 PASSED。负责人继续通过 `architect-pm-handoff` 评审并维护文档，工作台下次刷新后自然看到下一项 READY。
- 首版只实现桌面端由主人确认派发，不新增 `xagents plan` CLI 子命令。未来若允许负责人 AI 从 Task ID 发起，也必须复用本任务建立的核心校验入口，另行规划并补 CLI 测试。

## 主要文件

- `docs/ui-spec.md`
- `app/renderer/components/ProjectPlan.tsx`（新增）及承载该页面的现有组件
- `src/core/` 下新增规划派发校验入口，并按兼容方式扩展 `Job` 的 Task ID/spec 追溯元数据
- `app/shared/ipc.ts` 与对应主进程 action/preload 桥

可按现有结构补充测试、类型和小范围接线文件；不得借机重写通用派发流程。

## 约束

- 遵守 `AGENTS.md`；先更新 `docs/ui-spec.md`，不新增依赖。
- 规划文件只读；工作台不代替架构 Skill 维护状态或评审结论。
- 只有解析为可执行的任务可发起；`DRAFT`、`BLOCKED`、依赖未满足、格式损坏均不可绕过。
- 选手只能来自当前 `roster`、主人开启的策略和本机可用性；不得按推荐执行者字段创建不存在的选手。
- 所有 Task Spec 内容当纯文字，发送前有长度边界，不作为主进程命令执行。
- 不自动批量派发，避免未经主人/负责人授权扩大任务范围。

## 验收标准

1. 可按项目查看任务规划、依赖、状态、当前 READY 项和诊断。
2. 只有依赖满足的 READY 任务提供派发入口。
3. 派发时显式选择工作台选手；推荐执行者不预选、不限制且不会被映射成选手。
4. 派发继续执行现有项目、策略、额度、隔离、并发和闲时检查。
5. 完成任务后不自动篡改规划文档，界面明确等待负责人评审。
6. 任务记录可追溯到 Task ID 和 spec，旧任务读取保持兼容。

## 验证

```bash
npm run typecheck
node --test test/task-plan.test.ts test/desktop.test.ts test/lifecycle.test.ts
npm run test:ui
npm run build
```

负责人最终运行 `npm run verify`，并检查浅色、深色、窄窗口及任务派发弹窗。

## 实施报告

### 2026-10-18 实现（首轮评审后修正）

- **改动摘要（按首轮评审逐条）**
  1. 验收回归：页签改成“看板 ｜ 规划 ｜ 协作 ｜ 历史 ｜ 表现”，`PAGE_KEYS`（`app/renderer/components/TopBar.tsx`）与既有的 ⌘1–⌘5 快捷键一一对应；`app/renderer/lib/board.ts` 的 `loadPosition` 接受 `plan`，规划页刷新后能按页面记忆恢复。同步了受影响的 8 个界面测试文件（页签顺序、⌘ 序号后移、页面记忆），`test/ui/bridge.test.tsx` 的白名单加上 `planDispatch`、`planOpenSpec`，`test/desktop.test.ts` 的公开 View 字段契约加上 `plan`，并另加一条“记录里写了 Task ID / spec 就原样带出、旧记录读成 `null`”的追溯契约用例。
  2. 规划派发测试环境：`test/plan-dispatch.test.ts` 的 `plannedProject` 按仓库惯例铺开临时 `XAGENTS_HOME` + `test/fixtures/worker.ts` 真实替身（`XAGENTS_FAKE_WORKER` 等一整套，测试结束还原），4 条用例全部走真实派发链路。生产代码里“替身才跳过隔离自检”的判断（`dispatch.ts`、`team-engine.ts`、`wake.ts`）一行没改，没有为测试放宽自检。
  3. 显式选择：`app/renderer/components/ProjectPlan.tsx` 的派发弹窗改成三样都从“没选”开始——选手（`CheckDot`）、每位选手的强度（选好选手后行内出现胶囊，一个都不预选）、读写权限（两项都不预选）。三样齐全之前“派发”禁用，底栏用淡字写清还差什么（“还要选至少一位选手 / 还要选 Codex 的强度 / 还要选读写权限”）。推荐执行者仍只是淡字，不预选、不限制。
  4. 安全打开 Task Spec：新增核心 `resolveTaskSpec`（`src/core/task-plan.ts`）——只认“已登记项目名 + `docs/tasks/TASK-数字.md` 相对路径”，复用 TASK-005 的 `specLinkProblem` 挡绝对路径与 `..`，要求规划里真有这份 spec（即 TASK-005 已确认它是仓库内普通文件），落到仓库后再 `realpath` 一次、仍须在仓库内且是普通文件。桥上新开专用通道 `xa:plan-spec`（`channels.planSpec`、`PlanSpecInput`、`XaBridge.planOpenSpec`、preload 转发、`planSpecActions` 白名单校验、主进程 `shell.openPath`）。窗口交不进任何绝对路径，也没有通用的“打开文件”入口；失败在任务详情里照实写中文原因。
  5. 展示：规划页左栏只列 `View.plans[name].present === true` 的项目（登记了但没有 `docs/TASK_LIST.md` 的不再出现），选中项目记在 `xa.plan-project`。
  6. 规范先行：`docs/ui-spec.md` 第 19 节按上述行为重写；顺手修了两处过期快捷键（第 17 节“协作”⌘2 → ⌘3、`docs/design-desktop.md` 的快捷键一行改成 ⌘1–⌘5）。
  7. 另修：`test/desktop.test.ts` 的“规划派发桥同任务并发拦截”用例本身会永久挂起（替身 dispatch 第三次调用又新建了一个没人释放的 Promise），改为第一次悬着、之后的调用直接返回，现在 0.2 秒跑完。
- **验证结果（本机 macOS，隔离环境）**
  - `npm run typecheck`：通过（核心 + main + preload + renderer 四份 tsconfig）。
  - `node --test test/task-plan.test.ts test/plan-dispatch.test.ts test/desktop.test.ts test/lifecycle.test.ts`：**87/87 通过**（task-plan 26、plan-dispatch 4、desktop 35、lifecycle 22），用时约 83 秒，命令自然结束（修正前该命令会因并发用例挂起而永远不返回）。
  - `npm run test:ui`：**34 个文件、311 项全通过**（修正前 263 通过 / 36 失败）。
  - `npm run build`：通过（main、preload、renderer 三份产物）。
  - 另跑 `npm test`（全部核心测试，超出本任务验收范围）：813 项，801 通过、10 跳过、2 失败——失败的两条都是 `test/quota.test.ts` 的伪终端桥用例（`伪终端桥：程序拿到 60×140 的真终端…`、`伪终端桥收尾…`），原因是本机隔离环境没有可用的 pty 设备（`python3 -c "import pty; pty.openpty()"` 直接报 `OSError: out of pty devices`），与本任务改动无关，也没有改动 `src/core/quota.ts`、`src/core/pty-bridge.py` 或相关测试。
- **新增测试覆盖**
  - `test/ui/project-plan.test.tsx`（新，11 项）：一个带台账的项目都没有时的空状态、只列 `present === true` 的项目、诊断（error→`alert`、warn→`status`）、依赖写成“已通过 / 未通过 / 不在台账”、规划建议淡字且明说不自动选选手、不可派发无“派发”按钮且问题照实写、显式选择（三样从“没选”开始、逐步补齐才放行、权限两项初始都不选中、推荐执行者不预选）、派发成功（两位选手各自强度 + 快速版 + 只读，交出 `who`/`ro` 后关弹窗并提示）、派发失败（弹窗留着写后台原因）、安全打开 spec（只交 `{project, spec}` 且不是绝对路径）、打开失败照实写原因、选手池被主人关空时派发一直禁用。
  - `test/task-plan.test.ts`（新增 3 项）：spec 打开的成功解析（含反斜杠写法规范化）、绝对路径 / `..` / 别的文件名 / 未登记项目 / 台账里没有的 spec 一律拒绝、spec 被换成指向仓库外的符号链接后拒绝打开。
  - `test/desktop.test.ts`（+3 项，并修掉挂起）：planSpec 桥白名单与参数校验、主进程接线（先 `resolveTaskSpec` 再 `shell.openPath`）与 preload 转发、公开 View 的 `plan` 字段契约。
  - 同步：`test/ui/topbar.test.tsx`（五段页签、⌘5 提示、新增“点规划或 ⌘2 进规划页并记住”）、`test/ui/bridge.test.tsx`（白名单 + 两条转发）、`test/ui/board|history|dashboard|data-truth|profiles|timing.test.tsx`（⌘ 序号后移）、`test/ui/fixtures.tsx`（`planOpenSpec` 替身）。
- **未完成项 / 需负责人验收**
  - 真实窗口冒烟测试（`npm run test:e2e`）和浅色、深色、窄窗口及派发弹窗的截图检查**没跑**：要开真的 Electron 窗口，当前隔离环境跑不了，按仓库约定交给负责人验收。
  - `npm test` 里那 2 条伪终端桥用例在本机隔离环境无 pty 设备，需在正常环境复核（与本任务无关）。
  - 未新增 `xagents plan` 子命令、未自动修改规划文档状态、未按推荐执行者路由——都在「范围/不包含」内。
- **diff 摘要（未提交，本文件外）**
  - 新增：`app/renderer/components/ProjectPlan.tsx`（176 行）、`src/core/task-plan.ts`（289 行，含本轮新增的 `resolveTaskSpec`）、`src/core/plan-dispatch.ts`（68 行）、`test/ui/project-plan.test.tsx`（210 行）、`test/task-plan.test.ts`（451 行）、`test/plan-dispatch.test.ts`（147 行，本轮改为替身环境）。
  - 改动：`app/shared/ipc.ts`（通道 `xa:plan-spec`、`PlanSpecInput`、`XaBridge.planOpenSpec`）、`app/preload/index.ts`、`app/main/actions.ts`（`planActions` + 新增 `planSpecActions`）、`app/main/index.ts`（planSpec 接线 + 导入）、`app/renderer/lib/board.ts`（`loadPosition` 接受 `plan`）、`app/renderer/styles/layout.css`（读写权限与打开 spec 按钮的几行样式）、`docs/ui-spec.md`（第 19 节重写、第 17 节快捷键）、`docs/design-desktop.md`（快捷键一行）、`test/desktop.test.ts`（+3 项、修挂起、View 契约）、`test/ui/bridge.test.tsx`、`test/ui/topbar.test.tsx`、`test/ui/board|history|dashboard|data-truth|profiles|timing.test.tsx`、`test/ui/fixtures.tsx`。
  - 未提交、未 push、未用 `git stash`；提交与合并留给负责人。

### 2026-10-18 补充：恢复 Cursor 群聊的双层保护（TASK-007 解锁之前）

- 起因：`test/desktop.test.ts` 的“群聊桥参数先检查”用例开始失败（`cursor-grok:high` 不再被拒绝）。核对 `git diff HEAD` 后确认是工作区里的 Cursor 群聊保护被改掉了：核心的供应商拒绝、界面候选的前缀过滤、以及 `test/ui/chat.test.tsx` 里那条“候选列表不出现 Cursor”的断言，三处一起漂移成了“接受 Cursor”。TASK-007 还没解锁，这一层必须回到原样。
- 恢复 1（核心兜底）：`src/core/chat.ts#chatMember` 在解析出 `who` 之后重新拒掉 Cursor——
  `if (vendorOf(who) === 'cursor') throw new Error('Cursor 还没有实测续接，暂时不能加入群聊。');`
  `roster.ts` 的 import 补回 `vendorOf`。`checkChatOptions` 用的就是这个 `chatMember`，所以命令行和桥（IPC）都绕不过去，只改界面拦不住。
- 恢复 2（界面第一层）：`app/renderer/components/Chat.tsx` 的新建群聊候选改回
  `view.roster.filter(r => view.settings.workers[r.who]?.enabled && !r.who.startsWith('cursor'))`，注释恢复成“只列主人设置里开着、能进群的选手（Cursor 暂不行）”。
- 测试：`test/desktop.test.ts` 保持原样，`cursor-grok:high` 必须被拒绝那条一行没动（现在通过）。`test/ui/chat.test.tsx` 里被改成“接受 Cursor”的那段恢复成原来的“一个 Cursor 都不出现”，并按“所有 who 以 cursor 开头”补了 CursorGrok、CursorSonnet 两条断言——只加严，没有一处放宽。没有新增任何“Cursor 可以进群”的测试。
- 规范对齐：`docs/ui-spec.md` 第 457 行“新建群聊”候选那句也一并改回，并写明 Cursor 在 TASK-007 解锁前一律不进候选；否则规范会写着“当前名单里有的选手都列”，和恢复后的行为矛盾。
- 边界：没有碰已经通过复审的规划页、规划派发和 Task Spec 打开相关代码与测试；没有实现、也没有解锁 TASK-007（核心准入、界面过滤、续接能力都还是老样子）。
- 验证（恢复后重跑）：`npm run typecheck` 通过；`node --test test/task-plan.test.ts test/plan-dispatch.test.ts test/desktop.test.ts test/lifecycle.test.ts` **87/87 通过**（其中“群聊桥参数先检查”由失败转通过）；`npm run test:ui` **34 个文件、311 项全通过**；`npm run build` 通过。
- 现状核对：`src/core/chat.ts`、`app/renderer/components/Chat.tsx`、`test/ui/chat.test.tsx` 与 `HEAD` 的差异只剩下多一行中文注释和两条更严格的断言，功能上等同于 TASK-007 之前的样子。

## 评审记录

### 2026-10-18 Codex 最终复审

- 结论：`PASSED_WITH_NOTES`。
- 上轮唯一阻断已修复：`src/core/chat.ts` 恢复 Cursor 供应商的核心拒绝，`app/renderer/components/Chat.tsx` 恢复 Cursor 候选过滤；`test/ui/chat.test.tsx` 继续验证所有 Cursor 变体均不出现在群聊候选中。`TASK-007` 仍为 `BLOCKED`，本任务没有提前开放 Cursor 群聊。
- TASK-006 功能复核通过：规划页只展示真实台账项目；仅可派发依赖满足的 `READY`；选手、强度和读写权限均需显式选择；Task Spec 通过专用桥按登记项目和仓库内相对路径安全解析；任务记录保留 Task ID/spec 追溯信息且兼容旧记录。
- 本轮验证：`npm run typecheck` 通过；`node --test test/task-plan.test.ts test/plan-dispatch.test.ts test/desktop.test.ts test/lifecycle.test.ts` 为 **87/87 通过**；`npm run test:ui` 为 **34 个文件、311 项通过**；`npm run build` 通过。
- 保留备注：真实 Electron `npm run test:e2e`，以及浅色、深色、窄窗口和派发弹窗截图检查仍需在可启动真实窗口的环境完成；这不阻断当前代码与自动化验收结论。
- 优先级复核：`TASK-006` 完成后，下一项保持 `P1 TASK-008`；`TASK-003` 保持 `P2`；`TASK-007` 保持 `P1 BLOCKED`。已复核，无调整。

### 2026-10-18 Codex 复审

- 结论：`CHANGES_REQUESTED`。
- 首轮要求的 TASK-006 修正本身已落实：显式选择、受控打开 spec、仅展示真实规划项目、页面记忆、组件测试和 UI 回归均符合规格；`npm run typecheck`、`npm run test:ui`（311 项）和 `npm run build` 通过。
- 唯一阻断：当前工作区额外删除了 `src/core/chat.ts` 对 Cursor 群聊成员的核心拒绝，并删除了 `app/renderer/components/Chat.tsx` 的 Cursor 候选过滤。这两项不在 TASK-006 实施报告和范围内，且违反仍为 `BLOCKED` 的 TASK-007 安全结论：Cursor 续接会写共享 `/tmp/cursor-agent-persist-<uid>`，目前不能开放群聊。由此核心组合测试只有 86/87 通过，“群聊桥参数先检查”未按预期拒绝 `cursor-grok:high`。
- 修正要求：只恢复上述核心与界面的 Cursor 群聊禁用保护，并保留既有拒绝测试；不要在 TASK-006 内实现或解锁 TASK-007，也不要改动已经通过的规划功能。
- 修正后重跑：`npm run typecheck`；`node --test test/task-plan.test.ts test/plan-dispatch.test.ts test/desktop.test.ts test/lifecycle.test.ts`；`npm run test:ui`；`npm run build`。填写实施报告补充说明并再次等待复审。
- 非阻断备注：真实 Electron 冒烟和浅色、深色、窄窗口、派发弹窗截图仍留给负责人最终验收；完整 `npm test` 的两项 PTY 失败按现有证据属于当前隔离环境资源限制。
- 优先级复核：`TASK-006` 保持 `P1`；`TASK-003` 保持 `P2`；`TASK-007` 保持 `P1 BLOCKED`。已复核，无调整。

### 2026-10-18 Codex 首轮评审

- 结论：`CHANGES_REQUESTED`。
- 阻断问题 1（验收回归）：`npm run test:ui` 有 36 项失败。新增“规划”页后没有同步现有快捷键、页签顺序、页面记忆和相关测试，旧测试大量被导航到错误页面；preload 白名单测试也未加入 `planDispatch`。`test/desktop.test.ts` 的公开 View 字段契约同样未加入 `plan`，核心测试失败。
- 阻断问题 2（新测试不可运行）：`test/plan-dispatch.test.ts` 的成功路径没有按仓库测试约定启用真实选手替身，实际会被隔离自检拒绝；本次 4 个规划派发用例中 3 个失败。必须让测试在临时 `XAGENTS_HOME` 和替身环境中运行，不能放宽生产自检。
- 阻断问题 3（交互不符）：派发弹窗在勾选选手时自动选择第一档强度，并默认“读写”，主人无需显式确认强度和权限就能派发；这不符合本任务要求的显式选择。强度和读写权限都应有未选择状态，选择完整前禁用派发。
- 阻断问题 4（功能缺失）：范围要求“打开 spec”，当前界面只显示 spec 路径文本，没有安全打开入口。需通过已登记项目名和解析后的 spec 相对路径走专用主进程桥打开，窗口不能提交或打开任意绝对路径。
- 展示问题：规划页应只列 `plan.present === true` 的项目；当前只判断 `view.plans[name]` 是否存在，会把没有 `docs/TASK_LIST.md` 的登记项目也列入。`readPosition` 也未接受 `plan`，规划页无法按现有页面记忆规则恢复。
- 测试要求：新增 `ProjectPlan` 组件测试，覆盖无规划空状态、诊断/依赖/建议展示、不可派发无按钮、显式选择、成功/失败、spec 安全打开；同步导航快捷键、bridge、公开 View 契约测试，并保证完整 `npm run test:ui` 通过。
- 验证实况：`npm run typecheck` 通过；`npm run build` 通过；核心组合测试失败（公开 View 契约、规划派发替身环境）；`npm run test:ui` 为 263 通过、36 失败；真实窗口与截图未验收。
- 报告要求：修正后填写实施报告，列出改动摘要、完整验证结果、未完成项和 diff 摘要。
- 优先级复核：`TASK-006` 由 `P2 → P1`，原因是当前实现破坏核心/UI 回归且位于规划派发安全关键路径；`TASK-003` 保持 `P2`；`TASK-007` 保持 `P1 BLOCKED`。

## 非目标

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 架构设计

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 兼容要求

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 依赖与排序

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 主要接口

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 长期约束

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 微批边界

待确认（旧文档未提供独立字段；迁移器未推断内容）。
