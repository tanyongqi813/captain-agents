# Execution Capsule — TASK-018 / attempt-14

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `14`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
补F12编辑段视觉，不改已过窗口功能。
## 本轮验收切片
- 浅深900窄完整名称编辑和本地预算输入，滚动后坐标在弹窗头尾内，实际查看。
## 已确认事实（禁止重新推导）
- 13窗口保存/重启/放弃/CAS已过，截图只在冲突顶部；生产未变无需build。
## Active findings
- `F-12`: 编辑区截图缺失。
## 源码锚点（最多 5 个）
1. `test/e2e/cost-settings.ts` — 截图循环。
## 修改白名单
- `test/e2e/cost-settings.ts`
- max_modified_files: `1`
## 明确非目标
- 不改生产、旧图、主仓整合和功能断言。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=60000 test/e2e/cost-settings.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不build/全量/core/UI，13旧图不覆盖。
## 已知基线失败
- 隔离launch失败，范围审批后可跑。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `6`
- soft_call_limit: `8`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 一次纠偏仍失败或需生产改动即回交。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget
- workspace_branch: 原副本
- changed_files: 路径
- completed_scope: 截图
- remaining_gaps: 整合发布
- anchors_touched: 截图循环
- verification: 结果/latest_code_covered
- active_findings: F12
- scope_or_baseline_notes: 边界
