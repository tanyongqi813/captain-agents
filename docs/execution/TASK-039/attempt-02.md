# Execution Capsule — TASK-039 / attempt-02

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-039.md`
- task_id: `TASK-039`
- attempt: `02`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

修正 F-01：在调用既有脱敏函数前，对超长 ASCII 标记做有界预处理；先替换已知真实路径，不能留下部分路径或密钥片段。

## 本轮验收切片

240000 字符连续标记的证据可快速处理；超长路径与标记只显示隐去提示，既有普通脱敏和协议校验保持不变。

## 已确认事实（禁止重新推导）

- attempt-01 的协议与测试已通过，保持不动。
- 代码审计发现：既有通用脱敏器对长 ASCII 串的前向检查可能反复扫描。本轮只在新负责人模块添加保护，不改旧诊断协议。

## Active findings

- `F-01`: 长 ASCII 标记的脱敏扫描需要预处理，避免大报告拖慢负责人证据构造。

## 源码锚点（最多 5 个）

1. `src/core/lead-review.ts` — buildLeadReviewPacket 的 piece：仅增加有界预处理。
2. `test/lead-review.test.ts` — 长标记、长路径与普通脱敏回归。

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
