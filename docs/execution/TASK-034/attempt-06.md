# Execution Capsule — TASK-034 / attempt-06
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-034.md`
- task_id: `TASK-034`
- attempt: `06`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
补终态迟到累计量超额和停派证据，完成05生产变化后一次选定看管兼容矩阵。
## 本轮验收切片
- 按冻结B组终态兜底后迟到新增费用超过hard，仍入原组、明确spent>hard/stopped，重复幂等/default不变/force不绕过；不伪称账单硬限额。
- 新增测试和现有金额/运行阈值/组停机组合一次，验证05间隔锁未改变hard/soft语义；映射034三AC。
## 已确认事实（禁止重新推导）
- 05真实supervisor暂停恢复2/2及types通过；01/03/04历史证据保持，不重复长无量或恢复测试。
- 033正式依赖及整仓发布未过，矩阵不能提前解除。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/money-budget.ts` — observeMoney/readMoneyStatus。
2. `test/money-budget-groups.test.ts` — 组终态迟到。
3. `test/money-budget-group-stop.test.ts` — 多执行者组隔离。
## 修改白名单
- `test/money-budget-late-stop.test.ts`
- `docs/implementation/TASK-034-acceptance.md`
- max_modified_files: `2`
## 明确非目标
- 不修改生产、旧断言/真实系统休眠，不自动恢复。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-late-stop.test.ts test/money-budget.test.ts test/money-budget-group-stop.test.ts test/money-budget-runtime-settings.test.ts test/money-budget-group-runtime.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不05暂停测试/旧长无量/全量/UI/build/e2e。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `8`
- soft_call_limit: `8`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 发现生产回归另合同，不超白名单。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 迟到及矩阵
- remaining_gaps: 发布
- anchors_touched: 测试
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界
