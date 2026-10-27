# Execution Capsule — TASK-018 / attempt-02

- dispatch_state: `待确认`
- handoff_contract: `1`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `02`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `Medium`
- required_planning_lookup: `none`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
额度未知时，不得把损坏账本或没有任何有效上限的资料当成可用预算。本轮通过只代表两项缺陷修复，整个 TASK-018 仍待后续纠偏。

## 已确认事实（禁止重新推导）
- 现有 UI、IPC、派发/续跑接线已经实现并保留，不重读完整任务及前置契约。
- 现有 60 项核心定向测试与 7 项界面/桥测试通过；它们不代表预算边界正确。
- 首次账本不存在可以创建；已有文件损坏、读失败、结构非法或版本不支持不得重置成空账本。
- 未设置上限不是 0；明确 0 的上限必须拒绝启动。

## Active findings
- F-03：loadLedger 对非 ENOENT 错误或非法结构静默清零。改为明确拒绝，原账本内容保持不变。
- F-04：local 仅有 recordedAt 时被 usable 判为有效。额度未知且无任何有效有限上限必须拒绝；保留有效预算、已知额度及过期处理的既有契约。

## 源码锚点（最多 5 个）
1. `src/core/cost-budget.ts` — `loadLedger`：读取错误、版本与账本结构校验。
2. `src/core/cost-budget.ts` — `usable` / `costGate`：有效上限与拒绝原因。
3. `test/cost-budget.test.ts` — `成本预算预占（核心）`：沿用临时 XAGENTS_HOME 模式，补回归测试。
4. `src/core/cost-settings.ts` — `LocalBudget` / `localOf`：只读字段契约，不修改。

## 修改白名单
- `src/core/cost-budget.ts`
- `test/cost-budget.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不修并发时长预占、续跑预占所有权、登记回滚、设置冲突或界面字段清空；这些由后续胶囊处理。
- 不修改 runner/wake/dispatch、UI、IPC、Task Spec、任务清单；不改启动参数、隔离和模型。
- 不提交、不 push、不 stash；保留已有工作区改动。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 --test-name-pattern='成本预算预占（核心）' test/cost-budget.test.ts` — 原核心组及新增回归通过。
- 新增回归至少覆盖：首次不存在；非法 JSON；非法结构/版本；非 ENOENT 读取失败；拒绝后原文件不变；未知额度无上限；0 上限；有效预算；已知额度兼容。
- 已通过命令除非覆盖代码又改变，否则不重复。

## 禁止验证
- 不跑全量 npm test、npm run verify、typecheck、UI、build、e2e，也不启动真实选手或查询真实账户。

## 已知基线失败
- 本条定向命令没有已确认的基线失败。

## 停止条件
- 修复需要白名单以外文件或改变上述契约：保留改动，报告具体缺口后停止。
- 定向验证暴露非本轮范围问题：记录并停止扩修。
- 每项缺陷最多一次实现及一次测试纠偏；仍未完成则交接检查点，不自行重试整任务。此条为执行软约束，并非运行器已实现硬性计时。

## 精简 Implementation Report（固定格式）
- outcome: `completed | partial | blocked`
- changed_files: 路径
- anchors_touched: 函数或测试名
- verification: 命令 → PASS/FAIL/NOT_RUN
- active_findings: F-03/F-04 → resolved/unresolved
- checkpoint: 未完成点、已有验证是否覆盖最新改动；完成则 none
- scope_or_baseline_notes: 仅新增事实；总计不超过 500 字，报告后停止。
