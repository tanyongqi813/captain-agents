# Execution Capsule — TASK-037 / attempt-03
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-037.md`
- task_id: `TASK-037`
- attempt: `03`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
只读影子接线后验证旧LiveProgress不回归，并形成任务功能矩阵。
## 本轮验收切片
- 新接线后旧采样节流/工具时长与最新休眠落盘兼容；三AC据01/02最新证据映射，不重复核心矩阵。
## 已确认事实（禁止重新推导）
- 02生产最终类型/三新观察测试及EOF定向通过；01八项保持，正式036依赖不解除。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `test/activity.test.ts` — 两个LiveProgress既有测试。
2. `docs/implementation/TASK-037-attempt-02.md` — 最新接线证据。
## 修改白名单
- `docs/implementation/TASK-037-acceptance.md`
- max_modified_files: `1`
## 明确非目标
- 不改生产/测试，不新增阈值/UI，不标整项PASSED。
## 定向验证（最多 5 条）
1. `node --test --test-name-pattern='LiveProgress' test/activity.test.ts`
2. `git diff --check`
## 禁止验证
- 不重复已覆盖最新生产的01/02/types/build/UI/全量。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `5`
- soft_call_limit: `6`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 发现真实缺陷另建修复合同，不越白名单。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 当前路径分支
- changed_files: 新验收矩阵
- completed_scope: 功能映射
- remaining_gaps: 正式依赖/发布
- anchors_touched: none
- verification: PASS/FAIL/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 无生产变动
