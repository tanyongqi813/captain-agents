# Execution Capsule — TASK-033 / attempt-08

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `08`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
核心支持显式预算组隔离，同时完整承接旧默认账。

## 本轮验收切片
- reserveMoney增加显式末尾组参数，缺省default；身份标签不能单独启用隔离。非默认组要求身份与组一致。
- 原文件root days/stopped继续代表default，entries统一保留；首次显式新组升级version2并增加groups，旧版version1读取器因版本拒绝，不可降级清账。旧记录缺会计组始终default，不能从旧identity标签猜迁移。
- 预留/消费/停派锁/未知计数按组隔离，观察/迟到/终态回收按记录冻结会计组结算；并发共用一把锁，坏组或坏版本拒绝。

## 已确认事实（禁止重新推导）
- 现有version1旧程序严格拒绝version!=1；原默认生产派发仍传default，无非默认组设置入口。
- 06/07身份及派发已过，不改价口径；本批是核心接口，设置/runner组配置另行接线。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/money-budget.ts` — Ledger、load、status、reserveMoney、observeMoney。
2. `test/money-budget.test.ts` — 旧账/并发夹具。

## 修改白名单
- `src/core/money-budget.ts`
- `test/money-budget-groups.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不新增组UI/连接设置，不改派发/runner/真实权限，不按地址或密钥派生组，不提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-groups.test.ts test/money-budget.test.ts test/money-budget-margin.test.ts test/money-budget-identity.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量、UI、build、窗口或真实收费。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `20`
- soft_call_limit: `18`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 一次纠偏仍失败、并发归属冲突或超白名单即交回。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 接线及整项验收
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
