# Execution Capsule — TASK-040 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-040.md`
- task_id: `TASK-040`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

实现纯函数增量胶囊编译，修正和拆分只继承已确认边界，不退回自由提示词。

## 本轮验收切片

整组编译后通过共享契约校验；原白名单、锚点、验证、预算不变，过期或冲突整组拒绝。

## 已确认事实（禁止重新推导）

- lead-review.ts 已通过 TASK-039，回包只给 proposal，绑定 candidate/capsule。
- assembleHandoff 支持内存文档快照；不用真实文件或虚构前置通过状态。
- 生成制品与更新台账/登记必须分开，本轮不写任何运行记录。

## Active findings

- none

## 源码锚点（最多 5 个）

1. `src/core/lead-review.ts` — parseLeadReview / buildLeadReviewPacket：严格回包和胶囊结构。
2. `src/core/task-plan.ts` — assembleHandoff / contractMetadata / sourceAnchors：共用任务资格与边界。
3. `test/lead-review.test.ts` — 纯协议替身与注入校验模式。

## 修改白名单

- `src/core/lead-capsule.ts`
- `test/lead-capsule.test.ts`
- max_modified_files: `2`

## 明确非目标

不接 UI、IPC、真实模型、凭据或自治状态迁移；不修改 TASK_LIST 运行指针，不启动选手，不提交或推送。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/lead-capsule.test.ts test/lead-review.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证

不运行全量测试、UI、build、e2e，不启动真实模型或查询账户。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `prompt_soft`
- soft_timebox_minutes: `40`
- soft_call_limit: `20`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

需要持久迁移、真实派发或扩大原执行边界时返回检查点，不在本轮实现，不宣称运行闭环完成。

## 精简 Implementation Report（固定格式）

- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | scope_conflict`
- workspace_branch: [absolute workspace and branch]
- changed_files: [paths]
- completed_scope: [observable result]
- remaining_gaps: [specific gaps]
- anchors_touched: [symbols]
- verification: [command and result; latest_code_covered: yes/no]
- active_findings: [none or findings]
- scope_or_baseline_notes: [new facts]
