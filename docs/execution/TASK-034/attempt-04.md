# Execution Capsule — TASK-034 / attempt-04

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-034.md`
- task_id: `TASK-034`
- attempt: `04`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
证明新进程请求续接已结算收费任务时，现有runner拒绝再次启动选手，旧成果与账本不丢失。

## 本轮验收切片
- 真派发假选手完成并结算，保存会话；新进程调用resumeMember请求第二轮，预算开启时runner拒绝续接。
- 假选手启动计数仍一，账本消费/终态不变，第一轮报告补丁可查，明确失败而非伪造成功恢复。

## 已确认事实（禁止重新推导）
- 03403无观测2/2已过不重复。runner启动处已有预算启用拒绝resume规则；wake负责归档和启动新看管。
- 本轮只验证既有拒绝策略，不设计自动恢复，不冒称真实OS休眠验收。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/wake.ts` — resumeMember、rememberSession归档与续接。
2. `src/core/runner.ts` — 收费resume启动拒绝。
3. `test/chat-engine.test.ts` — 续接夹具模式，只读。

## 修改白名单
- `test/money-budget-recovery.test.ts`
- max_modified_files: `1`

## 明确非目标
- 不改生产/选手启动/隔离/真实权限，不重写旧通过测试。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-recovery.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重复无观测/组停机/旧账本测试，不跑全量/UI/build/窗口或真实调用。

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
- 生产缺陷或越白名单需求保存证据另建合同，一次纠偏仍失败回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 整项验收
- anchors_touched: 测试
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
