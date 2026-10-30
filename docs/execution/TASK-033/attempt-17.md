# Execution Capsule — TASK-033 / attempt-17
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `17`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
033业务AC证据矩阵及活动组接线后一次最终选定兼容验收。
## 本轮验收切片
- 定点金额/缓存/跨日/未知/组迁移/实际ID价冻结与保存活动组一次合跑；理由是12活动选择改变默认派发和视图，需最终组合兼容。
- 映射三AC，准确区分功能验收与AGENTS整仓verify，不解除正式依赖。
## 已确认事实（禁止重新推导）
- 14/16真实窗口、15UI4/4、16最新build/types已过，代码未改不重跑。
- 031正式依赖与安全整合发布仍在；不能靠本批报告标整任务PASSED。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `test/money-budget.test.ts` — 金额/边界。
2. `test/money-budget-groups.test.ts` — 组迁移。
3. `test/deepseek-model-prices.test.ts` — 实际ID价。
4. `test/deepseek-active-group.test.ts` — 保存组端到端。
## 修改白名单
- `docs/implementation/TASK-033-acceptance.md`
- max_modified_files: `1`
## 明确非目标
- 不生产/测试修正，不发布、不真实收费。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget.test.ts test/money-budget-groups.test.ts test/money-budget-identity.test.ts test/money-budget-margin.test.ts test/deepseek-model-prices.test.ts test/deepseek-active-group.test.ts test/deepseek-budget-groups.test.ts`
2. `git diff --check`
## 禁止验证
- 不重复build/types/UI/e2e或全仓verify。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `6`
- soft_call_limit: `6`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需源码修复则保存finding另合同，不能超白名单。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 验收报告
- completed_scope: 功能矩阵
- remaining_gaps: 发布
- anchors_touched: none
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界
