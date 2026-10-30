# Execution Capsule — TASK-035 / attempt-03

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `03`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
费用编辑窗口显示由核心计算的剩余预估预算，不用未保存草稿推导放行。

## 本轮验收切片
- 核心按保存配置、已花和运行预留计算距软阈值/上限剩余，复用微元整数口径、最低 0；预算关闭或没配置返回未知。
- 窗口只显示结果，编辑未保存阈值不改变剩余数；旧快照缺字段显示未知，不补零，不将余额当派发资格。
- 保留未知成本计数和停派状态，不改账本/闸门/价格/进程行为。

## 已确认事实（禁止重新推导）
- MoneyStatus 目前只有 spent/reserved/unknown/stopped，缺 remaining；buildView 已读保存的 deepseek.money。
- 金额核心与01/02通过证据保持；运行控制的既有替身证据只作现有事实，不宣称全项通过。
- 本轮只补剩余展示，安全余量字段/运行集成仍待独立核实。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/money-budget.ts` — MoneyStatus、units、readMoneyStatus。
2. `src/core/view.ts` — buildView.moneyBudget。
3. `app/renderer/components/DeepseekSettings.tsx` — 今日费用状态。
4. `test/ui/deepseek-money.test.tsx` — 状态展示。

## 修改白名单
- `src/core/money-budget.ts`
- `src/core/view.ts`
- `app/renderer/components/DeepseekSettings.tsx`
- `test/money-budget-view.test.ts`
- `test/ui/deepseek-money.test.tsx`
- `docs/ui-spec.md`
- max_modified_files: `6`

## 明确非目标
- 不改预占/结算/看管规则、不新增依赖或网络、不接管在途、不提交未审历史差异。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-view.test.ts`
2. `npm run test:ui -- test/ui/deepseek-money.test.tsx`
3. `npm run typecheck`
4. `git diff --check`

## 禁止验证
- 不重跑全量/旧金额核心/旧窗口截图；最新显示需后续窗口验收，不拿旧图片冒充。

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
- 超白名单、同文件来源不明修改或一次纠偏仍失败则回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 显示
- remaining_gaps: 未完成项
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
