# Execution Capsule — TASK-018 / attempt-10

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `10`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
核对 TASK-018 在指定副本的完整离线集成；按证据保存最终窗口验收与整合缺口。

## 本轮验收切片
- 在 F-02/F-05 最新实现上各跑一次完整核心、界面及构建，不能拿历史全量冒充。
- 保持预算安全行为；失败只能一次有界纠偏，不接管无关历史模块。
- 真实窗口截图及冒烟隔离内不冒称已跑；主仓有重叠未审差异，不能覆盖整合或直接提交。

## 已确认事实（禁止重新推导）
- attempt-08/09 已通过局部测试与类型检查；不重复单独类型检查。
- 所有核心测试离线临时 XAGENTS_HOME，禁止真实账户/模型/网络。
- 整体仍 IN_PROGRESS；完整验证及截图不足不得标 PASSED。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `package.json` — test/test:ui/build/verify。
2. `test/cost-budget.test.ts` — 预算、派发、续跑。
3. `test/cost-claim.test.ts` — 尝试身份。
4. `test/ui/settings-cost.test.tsx` — 设置保存。

## 修改白名单
- max_modified_files: `0`

## 明确非目标
- 不改源码，不处理无关失败，不修改主仓实现/安装/发布，不运行真实窗口或真实收费。

## 定向验证（最多 5 条）
1. `npm test`
2. `npm run test:ui`
3. `npm run build`

## 禁止验证
- 不重跑已通过类型检查，不运行隔离外 Electron 冒烟或真实凭据调用。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `10`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 源码需纠偏则保留证据交负责人新建有界 Capsule，不超零修改白名单。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: none
- completed_scope: 验证
- remaining_gaps: 缺口
- anchors_touched: none
- verification: 命令结果及 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
