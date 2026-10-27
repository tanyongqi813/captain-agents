# Execution Capsule — TASK-025 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-025.md`
- task_id: `TASK-025`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

让规划派发以校验通过的当前 Execution Capsule 原文作为唯一任务正文，并在创建执行副本前证明所选 Git 起点包含同一 Capsule；不再从 Task Spec 机械拼装执行提示词。

## 本轮验收切片

- 完成 Capsule 派发资格、受限读取、原文投递和 Git 起点一致性闭环；保留现有 DeepSeek/Kimi 外层节流与负责人复审流程。

## 已确认事实（禁止重新推导）

- `readHandoffReport` 已提供 `ready`、`dispatchable`、稳定诊断和 Capsule/Review 交叉引用校验。
- `planDispatch` 当前调用 `readTaskPlan` 后由 `promptText` 从 Task Spec 摘要机械生成题目，这是本轮要替换的路径。
- `dispatch` 当前在创建副本前解析 `base` commit，并统一叠加公共规则、项目规则和 DeepSeek/Kimi `workerPrompt` 节流层；这些外层规则必须保留。
- 主工作区未提交规划文件不会自动进入新 worktree；所选 base 不包含当前 Capsule 时必须在启动选手前拒绝，并明确显示工作区与 base 的提交信息。
- 自由群聊正文不是机器派活信号；本轮不从聊天内容推导 Task 或 Capsule。

## Active findings

- none

## 源码锚点（最多 5 个）

1. `src/core/task-plan.ts` — `readHandoffReport`、Capsule 路径及元数据交叉引用。
2. `src/core/plan-dispatch.ts` — `readyTask`、`promptText`、`planDispatch`，将资格判定和任务正文切到当前 Capsule。
3. `src/core/dispatch.ts` — base commit 解析、dirty 检查、worktree 创建与 `prompt/workerPrompt` 外层适配。
4. `test/task-plan.test.ts` — dispatchable 与 Capsule 读取安全边界。
5. `test/plan-dispatch.test.ts` — 实际派发正文、缺失/错配 Capsule、base 落后和模型适配回归。

## 修改白名单

- `src/core/task-plan.ts`
- `src/core/plan-dispatch.ts`
- `src/core/dispatch.ts`
- `test/task-plan.test.ts`
- `test/plan-dispatch.test.ts`
- max_modified_files: `5`

## 明确非目标

- 不把 TASK_LIST、完整 Task Spec、Review Record 或聊天历史发给执行者。
- 不重写公共 prompt 规则、模型选择、额度、隔离、并发、成本或工作区策略。
- 不新增界面、依赖、网络查询或新的自动领取策略；TASK-026 仍负责多项目队列。
- 不提交、不 push、不迁移当前仓库文档。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/task-plan.test.ts test/plan-dispatch.test.ts`
2. `npm run typecheck`
3. 定向测试证明发给执行者的任务正文包含当前 Capsule、但不包含 Task Spec 独有正文、TASK_LIST 或历史 Review 内容。
4. 定向测试证明 Capsule 缺失、路径/元数据错配、非 READY/CLAIMED/CLOSED、以及 base commit 不含当前 Capsule 时均在启动选手前拒绝。
5. 定向测试证明 DeepSeek/Kimi 仍追加既有 `workerPrompt` 节流层，其他模型正文不被额外扩展。

## 禁止验证

- 不运行全量 `npm test`、UI、build、e2e；不启动真实选手或查询真实账户。
- 不因现有工作区其他任务改动扩大测试或实现范围。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `mixed`
- soft_timebox_minutes: `40`
- soft_call_limit: `14`
- runner_limit_reference: `project budget 20/5/120 minutes`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

- 需要修改白名单外文件、超过 5 个文件或改变现有额度/隔离/副本策略时停止并报告。
- 无法在启动选手前可靠证明 base 含当前 Capsule 时，不降级为警告或让执行者自行查找；返回 blocked/partial 说明缺口。
- 每项实现与测试最多一次纠偏；仍未完成则返回检查点，不重发完整任务。

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
