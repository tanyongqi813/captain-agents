# Execution Capsule — TASK-033 / attempt-13

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `13`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
修F-04：活动DeepSeek组不得影响非DeepSeek派发。
## 本轮验收切片
- 只有含DeepSeek选手才继承保存组；原显式moneyGroup在非DS仍拒绝。
- 真CLI Codex替身在保存accountB时正常完成、无DS费用预留。
## 已确认事实（禁止重新推导）
- 12保存组/DS派发/视图/UI已过，保持不动，仅修跨通道条件。
## Active findings
- F-04: dispatch无条件采用保存组导致其他通道被拒。
## 源码锚点（最多 5 个）
1. `src/core/dispatch.ts` — moneyGroup。
2. `test/deepseek-active-group.test.ts` — CLI替身。
## 修改白名单
- `src/core/dispatch.ts`
- `test/deepseek-active-group.test.ts`
- max_modified_files: `2`
## 明确非目标
- 12其他通过实现保持，不改UI/账本/runner。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-active-group.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不UI/build/e2e/全量或其他已过测试。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `8`
- soft_call_limit: `8`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 一次纠偏仍失败或需白名单外则交回。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: F-04
- remaining_gaps: 整项
- anchors_touched: moneyGroup
- verification: 结果与latest_code_covered
- active_findings: F-04
- scope_or_baseline_notes: 边界
