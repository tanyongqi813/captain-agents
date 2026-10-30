# Execution Capsule — TASK-033 / attempt-09

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `09`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
建立每组预算配置解析与严格查找接口，不提前激活未接线的组选择。

## 本轮验收切片
- Endpoint新增可选moneyGroups配置表（最多32个非default组）；旧money始终代表default，表内不得重复default或含非法/原型组名。
- 各项复用deepseekMoney验证并深复制；保存重读保留全部配置，旧字段保持兼容。
- deepseekBudgetForGroup按显式组查找：default读取旧money，其他缺失组拒绝，关闭组保持关闭，不回退当前连接/旧任务快照。
- 不接受budgetGroup活动选择字段；派发/runner尚未接线，不能让新配置偷偷改变当前default行为。

## 已确认事实（禁止重新推导）
- 08账本核心已支持显式组；当前dispatch仍default，runner直接读当前money，需后续原子接线。
- 桌面编辑仍只编辑money，保留draft其他字段；本批只保存组配置表，无新UI或启用动作。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/deepseek-settings.ts` — DeepseekEndpoint、deepseekEndpoint、deepseekMoney。
2. `src/core/settings.ts` — writeSettings/readDeepseekRuntimeSettings，只读。

## 修改白名单
- `src/core/deepseek-settings.ts`
- `test/deepseek-budget-groups.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不改活动组选择、派发、runner、UI或模型价表，不运行真实请求，不提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-budget-groups.test.ts test/deepseek-settings.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重跑账本核心、全量/UI/build/窗口或真实收费。

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
- 超白名单、并发来源冲突或一次纠偏仍失败即交回。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 接线与整项验收
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
