# Execution Capsule — TASK-033 / attempt-07

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `07`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
派发将实际模型ID与默认预算归属传入已通过的预留身份接口。

## 本轮验收切片
- DeepSeek派发使用job.model和default组，price仍来自同一次保存连接快照。
- 替身执行两轮，换模型/地址/价不修改旧身份价，不重置今日账，所有金额仍共享默认预算。

## 已确认事实（禁止重新推导）
- 06 MoneyIdentity核心17/17和types已过，reserveMoney新增可选第五参数。
- dispatch已在注册前把choice.model换成保存实际ID，并把连接快照写入Job；本批不改启动参数或隔离。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/dispatch.ts` — choice.model、reserveMoney。
2. `src/core/money-budget.ts` — 身份接口，只读。
3. `test/money-budget-runner.test.ts` — 替身模式，只读。

## 修改白名单
- `src/core/dispatch.ts`
- `test/money-budget-dispatch-identity.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不改workers启动参数、runner或UI；不启用独立组额度；不真实收费或提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-dispatch-identity.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重复已过06核心；不跑全量/UI/build/窗口或真实调用。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 超白名单、来源冲突或一次纠偏仍失败回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 分组/价表及整项验收
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
