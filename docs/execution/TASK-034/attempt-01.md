# Execution Capsule — TASK-034 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-034.md`
- task_id: `TASK-034`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
证明组上限停止该组多个执行/审查任务而不误停别组。

## 本轮验收切片
- 假选手启动B组实现/审查各一、C组实现一，观测费用后降低B上限，两个B均停止并保留报告补丁；C跨看管周期仍运行。
- B停止锁持久化，force不能再派该组；新失败审计记录无worker/无活跃预留。C正常完成、结算自身费用。
- 核对B保守兜底及C实际费用、预留释放、默认账无污染。全过程无真实AI。

## 已确认事实（禁止重新推导）
- 03310组三处读取及单任务停止9/9、08账本22/22、11实际价表10/10已过。
- 每个runner周期读共享停派锁；本批先补多个进程证据，不重测旧单任务。
- 033整项未过，按策略纠正引用已过接口做离线切片，不发READY机器授权。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/runner.ts` — 看管observeMoney，只读。
2. `src/core/money-budget.ts` — 组停派锁及结算，只读。
3. `test/money-budget-group-runtime.test.ts` — 假选手进程模式，只读。

## 修改白名单
- `test/money-budget-group-stop.test.ts`
- max_modified_files: `1`

## 明确非目标
- 不改生产代码、选手启动参数/隔离、真实网络/密钥，不提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-group-stop.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重复旧单任务/账本测试，不跑全量/UI/build/窗口或真实调用。

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
- 若发现生产缺陷，保存证据另建纠偏合同，不越白名单；一次纠偏仍失败停止。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 其他整项验收
- anchors_touched: 测试
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
