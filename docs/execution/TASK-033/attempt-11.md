# Execution Capsule — TASK-033 / attempt-11

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `11`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
每组实际模型ID价表解析和派发前查价同批生效。

## 本轮验收切片
- DeepseekMoney可选modelPrices表，最多128模型、合法ID和非负有限单价，支持cacheWrite显式0并深复制；显式表不依赖legacy槽位正价。
- 有表只按实际ID精确查价，未知ID（含空表）注册前拒绝，不回退Pro/Flash；旧无表仍按原槽位兼容。
- 每组独立价表，预留冻结查得价格；改价不追溯旧消费，未知价零注册/零启动。

## 已确认事实（禁止重新推导）
- 10已接内部组选项、Job归属和runner；08已冻结价计费；本批不改账本/runner。
- UI尚未有组选择及价表编辑；只验证核心和真实CLI假选手，不声称完整产品可用。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/deepseek-settings.ts` — DeepseekMoney、deepseekMoney、deepseekBudgetForGroup。
2. `src/core/dispatch.ts` — choice.model、reserveMoney。
3. `test/money-budget-dispatch-identity.test.ts` — 替身派发。

## 修改白名单
- `src/core/deepseek-settings.ts`
- `src/core/dispatch.ts`
- `test/deepseek-model-prices.test.ts`
- max_modified_files: `3`

## 明确非目标
- 不改UI/CLI选项/runner/账本或真实模型参数，不真实收费或提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-model-prices.test.ts test/deepseek-budget-groups.test.ts test/money-budget-dispatch-identity.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重复08/10完整账本/看管，全量/UI/build/窗口或真实收费。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `20`
- soft_call_limit: `18`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 超白名单、来源冲突或一次纠偏仍失败回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: UI及完整验收
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
