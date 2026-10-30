# Execution Capsule — TASK-033 / attempt-02

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `02`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

账本只有确实不存在时可以初始化；已有坏文件不得重置或覆盖。

## 本轮验收切片

- 缺文件允许首次预留；零字节、空白、坏 JSON、数组或错误根结构拒绝读取和新预留，原文件逐字不变。
- 正常账本已花金额及停止状态不被重置，现有测试保持。

## 已确认事实（禁止重新推导）

- 当前 load 调 readOptional，空文件与 ENOENT 都变成空串；临时账本已复现结算 1 元后归零并可再次派发。
- fsx 的 readJson 保留 ENOENT，hasCode 可识别错误；不需要修改公共工具。
- 本轮通过不等于 TASK-033 全部业务验收完成；不扩展计价口径。

## Active findings

- `F-01`：区分不存在和损坏；既有坏账本拒绝且保持原文。

## 源码锚点（最多 5 个）

1. `src/core/money-budget.ts` — load、reserveMoney、readMoneyStatus。
2. `test/deepseek-settings.test.ts` — 每日金额账本测试；补隔离坏文件矩阵。
3. `src/core/fsx.ts` — readJson、hasCode；只读复用。

## 修改白名单

- `src/core/money-budget.ts`
- `test/deepseek-settings.test.ts`
- max_modified_files: `2`

## 明确非目标

- 不改 UI、启动参数、凭据、预算设置结构、派发器、公共 fsx 或其他任务文档。
- 已通过和未被 F-01 指向的现有实现保持不动；不提交、不 push。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/deepseek-settings.test.ts test/money-budget-runner.test.ts test/deepseek-credentials.test.ts` — 新回归及既有安全行为通过；临时 XAGENTS_HOME，不用真实密钥。
2. `npm run typecheck` — 四工程通过。
3. `git diff --check` — 无空白错误。

## 禁止验证

- 不跑全量测试、UI、build、e2e、真实接口或收费模型。
- 已覆盖最新修改的通过命令不重复执行。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `prompt_soft`
- soft_timebox_minutes: `25`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

- 需要超白名单、改变计价/设置协议、真实凭据或网络时停止回交。
- 一次实现加一次纠偏仍不通过，返回检查点，不扩修。

## 精简 Implementation Report（固定格式）

- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | runner_limit | context_limit | external_decision | permission | scope_conflict`
- workspace_branch: 绝对工作区及分支
- changed_files: 路径
- completed_scope: 完成项
- remaining_gaps: 未完成项
- anchors_touched: 符号与测试名
- verification: 命令、结果与 latest_code_covered
- active_findings: F-01 resolved/unresolved
- scope_or_baseline_notes: 新事实
