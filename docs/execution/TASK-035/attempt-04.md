# Execution Capsule — TASK-035 / attempt-04

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `04`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
安全余量进入原子预算预占，但绝不作为实际费用结算。

## 本轮验收切片
- 可选 safetyMargin 为非负有限金额，旧配置缺省为零，显式零保留。
- 活跃记录单独冻结余量，预占及剩余包含余量；硬上限原子检查包含余量。
- 正常、缺用量、重复结算及旧终态回收均释放余量而不计费；旧账本缺字段兼容，非法字段拒绝。
- 原执行预留耗尽阈值不被余量延长。

## 已确认事实（禁止重新推导）
- reserveMoney 锁内预占；settleUnknown 按原执行预留保守结算，不能直接加大 reserve。
- 本轮先完成核心接口再接表单，不把核心切片当整任务完成。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/deepseek-settings.ts` — DeepseekMoney、deepseekMoney。
2. `src/core/money-budget.ts` — Entry、reservedAmount、reserveMoney、settleUnknown。
3. `test/money-budget.test.ts` — 离线账本夹具与回归。

## 修改白名单
- `src/core/deepseek-settings.ts`
- `src/core/money-budget.ts`
- `test/money-budget-margin.test.ts`
- max_modified_files: `3`

## 明确非目标
- 不改 UI、runner、真实模型、网络、密钥权限及历史通过切片；不提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-margin.test.ts test/money-budget.test.ts test/money-budget-view.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量、UI、build、窗口或真实收费调用。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 超白名单、并发归属冲突或一次纠偏仍失败时回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 整项剩余
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
