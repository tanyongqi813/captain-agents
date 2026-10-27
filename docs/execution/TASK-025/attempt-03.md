# Execution Capsule — TASK-025 / attempt-03

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-025.md`
- task_id: `TASK-025`
- attempt: `03`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
复核并独立提交 Capsule 原文派发、起点与锚点检查以及旧自治测试夹具迁移。

## 本轮验收切片
候选提交只含 Capsule 派发和配套夹具，独立通过派发/自治回归与类型检查；不含收费及新负责人模式。

## 已确认事实（禁止重新推导）
- attempt-01/02 已完成实现与修正，原记录不回写。
- task-plan 的 Capsule 读取纯接口与共享契约校验作为后续派发前置一起验证。
- 本轮提交含必要规划元数据迁移文件；不将文档记录的任务状态当作新功能发布证明。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/task-plan.ts` — assembleHandoff / readDispatchCapsule。
2. `src/core/plan-dispatch.ts` — readyTask / planDispatch。
3. `src/core/dispatch.ts` — assertCapsuleInStart。

## 修改白名单
- `src/core/plan-dispatch.ts`
- `src/core/dispatch.ts`
- `test/plan-dispatch.test.ts`
- `test/helpers.ts`
- `test/autopilot-record.test.ts`
- `test/autopilot-engine.test.ts`
- `test/autopilot-worktree.test.ts`
- `test/autopilot-desktop.test.ts`
- `src/core/task-plan.ts`
- `test/task-plan.test.ts`
- max_modified_files: `10`
- exception_reason: Capsule 资格入口切换与旧自治夹具升级属于不可分割接口迁移；实现改动只在派发入口，公共读取已在前批通过。

## 明确非目标
不提交收费逻辑、界面、真实凭据、运行输出或未完成负责人接线；不修改历史 Review 正文。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/plan-dispatch.test.ts test/autopilot-record.test.ts test/autopilot-engine.test.ts test/autopilot-worktree.test.ts test/autopilot-desktop.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
不调用真实模型；不把全工作区测试代替提交快照测试。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `40`
- soft_call_limit: `30`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
发现越界实现或提交快照依赖未提交文件时停止该批同步。

## 精简 Implementation Report（固定格式）
- outcome: completed | partial | blocked
- handoff: none | checkpoint
- stop_reason: none | scope_conflict
- workspace_branch: 绝对路径与分支
- changed_files: 文件路径
- completed_scope: 已核对范围
- remaining_gaps: 未完成项
- anchors_touched: 函数/测试
- verification: 命令与结果；latest_code_covered: yes/no
- active_findings: none
- scope_or_baseline_notes: 新事实
