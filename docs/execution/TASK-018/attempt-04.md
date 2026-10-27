# Execution Capsule — TASK-018 / attempt-04

- dispatch_state: `待确认`
- handoff_contract: `1`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `04`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `Medium`
- required_planning_lookup: `none`
- capsule_schema: `2`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
仅补 F-01 的旧账本路径：不能将无 seconds 字段的在途任务当作时长预占为 0。

## 本轮验收切片
- 合法旧账本仍可读取；启用每日时长上限且存在未结算旧占位时，保守拒绝新时长分配，并给出等待旧任务结算的原因。
- 旧任务正常 recordSeconds 结算并释放占位后，新任务仅能领取每日上限减去已结算用时的余额。
- 未设置每日时长上限时保持原并发/次数规则；已有明确 seconds 的预占不回退。

## 已确认事实（禁止重新推导）
- 19 项核心定向测试当前通过，新格式预占、正常结算和启动失败归还已接受，保留实现。
- 当前 costGate 使用 slot.seconds ?? 0；旧占位的未知量被当作 0。
- 原“旧账本…按无预占对待”测试的放行预期错误，需替换，不重写整个测试文件。

## Active findings
- `F-01`：仅剩旧格式未知在途时长被当作 0 的兼容缺口。

## 源码锚点（最多 5 个）
1. `src/core/cost-budget.ts` — `costGate`：分配前检查在途预占是否可确定。
2. `src/core/cost-budget.ts` — `loadLedger/recordSeconds`：只理解既有兼容和结算，不改公开接口。
3. `test/cost-budget.test.ts` — 旧账本兼容测试及核心组：调整预期，补 running 任务和结算后恢复分配。

## 修改白名单
- `src/core/cost-budget.ts`
- `test/cost-budget.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不修 F-02/F-05/F-06/F-07，不动 runner/wake/dispatch/UI/IPC/文档，不提交、不 push、不 stash。
- 采用保守拒绝即可，不必构建旧账本迁移系统；不新增依赖。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 --test-name-pattern='成本预算预占（核心）' test/cost-budget.test.ts` — 全部核心组通过，包含旧占位未知时拒绝、结算后正确领取、无每日时长上限时兼容。

## 禁止验证
- 不跑全量、typecheck、UI、build、e2e，不启动真实选手，不重复未受修改影响的已通过命令。

## 已知基线失败
- none confirmed。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `none`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
- 以上是软约束，不代表运行器强制终止。

## 停止条件
- 需要白名单以外修改，或一次实现加一次纠偏仍未完成：保留改动并输出检查点，停止扩修。

## 精简 Implementation Report（固定格式）
- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | scope_conflict | external_decision`
- workspace_branch: 绝对路径与分支
- changed_files: 路径
- completed_scope: 完成项
- remaining_gaps: 未完成点
- anchors_touched: 函数或测试名
- verification: 命令 → PASS/FAIL/NOT_RUN；latest_code_covered: yes/no
- active_findings: F-01 → resolved/unresolved
- scope_or_baseline_notes: 仅新增事实，报告总计不超过 400 字。
