# Execution Capsule — TASK-027 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-027.md`
- task_id: `TASK-027`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

把写手结束后的候选成果统一送入唯一受信负责人复审：负责人只收到有界证据包，只能返回五种固定动作；平台校验回包后才接受成果、生成增量 Capsule 或有界转给主人。

## 本轮验收切片

- 完成负责人证据包、固定动作协议及现有自治复审状态机接入；用替身证明自动交接的信息边界与人工复制 Capsule、报告和验证证据等价。

## 已确认事实（禁止重新推导）

- `autopilot-flow.ts::stepFlowReview` 已在只读 reviewer 副本中核对候选补丁哈希，并在通过后才更新 accepted；该并发与过期结论防护必须保留。
- 当前 reviewer prompt 主要由 Task Spec 目标/验收与候选 diff 组成，仍使用 `team.ts::parseReview` 的“通过/要改”自由报告，不是本任务要求的五动作协议。
- `autopilot-diagnosis.ts` 已提供文本脱敏、分段限长、预算与无效回包 fail-closed 的可复用模式；负责人复审协议不得复用其 continue/retry/verify 动作集合。
- 当前负责人由 `run.flow.reviewer` 固定，且与写手不同；不得从项目文件、Capsule、报告或执行者输出覆盖负责人身份。
- TASK-029 才实现写手回退顺序；本轮 `handoff` 只记录受控决定并有界交给主人，不自行选择下一位执行者。

## Active findings

- none

## 源码锚点（最多 5 个）

1. `src/core/autopilot-diagnosis.ts` — 在既有脱敏、限长和严格 JSON 解析模式旁新增独立的负责人证据包与 `accept | correct | handoff | split | owner` 回包协议；不得混用现有诊断动作。
2. `src/core/autopilot-flow.ts` — 将现有只读候选复审切到负责人协议，保留补丁哈希、预算、动作令牌和零副作用校验。
3. `test/autopilot-worktree.test.ts` — 覆盖成功交接、五动作、非法回包、负责人不可用与人工等价信息边界。

## 修改白名单

- `src/core/autopilot-diagnosis.ts`
- `src/core/autopilot-flow.ts`
- `test/autopilot-worktree.test.ts`
- max_modified_files: `3`

## 明确非目标

- 不实现 TASK-029 的写手选择、回退顺序或自动换人。
- 不实现 TASK-026 的多项目领取、并发调度、授权界面或预算面板。
- 不允许负责人回包携带命令、模型、权限、联网、仓库路径或直接 Task 状态写入。
- 不把完整聊天、完整日志、历史 Review Record 或 Task Spec 原文放入负责人证据包。
- 不提交、不 push、不启动真实选手。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/autopilot-worktree.test.ts`
2. `npm run typecheck`
3. 定向替身证明完成、执行失败、验收失败和主动中断都先形成有界负责人证据；证据只含当前 Capsule、Implementation Report、diff 摘要、结构化活动、验证结果和剩余预算，且路径/密钥脱敏。
4. 定向替身证明只接受 `accept | correct | handoff | split | owner`；未知动作、额外敏感字段、格式错误、负责人失败或预算不足均在副作用前转 `needs_owner`。
5. 定向替身证明 `correct`/`split` 只产出契约校验通过的增量 Capsule，`handoff` 不自行换人，候选哈希变化仍拒绝过期结论。

## 禁止验证

- 不运行全量 `npm test`、UI、build、e2e；不启动真实选手、真实负责人或查询真实账户。
- 不重复 attempt-02 已通过的规划 Capsule/Base 锚点测试，除非本轮实际修改其代码。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `mixed`
- soft_timebox_minutes: `45`
- soft_call_limit: `16`
- runner_limit_reference: `project budget 20/5/120 minutes`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

- 需要修改白名单外文件、超过 3 个文件或改变写手选择/多项目领取时停止并报告。
- 无法在现有 `AutopilotRun` 字段内安全记录五动作，确需迁移持久结构时停止并给出所需字段与兼容方案，不直接扩表。
- 无法生成契约校验通过的 delta Capsule 时，`correct`/`split` 必须拒绝并转给主人，不得输出半成品或回退自由提示词。
- 任一动作绕过候选补丁哈希、预算或负责人身份校验时停止，不宣称完成。

## 精简 Implementation Report（固定格式）

- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | runner_limit | context_limit | external_decision | permission | scope_conflict`
- workspace_branch: `[absolute workspace or worktree] @ [branch or detached SHA]`
- changed_files: [paths only]
- completed_scope: [observable work completed]
- remaining_gaps: [specific unfinished work; `none` only when completed]
- anchors_touched: [symbols/tests only]
- verification: [command → PASS/FAIL/NOT_RUN; latest_code_covered: yes/no]
- active_findings: [finding id → resolved/unresolved]
- scope_or_baseline_notes: [new fact only; no transcript]
