# Execution Capsule — TASK-035 / attempt-13
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `13`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
035三AC功能矩阵和全局setField变更后一次相关组件兼容验收。
## 本轮验收切片
- 11换模型改动同一组件共享状态，需费用/价表/组/能力/目录状态/授权六文件一次合跑，不据触发机械重测。
- 映射保存/取消/表单、运行预算即时看管、模型价不借用/旧账不清和窗口，保留正式依赖及发布闸门。
## 已确认事实（禁止重新推导）
- 11核心6及UI18、12最新窗口/build/types已过，生产未变不重跑。
- 03314–17新组/价格窗口和03406看管17/17证据覆盖运行集成，不能沿用旧摘要说未完成。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `app/renderer/components/DeepseekSettings.tsx` — 共享setField。
2. `docs/tasks/TASK-035.md` — 三AC（负责人审查映射，不作下游全文提示）。
3. `test/ui/deepseek-money.test.tsx` — 费用。
## 修改白名单
- `docs/implementation/TASK-035-acceptance.md`
- max_modified_files: `1`
## 明确非目标
- 不代码改动/全仓发布，真实费用禁止。
## 定向验证（最多 5 条）
1. `npx vitest run test/ui/deepseek-money.test.tsx test/ui/deepseek-model-prices.test.tsx test/ui/deepseek-active-group.test.tsx test/ui/deepseek-reasoning.test.tsx test/ui/deepseek-catalog-status.test.tsx test/ui/deepseek-catalog-consent.test.tsx`
2. `git diff --check`
## 禁止验证
- 不build/types/旧核心/窗口或全量。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `6`
- soft_call_limit: `6`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需代码修复则保存finding另合同，不越白名单。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 验收矩阵
- completed_scope: 功能判定
- remaining_gaps: 发布
- anchors_touched: none
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界
