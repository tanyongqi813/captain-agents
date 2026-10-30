# Execution Capsule — TASK-033 / attempt-04

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `04`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
修复收费账本跨日兜底证据与金额定点运算，不改变现有外部接口。

## 本轮验收切片
- 无最终用量的正常收尾及重启补结算保留日期未知区间，重复事件不丢失。
- 金额与预算比较使用整数/十进制定点；0.07 × 100 恰为 7 微元，多项累计和预留溢出拒绝且文件不改。

## 已确认事实（禁止重新推导）
- 已离线复现次日兜底导致前一日 unknown=0、0.07 × 100 算为 8 微元。
- 37 项已有定向测试为历史证据，修复后须覆盖最新代码。
- F-01、既有锁与坏账本保护保持；不接受整任务已完成的声明。

## Active findings
- `F-02`：无用量兜底缺跨日未知区间，含重启回收路径。
- `F-03`：浮点金额、预算比较及加总缺精确定点与溢出保护。

## 源码锚点（最多 5 个）
1. `src/core/money-budget.ts` — units、load、status、reserveMoney、observeMoney。
2. `test/money-budget.test.ts` — 跨日/恢复/并发测试。

## 修改白名单
- `src/core/money-budget.ts`
- `test/money-budget.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不改 UI、设置协议、凭据、模型和派发接线，不读真实密钥，不收费调用。
- 已通过且无关实现保持；多账户及独立缓存写入价后续单独切片。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget.test.ts test/deepseek-settings.test.ts test/money-budget-runner.test.ts test/deepseek-credentials.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量/UI/build/e2e/真实接口；最新代码未变不重复通过命令。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `35`
- soft_call_limit: `20`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 超白名单或需改变公共协议时回交；一次实现和一次纠偏后仍失败则停止本轮。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 绝对工作区及分支
- changed_files: 路径
- completed_scope: 完成项
- remaining_gaps: 未完成项
- anchors_touched: 符号
- verification: 命令结果及 latest_code_covered
- active_findings: F-02/F-03 resolved/unresolved
- scope_or_baseline_notes: 新事实

