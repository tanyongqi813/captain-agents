# Execution Capsule — TASK-024 / attempt-01

- planning_source: `docs/tasks/TASK-024.md`
- handoff_contract: `1`
- task_id: `TASK-024`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- capsule_schema: `2`
- dispatch_state: `CLOSED`

## 本轮唯一目标

建立工作台与 Architect PM Handoff 共用的任务规划解析、诊断和安全迁移核心，使标准契约、当前中文格式和常见旧格式能得到确定结果；迁移默认只预览，只有语义对账等价时才允许原子应用。

## 本轮验收切片

- 完成核心解析/诊断与 dry-run 迁移闭环，并以定向测试证明迁移不会改变任务数、ID、标题、状态、依赖和 READY 集合。

## 已确认事实（禁止重新推导）

- 当前 `src/core/task-plan.ts` 只解析旧中文字段和六列表格，尚未实现 `handoff_contract: 1`、当前执行指针和稳定机器诊断。
- 共享契约以 Architect PM Handoff 的 `workbench-contract.md` 为准；聊天标题和自由群聊消息都不是机器派活信号。
- 旧格式中的歧义依赖、未知状态、重复 ID、循环依赖和混合微批状态不得猜测或自动改写。
- 本轮不接入自动派发，也不修改 TASK-025/026 的运行逻辑。

## Active findings

- none

## 源码锚点（最多 5 个）

1. `src/core/task-plan.ts` — `parseTaskList`、`parseTaskSpec`、`readTaskPlan`：统一规划解析与诊断入口。
2. `src/core/fsx.ts` — `writeAtomic`、锁内读改写：迁移应用必须复用原子写能力。
3. `src/cli/cli.ts` — 项目规划命令路由：接入 doctor、migrate、verify，不复制解析规则。
4. `test/task-plan.test.ts` — 现有规划兼容与拒绝行为基线。

## 修改白名单

- `src/core/task-plan.ts`
- `src/core/plan-migrate.ts`
- `src/cli/cli.ts`
- `test/task-plan.test.ts`
- `test/plan-migrate.test.ts`
- max_modified_files: `5`

## 明确非目标

- 不修改桌面界面、派发器、群聊、无人看守推进器、模型配置或任务业务代码。
- 不实际迁移当前仓库文档；只提供默认 dry-run 的能力和测试夹具。
- 不新增依赖，不运行网络请求，不提交或推送代码。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/task-plan.test.ts test/plan-migrate.test.ts` — 解析、拒绝、dry-run、幂等和语义对账全部通过。
2. `npm run typecheck` — 新增核心与 CLI 路由类型通过。

## 禁止验证

- 不运行 `npm test`、`npm run test:ui`、`npm run build`、`npm run test:e2e` 或完整 `npm run verify`。
- 已通过命令在覆盖代码未变化时不得重复运行。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `mixed`
- soft_timebox_minutes: `35`
- soft_call_limit: `12`
- runner_limit_reference: `project budget 20/5/120 minutes`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

- 需要修改白名单外文件、超过 5 个文件或改变现有规划派发行为。
- 无法在不猜测歧义字段的前提下保持旧格式兼容。
- 需要新增依赖、联网、凭据、提交、推送或真实迁移当前文档。
- 定向测试暴露桌面界面或派发器联动修改需求。

## 精简 Implementation Report（固定格式）

- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | runner_limit | context_limit | external_decision | permission | scope_conflict`
- workspace_branch: `[absolute workspace or worktree] @ [branch or detached SHA]`
- changed_files: [paths only]
- completed_scope: [observable work completed]
- remaining_gaps: [specific unfinished work; `none` only when completed]
- anchors_touched: [symbols/tests only]
- verification: [command → PASS/FAIL/NOT_RUN; latest_code_covered: yes/no]
- active_findings: [finding id → resolved/unresolved]
- scope_or_baseline_notes: [new fact only; no transcript]
