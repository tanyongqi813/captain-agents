# Execution Capsule — TASK-018 / attempt-15

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `15`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
只读整合审查落盘：共同基准、逐段归属、迁移边界及必要组合验收矩阵，不把审查当开发成果。
## 本轮验收切片
- 区分可迁移独有接口与共享启动收尾；不整文件覆盖、不改生产。
## 已确认事实（禁止重新推导）
- 主仓HEAD9fb0b5d；副本HEAD及共同基准ff57992，018窗口13/14已过。
- 主仓含031–035及028规划基准差异，不可直接替换旧dispatch。
- 列出的应用会话未发现另一个active同项目会话；不能据此证明外部执行器不存在。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/dispatch.ts` — 实际ID、金额预占、规划基准。
2. `src/core/runner.ts` — 启动/金额收尾。
3. `.worktrees/task-018/src/core/wake.ts` — 成本预占回滚。
4. `app/shared/ipc.ts` — 保留leadReview与目录授权。
5. `.worktrees/task-018/src/core/cost-settings.ts` — CAS替换。
## 修改白名单
- `docs/implementation/TASK-018-integration-audit.md`
- max_modified_files: `1`
## 明确非目标
- 不改生产、旧副本、028实现、Git状态或已有测试。
## 定向验证（最多 5 条）
1. `git diff --check`
## 禁止验证
- 不重跑已过核心/UI/build/窗口，不全仓verify。
## 已知基线失败
- none confirmed；主仓尚未接成本预算，不能认整合通过。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `5`
- soft_call_limit: `6`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 若需代码迁移，另建白名单合同；此批仅审查制品。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 文档
- completed_scope: 审查矩阵
- remaining_gaps: 实际迁移和组合验收
- anchors_touched: none
- verification: 结果/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 不认开发或整合完成
