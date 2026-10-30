# Execution Capsule — TASK-018 / attempt-08

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `08`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
修复既有阻断 F-02：预占使用每次尝试独立身份，重复回滚、旧轮收尾和旧终态不能删除新尝试。

## 本轮验收切片
- 新预占产生并持久化唯一 claimId，派发/续跑/看管传递同一身份。
- 释放及结算对同一身份幂等；旧 token、错误所有者与缺 token 不得影响新预占。
- 续跑登记前旧终态不误回收新预占，已登记活跃尝试不按过期时间盲回收。
- 旧无 token 账本可读且保守处理；原坏账本、时长、次数、并发规则不弱化。

## 已确认事实（禁止重新推导）
- F-07/F-08/F-09 已解决；F-02/F-05 仍开放，先完成风险较高的 F-02。
- 原 releaseAttempt/recordSeconds 按 jobId 删除全部 slots，release 重复减尝试。
- 续跑先预占再持任务锁，旧终态可被另一 gate 看到；不能在账户锁里拿任务锁。
- 此次为不可分割身份接口迁移，五个主要文件同时接线，不能半迁移留下可越权释放路径。

## Active findings
- `F-02`：尝试级身份、幂等释放及旧终态误回收。

## 源码锚点（最多 5 个）
1. `src/core/cost-budget.ts` — CostClaim、loadLedger、reapSlots、costGate、releaseAttempt、recordSeconds。
2. `src/core/job.ts` — Job.cost。
3. `src/core/dispatch.ts` — claims 回滚及启动失败释放。
4. `src/core/wake.ts` — resumeMember。
5. `src/core/runner.ts` — 预占及收尾身份。

## 修改白名单
- `src/core/cost-budget.ts`
- `src/core/job.ts`
- `src/core/dispatch.ts`
- `src/core/wake.ts`
- `src/core/runner.ts`
- `test/cost-budget.test.ts`
- `test/cost-claim.test.ts`
- max_modified_files: `7`

## 明确非目标
- 仅指定副本，不覆盖主仓，不改 F-05 保存协议、UI、网络、隔离与启动参数。
- 不新增依赖、真实模型/密钥/付费调用，不提交未审历史文件。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/cost-claim.test.ts test/cost-budget.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 本切片不跑全量/UI/build/e2e/真实账户；整项收口后另做必要集成验收。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `20`
- soft_call_limit: `20`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 超白名单、发现同文件并发修改或需新产品选择时停止。最多一次纠偏，仍失败保留检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict / soft_budget
- workspace_branch: 绝对路径与分支
- changed_files: 路径
- completed_scope: 修正
- remaining_gaps: 任务缺口
- anchors_touched: 符号
- verification: 命令结果及 latest_code_covered
- active_findings: F-02 resolved/unresolved
- scope_or_baseline_notes: 新事实
