# Execution Capsule — TASK-033 / attempt-10

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `10`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
原子接通内部显式选组到任务归属和看管预算，不新增界面选择。

## 本轮验收切片
- RunOptions.moneyGroup缺省default；非默认组须存在且启用，注册前严格查找。Job新增冻结deepseekBudgetGroup和该组money快照，实际模型价取同一组。
- 预留传入冻结组；runner启动、2秒看管、最终收尾均按Job组查最新配置，缺失组或非默认组预算关闭时拒绝/停止，不借用default或旧快照。
- 默认旧Job无组按default；原budget关闭行为保持，已启用任务默认配置消失则拒绝。
- 离线替身证明B组不受默认低阈值误停，降低B阈值停止且只记B；删除B配置停止保留成果；缺失组零注册。

## 已确认事实（禁止重新推导）
- 08账本和09配置严格查找已过；Endpoint没有活动组字段。本批只内部选项，不加CLI/UI参数。
- 三主要文件dispatch/job/runner必须同批接线，不改workers启动参数/隔离。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/dispatch.ts` — RunOptions、Job快照、reserveMoney。
2. `src/core/job.ts` — deepseekConnection。
3. `src/core/runner.ts` — 三处费用读取和observeMoney。
4. `test/money-budget-runtime-settings.test.ts` — 默认组替身回归。

## 修改白名单
- `src/core/dispatch.ts`
- `src/core/job.ts`
- `src/core/runner.ts`
- `test/money-budget-group-runtime.test.ts`
- max_modified_files: `4`

## 明确非目标
- 不改账本/设置解析/UI/CLI/模型价表，不真实网络/密钥/收费，不提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-group-runtime.test.ts test/money-budget-runtime-settings.test.ts test/money-budget-runner.test.ts test/money-budget-dispatch-identity.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重跑08/09核心或全量/UI/build/窗口/真实收费。

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
- 超白名单、来源冲突或一次纠偏仍失败停止回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 界面/价表及整项验收
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
