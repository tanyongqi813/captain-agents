# Execution Capsule — TASK-035 / attempt-08

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `08`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
完成运行中软预算保存的剩余集成证据，保留已通过硬预算用例。

## 本轮验收切片
- 新派活被预算拒绝可保留failed审计任务，不能断言任务总数不变；应断言新任务非运行、无活跃预留且原任务按ID仍运行。
- 按原任务ID跟踪，跨看管周期仍存活，释放替身后done且只记0.2、余量释放；不得用列表首项假定原任务。

## 已确认事实（禁止重新推导）
- 07初次替身换行错误已纠偏；随后hard用例PASS，soft在错误的jobs.length===1断言失败（实际2），未走到原进程存活及最终结算断言。不是已证实的生产缺陷。
- dispatch先createJob后reserveMoney；预算失败会留下failed审计记录。本批不改变这种行为。

## Active findings
- none；仅续检查点未完成证据。

## 源码锚点（最多 5 个）
1. `test/money-budget-runtime-settings.test.ts` — soft用例断言与原任务ID跟踪。
2. `src/core/dispatch.ts` — createJob、reserveMoney及catch收尾，只读。

## 修改白名单
- `test/money-budget-runtime-settings.test.ts`
- max_modified_files: `1`

## 明确非目标
- 不改生产代码或已过hard用例，不把failed审计记录误报为实际收费/启动；不联网或提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 --test-name-pattern=soft test/money-budget-runtime-settings.test.ts`
2. `git diff --check`

## 禁止验证
- 不重复hard、types、全量、UI、build、窗口或真实收费。

## 已知基线失败
- attempt07 soft断言任务总数为1，预算拒绝留下failed审计记录导致实际2。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `10`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 一次纠偏仍失败、需生产改动或来源冲突即交回。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 未完成证据
- anchors_touched: 测试
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
