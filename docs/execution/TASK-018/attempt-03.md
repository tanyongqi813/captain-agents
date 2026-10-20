# Execution Capsule — TASK-018 / attempt-03

- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `03`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `Medium`
- required_planning_lookup: `none`
- capsule_schema: `2`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
修复 F-01：账户每日时长不能被多个同时运行的任务重复领取。

## 本轮验收切片
- 每日上限 3600 秒、允许并发 2：不得向两个未结束的任务各发 60 分钟；已结算时长与未结算预占合计不超过上限。
- 未使用预占在正常结束/启动失败后可归还，已用时长继续累计。原有 claim.maxMinutes 与调用接口保持兼容。

## 已确认事实（禁止重新推导）
- F-03/F-04 已修复且 16 项核心测试通过，保留这些实现。
- 当前 costGate 仅扣 day.seconds，slots 只有 jobId/since，没有时长预占。
- runner 已用 claim.maxMinutes 收窄时限；recordSeconds/releaseAttempt 是现有结算/回滚入口。
- 可采用保守分配：原子预占本轮可用时长，没有可分配时长就明确拒绝；不要求公平切分。

## Active findings
- `F-01`：并发任务重复领取账户剩余时长。

## 源码锚点（最多 5 个）
1. `src/core/cost-budget.ts` — `CostLedger/loadLedger`：为时长预占保留必要状态，兼容现有合法账本。
2. `src/core/cost-budget.ts` — `costGate`：锁内减去在途预占再分配。
3. `src/core/cost-budget.ts` — `recordSeconds/releaseAttempt/reapSlots`：结算、归还与异常回收不能凭空补满已消耗时长。
4. `test/cost-budget.test.ts` — `成本预算预占（核心）`：补并发时长与归还回归。

## 修改白名单
- `src/core/cost-budget.ts`
- `test/cost-budget.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不扩修 F-02/F-05/F-06/F-07，不动 UI/IPC/dispatch/wake/runner/文档，不改隔离、模型或启动参数。
- 不提交、push、stash；保留已有改动。需要改公开接口或白名单外文件则报告具体原因。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 --test-name-pattern='成本预算预占（核心）' test/cost-budget.test.ts` — 原核心组及新增并发时长、结算、归还测试通过。

## 禁止验证
- 不跑全量、typecheck、UI、build、e2e；不启动真实选手；通过命令未受后续改动影响不得重跑。

## 已知基线失败
- none confirmed（本条定向命令）。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `25`
- soft_call_limit: `none`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
- 时间为提示词软约束，不代表运行器强制停止。

## 停止条件
- 超出白名单、需要架构决定，或一次实现加一次纠偏仍未完成：保存改动与检查点，停止扩修。

## 精简 Implementation Report（固定格式）
- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | scope_conflict | external_decision`
- workspace_branch: 绝对路径与分支
- changed_files: 路径
- completed_scope: 完成项
- remaining_gaps: 未完成点
- anchors_touched: 函数/测试名
- verification: 命令 → PASS/FAIL/NOT_RUN；latest_code_covered: yes/no
- active_findings: F-01 → resolved/unresolved
- scope_or_baseline_notes: 新事实；报告不超过 500 字。
