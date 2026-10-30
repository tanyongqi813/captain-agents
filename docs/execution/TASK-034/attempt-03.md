# Execution Capsule — TASK-034 / attempt-03

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-034.md`
- task_id: `TASK-034`
- attempt: `03`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
验证无新增用量时限在冷读、长时间间隔及真实看管下不会被旧累计量或活跃日志绕过。

## 本轮验收切片
- 核心使用显式时钟和新进程：重放相同累计量不刷新observed，超过30秒返回停止原因，预占保留；终态不允许非final续接。
- 真dispatch/runner配无用量假选手，持续产生成果但不报token，30秒无观测后停止，保存报告/补丁，按原预留保守结算而非宣称精确费用。

## 已确认事实（禁止重新推导）
- 01多任务组停机1/1、02类型检查已过，不重复。
- 033核心已有跨日/迟到/组回收证据；本轮不重测。unknownSeconds合法下限30秒。
- 核心显式now证明时间间隔，不冒充真实机器休眠或完整runner重启恢复。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/money-budget.ts` — observeMoney观测与终态保护，只读。
2. `src/core/runner.ts` — watch无观测停止与收尾，只读。
3. `test/money-budget-runner.test.ts` — 假选手模式，只读。

## 修改白名单
- `test/money-budget-lifecycle.test.ts`
- max_modified_files: `1`

## 明确非目标
- 不改生产、休眠监控、选手参数、密钥或网络；不拿核心冷读等同整个系统恢复。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-lifecycle.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重复已过组/迟到测试，不跑全量/UI/build/窗口或真实调用。

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
- 若生产缺陷或越白名单需求，先保存证据另建合同；一次纠偏仍失败则回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 整项验收
- anchors_touched: 测试
- verification: 结果及latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
