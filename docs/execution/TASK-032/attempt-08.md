# Execution Capsule — TASK-032 / attempt-08

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-032.md`
- task_id: `TASK-032`
- attempt: `08`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
费用成功派发夹具显式声明默认强度，验证新能力门槛不损坏原费用安全收尾。

## 本轮验收切片
- 三测试文件成功连接显式pro/flashReasoning default；原费用断言完全保留，不改生产或fake绕过。
- 同组多任务停机/别组继续、收费恢复拒绝、无用量停止及保守费用断言保持。

## 已确认事实（禁止重新推导）
- 03201/02已拒绝未知high；05真CLI默认/确认high7/7，06错误回交8/8通过。
- 三文件是此前本自动化创建的未提交测试，无本轮外部diff；旧默认high未声明能力。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `test/money-budget-group-stop.test.ts` — 初始连接及原收尾断言。
2. `test/money-budget-recovery.test.ts` — endpoint。
3. `test/money-budget-lifecycle.test.ts` — endpoint及无效组。

## 修改白名单
- `test/money-budget-group-stop.test.ts`
- `test/money-budget-recovery.test.ts`
- `test/money-budget-lifecycle.test.ts`
- max_modified_files: `3`

## 明确非目标
- 不改生产、安全模板、费用断言或其他测试。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-group-stop.test.ts test/money-budget-recovery.test.ts test/money-budget-lifecycle.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不全量/UI/build/e2e，不重跑031及032已过纯门槛。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 需白名单外修复、来源冲突或一次纠偏仍失败则保存真实检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 费用兼容
- remaining_gaps: 整项
- anchors_touched: 夹具
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界
