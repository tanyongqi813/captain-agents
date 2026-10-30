# Execution Capsule — TASK-035 / attempt-07

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `07`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
证明运行中保存预算后真实看管替身按新阈值响应。

## 本轮验收切片
- 已运行任务观测到0.2元后，经writeSettings降低上限，真实看管停止并保留账本；预留余量释放不计消费。
- 降低软预算拒绝新派活但不终止已有任务；已有任务正常结束后仅记0.2且释放余量。
- 全部临时目录/假选手，无真实请求或密钥。

## 已确认事实（禁止重新推导）
- runner每2秒读取readDeepseekRuntimeSettings；writeSettings锁内原子写入；当前旧测试只有启动时超额及损坏收尾，没有运行中保存阈值证据。
- 04核心17/17、05UI9/9及06窗口1/1通过，不重跑。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/runner.ts` — observeMoney看管及收尾，只读。
2. `src/core/settings.ts` — writeSettings、readDeepseekRuntimeSettings，只读。
3. `test/money-budget-runner.test.ts` — 真实看管替身模式，只读。
4. `src/core/money-budget.ts` — reserveMoney/observeMoney，只读。

## 修改白名单
- `test/money-budget-runtime-settings.test.ts`
- max_modified_files: `1`

## 明确非目标
- 不改生产代码，不把替身测试当真实收费联调或整项前置解除，不提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-runtime-settings.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量、build、UI、窗口或重复旧金额核心。

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
- 发现生产缺陷则保存证据、新建纠偏合同；来源冲突或超白名单停止。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 整项剩余
- anchors_touched: 测试
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
