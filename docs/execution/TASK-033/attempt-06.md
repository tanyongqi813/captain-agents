# Execution Capsule — TASK-033 / attempt-06

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `06`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
账本预留可冻结实际模型身份，为预算组迁移建立不丢账的核心边界。

## 本轮验收切片
- reserveMoney增加可选末尾identity，包含明确budgetGroup和实际model；校验后复制冻结，重复ID同身份幂等，改身份或删除身份拒绝且账本不变。
- 旧记录无identity保持未知，不按当前配置回填；旧金额/预留/停派锁不变。
- 目前仍全局预算，不把identity组标签当隔离额度或开新账权限；本批不提供分组预算设置。

## 已确认事实（禁止重新推导）
- 当前Entry只有price，Job已有真实model和连接快照；派发本批不接线。
- 旧deepseek.json必须承接为未来默认组，不因地址/模型变更清账；不能从历史price反推模型。
- 04/05定点及缓存价、035余量和运行阈值通过证据保持。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/money-budget.ts` — Entry、load、reserveMoney。
2. `test/money-budget.test.ts` — 临时账本模式。

## 修改白名单
- `src/core/money-budget.ts`
- `test/money-budget-identity.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不改设置/派发/runner/UI或现有金额口径，不真实调用，不启用组隔离，不提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-identity.test.ts test/money-budget.test.ts test/money-budget-margin.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不运行全量、UI、build、窗口或真实收费。

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
- 超白名单、并发归属冲突或一次纠偏仍失败回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 分组/接线及整项验收
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
