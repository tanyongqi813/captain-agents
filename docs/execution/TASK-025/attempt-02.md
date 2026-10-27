# Execution Capsule — TASK-025 / attempt-02

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-025.md`
- task_id: `TASK-025`
- attempt: `02`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

补齐派活起点对当前 Capsule“源码锚点”的安全校验：所选 base 缺少任一明确源码路径，或锚点路径无法安全、无歧义解析时，必须在注册任务和创建副本前拒绝。

## 本轮验收切片

- 只修复 Review F-01；保留 attempt-01 已通过的 Capsule 资格、原文正文、指纹一致性和 DeepSeek/Kimi 外层节流行为。

## 已确认事实（禁止重新推导）

- attempt-01 的 45 条定向测试、四工程 typecheck 与 `git diff --check` 已通过。
- `readDispatchCapsule` 已在工作区侧完成当前 Capsule 的资格、路径、元数据、章节和读取边界校验。
- `assertCapsuleInStart` 已在任何任务注册、副本创建和选手启动之前校验 base 中 Capsule 的路径与指纹，但尚未校验源码锚点。
- 源码锚点只来自当前 Capsule 的 `## 源码锚点（最多 5 个）` 章节；不得从 Task Spec、聊天或整份文档散文中猜测。

## Active findings

- `F-01` — `active`; `src/core/dispatch.ts::assertCapsuleInStart`; 起点只校验 Capsule，没有证明同一起点包含 Capsule 明列的源码锚点。

## 源码锚点（最多 5 个）

1. `src/core/task-plan.ts` — 在当前 Capsule 的限定章节中提取最多 5 个安全、明确的仓库相对文件路径。
2. `src/core/plan-dispatch.ts` — 将已校验的锚点路径随 Capsule 引用传入派发层，不改变正文。
3. `src/core/dispatch.ts` — 在启动前验证 base 同时包含 Capsule 与全部源码锚点。
4. `test/task-plan.test.ts` — 锚点提取、限量及非法/含糊路径拒绝回归。
5. `test/plan-dispatch.test.ts` — base 缺锚点时零注册、锚点齐全时正常派发及既有行为回归。

## 修改白名单

- `src/core/task-plan.ts`
- `src/core/plan-dispatch.ts`
- `src/core/dispatch.ts`
- `test/task-plan.test.ts`
- `test/plan-dispatch.test.ts`
- max_modified_files: `5`

## 明确非目标

- 不改 Capsule 正文、Task Spec、TASK_LIST、Review Record 或提示词拼装策略。
- 不改变公共规则、模型选择、额度、隔离、并发、成本、worktree 或自动领取策略。
- 不扫描目录寻找替代文件，不从函数名或自然语言描述猜测路径。
- 不提交、不 push、不启动真实选手。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/task-plan.test.ts test/plan-dispatch.test.ts`
2. `npm run typecheck`
3. 定向测试证明 base 含同一 Capsule 但缺任一源码锚点时，在任务注册和副本创建前拒绝；错误同时给出 base 与工作区 HEAD 短提交号及缺失路径。
4. 定向测试证明 base 含 Capsule 与全部锚点时正常派发，选手正文仍是 Capsule 原文，DeepSeek/Kimi 外层适配不变。
5. 定向测试证明绝对路径、`..`、空锚点、超过 5 个或无法无歧义提取的锚点拒绝，不降级为警告。

## 禁止验证

- 不运行全量 `npm test`、UI、build、e2e；不启动真实选手或查询真实账户。
- 不因现有工作区其他任务改动扩大测试或实现范围。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `mixed`
- soft_timebox_minutes: `25`
- soft_call_limit: `10`
- runner_limit_reference: `project budget 20/5/120 minutes`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

- 需要修改白名单外文件、超过 5 个文件或改变派发正文/模型适配/副本策略时停止并报告。
- 无法从限定章节可靠得到安全仓库相对路径时必须拒绝派发，不允许跳过或猜测。
- 本次修正仍未满足 F-01 时返回检查点，不生成第三轮 Capsule。

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
- active_findings: [`F-01` → resolved/unresolved]
- scope_or_baseline_notes: [new fact only; no transcript]
