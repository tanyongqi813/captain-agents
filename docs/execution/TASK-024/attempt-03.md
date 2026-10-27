# Execution Capsule — TASK-024 / attempt-03

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-024.md`
- task_id: `TASK-024`
- attempt: `03`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
复核并独立提交共享解析、迁移 CLI 和已授权文档格式迁移；历史记录保持原样。

## 本轮验收切片
候选提交内容独立通过解析/迁移测试和类型检查；不混入负责人运行开关、收费逻辑或界面改动。

## 已确认事实（禁止重新推导）
- attempt-01/02 已完成实现与修正，原记录不回写。
- task-plan 的 Capsule 读取纯接口与共享契约校验作为后续派发前置一起验证。
- 本轮提交含必要规划元数据迁移文件；不将文档记录的任务状态当作新功能发布证明。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/task-plan.ts` — assembleHandoff / readDispatchCapsule。
2. `src/core/plan-migrate.ts` — migrateHandoff。
3. `src/cli/cli.ts` — doctor / migrate / verify。

## 修改白名单
- `src/core/task-plan.ts`
- `src/core/plan-migrate.ts`
- `src/cli/cli.ts`
- `test/task-plan.test.ts`
- `test/plan-migrate.test.ts`
- max_modified_files: `5`
- exception_reason: 共享契约、迁移与 CLI 为同一接口迁移；已授权迁移的 Markdown 制品另按明确路径提交。

## 明确非目标
不提交收费逻辑、界面、真实凭据、运行输出或未完成负责人接线；不修改历史 Review 正文。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/task-plan.test.ts test/plan-migrate.test.ts`
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
