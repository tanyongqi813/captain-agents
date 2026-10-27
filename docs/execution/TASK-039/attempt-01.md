# Execution Capsule — TASK-039 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-039.md`
- task_id: `TASK-039`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

实现无副作用的负责人证据包和五动作回包校验底座，供后续自治接线复用。

## 本轮验收切片

六类证据有界且脱敏；回包绑定候选与胶囊指纹，严格拒绝越权/重复字段，修正与拆分仅为提案。

## 已确认事实（禁止重新推导）

- 旧诊断动作是 continue/retry/verify/split/owner，不得混用。
- 当前自治 reviews 只存 pass/changes/unclear；本轮不修改其持久结构。
- TASK-025 已提供胶囊元数据、结构与源码锚点读取。

## Active findings

- none

## 源码锚点（最多 5 个）

1. `src/core/autopilot-diagnosis.ts` — redactText / checkSplitGraph：复用脱敏与图校验。
2. `src/core/task-plan.ts` — contractMetadata / sectionNames / capsuleFingerprint：胶囊结构与版本。
3. `test/autopilot-diagnosis.test.ts` — 纯函数协议边界测试模式。

## 修改白名单

- `src/core/lead-review.ts`
- `test/lead-review.test.ts`
- max_modified_files: `2`

## 明确非目标

不接 UI、IPC、凭据、收费模型、持久状态、真实派发；不改旧诊断协议；不提交或推送。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/lead-review.test.ts test/autopilot-diagnosis.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证

不运行全量测试、UI、build、e2e；不启动真实选手，不查询真实账户。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `prompt_soft`
- soft_timebox_minutes: `40`
- soft_call_limit: `20`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

需要运行侧接线、扩展持久结构或修改白名单外实现时，保留底座并返回检查点，不宣称 TASK-027 完成。

## 精简 Implementation Report（固定格式）

- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | scope_conflict`
- workspace_branch: [absolute workspace and branch]
- changed_files: [paths]
- completed_scope: [observable result]
- remaining_gaps: [specific gaps]
- anchors_touched: [symbols]
- verification: [command and result; latest_code_covered: yes/no]
- active_findings: [none or findings]
- scope_or_baseline_notes: [new facts]
