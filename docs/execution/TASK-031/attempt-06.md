# Execution Capsule — TASK-031 / attempt-06

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `06`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
已确认下线的模型在刷新失败后，管理模型的不可用展示与现有派发拒绝规则一致。

## 本轮验收切片
- Pro/Flash 使用保存的实际 ID；权威目录不含该 ID 时，陈旧状态仍保持 gone，不因刷新失败重新显示可用。
- 陈旧标记、最后成功时间保持；未核验目录不作为下线依据，地址/凭据失效后不复用旧权威判断。
- 新展示不改写历史任务冻结模型，不静默切模型或价格。

## 已确认事实（禁止重新推导）
- dispatch 已在 attempt-04 对新鲜/陈旧权威目录统一拒绝缺失模型，不重复该实现与原测试。
- buildView 已有目录、实际 ID/时间映射，但 gone 额外要求 !stale，导致展示与派发不一致。
- view.ts 既有目录映射来源已由 first-usable 与历史 diff 确认，仅改这一处条件，其他未审差异保留。
- TASK-018 无新增桌面验收/整合归属证据，本轮不再重测其通过切片。

## Active findings
- none；修复既有身份展示链未覆盖分支。

## 源码锚点（最多 5 个）
1. `src/core/view.ts` — buildView 目录与模型映射。
2. `src/core/deepseek-models.ts` — refresh/read/invalidate 目录，仅使用不修改。
3. `test/helpers.ts` — context，仅使用不修改。

## 修改白名单
- `src/core/view.ts`
- `test/deepseek-catalog-view.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不修改 UI 布局、目录格式、认证、自动刷新、网络、账本、派发器或选手；不接管其他在途实现，不整文件提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-catalog-view.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重复旧目录/派发测试、全量/UI/build/e2e；不使用真实接口、密钥或收费选手。

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
- 来源不明的同文件并发、超白名单或需产品授权即停；最多一次纠偏。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 展示规则
- remaining_gaps: 整任务验收
- anchors_touched: 符号
- verification: 结果及 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
