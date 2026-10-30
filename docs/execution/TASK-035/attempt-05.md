# Execution Capsule — TASK-035 / attempt-05

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `05`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
编辑窗口接入已通过的安全余量核心字段。

## 本轮验收切片
- 可选输入 safetyMargin，空白删除键、0保留、合法值经保存和组件重开回显；取消不保存、不污染原值。
- 非法金额走核心验证，拒绝且保留草稿；说明只占预留不计实际消费。

## 已确认事实（禁止重新推导）
- attempt04核心17/17及types通过；安全余量独立冻结，旧配置缺省0。原子预占校验执行预留加余量不超过可用上限。
- 本轮不重写核心、不冒称组件重挂载为磁盘持久化。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/renderer/components/DeepseekSettings.tsx` — moneyField、submit。
2. `test/ui/deepseek-money.test.tsx` — 可选字段测试。
3. `docs/ui-spec.md` — 每日费用配置。

## 修改白名单
- `app/renderer/components/DeepseekSettings.tsx`
- `test/ui/deepseek-money.test.tsx`
- `docs/ui-spec.md`
- max_modified_files: `3`

## 明确非目标
- 不改核心、runner、网络、密钥、模型或提交策略。

## 定向验证（最多 5 条）
1. `npm run test:ui -- test/ui/deepseek-money.test.tsx`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量、build、窗口或真实收费调用；最新窗口独立后续验收。

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
- 超白名单、来源不明并发或一次纠偏仍失败回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 整项剩余
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
