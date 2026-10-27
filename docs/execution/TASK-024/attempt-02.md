# Execution Capsule — TASK-024 / attempt-02

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-024.md`
- task_id: `TASK-024`
- attempt: `02`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `Medium`
- required_planning_lookup: `none`

## 本轮唯一目标

关闭当前规划页仍显示正常依赖等待为错误，以及契约依赖终态未受限的两项边界；保留首轮已经通过的统一解析、迁移和 CLI 实现。

## 本轮验收切片

- DRAFT 等非 READY 任务仅因前置任务尚未通过时不产生界面 error，READY 任务仍受依赖阻断。
- dependencies 括号内只接受 PASSED、PASSED_WITH_NOTES，非法 accepted state 稳定拒绝迁移和派发。

## 已确认事实（禁止重新推导）

- 首轮两条定向验证均通过；不要重写解析器或迁移器。
- 当前仓库 `readTaskPlan` 已能识别 TASK-024，但 TASK-025/026 的正常依赖等待仍被放入 error diagnostics。
- `parseDependencies` 当前会接受 `TASK-001[READY]`，机器结果只产生 info，违反共享契约。

## Active findings

- F-01：修正非 READY 任务未满足依赖的界面诊断等级/生成条件；未知任务、循环、格式错误仍必须阻断。
- F-02：校验依赖 accepted states，仅允许 PASSED 与 PASSED_WITH_NOTES；非法、空项和重复状态不得静默规范化。

## 源码锚点（最多 5 个）

1. `src/core/task-plan.ts` — `parseDependencies`、`readTaskPlan`、`assembleHandoff`。
2. `test/task-plan.test.ts` — 新旧解析及规划页诊断回归。
3. `test/plan-migrate.test.ts` — 非法依赖终态的迁移拒绝回归。

## 修改白名单

- `src/core/task-plan.ts`
- `test/task-plan.test.ts`
- `test/plan-migrate.test.ts`
- max_modified_files: `3`

## 明确非目标

- 不重写首轮实现，不修改 CLI、派发器、界面或其他任务文档。
- 不改变合法依赖的 accepted-state 精确语义，不把 PASSED 与 PASSED_WITH_NOTES 自动互相包含。
- 不提交、不 push、不迁移当前仓库文档。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/task-plan.test.ts test/plan-migrate.test.ts`
2. `npm run typecheck`
3. 直接对当前仓库调用 `readTaskPlan`，确认 ready 为 TASK-024 且没有 TASK-025/026 的正常等待 error。

## 禁止验证

- 不运行全量 `npm test`、UI、build 或 e2e；不启动真实选手。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `mixed`
- soft_timebox_minutes: `20`
- soft_call_limit: `8`
- runner_limit_reference: `project budget 20/5/120 minutes`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

- 需要修改白名单外文件、扩大为派发器或界面重构时停止并报告。
- 两项定向修正后测试仍失败，只允许一次测试纠偏，之后返回检查点。

## 精简 Implementation Report（固定格式）

- outcome: `completed | partial | blocked`
- changed_files: 路径
- anchors_touched: 函数或测试名
- verification: 命令 → PASS/FAIL/NOT_RUN
- active_findings: F-01/F-02 → resolved/unresolved
- checkpoint: 未完成点；完成则 none
- scope_or_baseline_notes: 仅新增事实；总计不超过 500 字
