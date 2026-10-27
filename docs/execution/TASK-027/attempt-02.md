# Execution Capsule — TASK-027 / attempt-02

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-027.md`
- task_id: `TASK-027`
- attempt: `02`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

把负责人五动作接入显式启用的新运行模式：绑定原胶囊和受信负责人，决定与整组增量制品原子入账，并可在重启后继续认领同一审查。

## 本轮验收切片

通过 CLI 显式开启后，单任务执行→负责人复审→登记验收可完成；修正/拆分生成胶囊后因尚未授权提交/新起点而有界交给主人，不回退自由提示词。

## 已确认事实（禁止重新推导）

- TASK-039/040 已通过，分别提供严格回包和纯增量编译器。
- updateAutopilot 已锁内读改写并在原子写入前验证整个 run。
- 现有 flow.version=1、reviews.verdict 只有 pass/changes/unclear；旧模式不能静默改变。
- 动作锁与 action.token 已覆盖并发/崩溃认领；新决定须在同次 run 写入中保存。
- 原 TASK-027 attempt-01 未执行，范围过大，本轮按已确认接口替代；不改历史正文。

## Active findings

- none

## 源码锚点（最多 5 个）

1. `src/core/autopilot.ts` — CreateAutopilot / assertRun / updateAutopilot：新增可选协议状态。
2. `src/core/autopilot-flow.ts` — dispatchFlow / stepFlowReview：证据、五动作与受审哈希。
3. `src/core/autopilot-engine.ts` — settle / stepAutopilot：失败及验收失败回到负责人。
4. `src/core/lead-review.ts` — 有界证据和严格回包。
5. `src/core/lead-capsule.ts` — 原边界继承的制品编译。

## 修改白名单

- `src/core/autopilot.ts`
- `src/core/autopilot-flow.ts`
- `src/core/autopilot-engine.ts`
- `src/core/lead-runtime.ts`
- `src/core/dispatch.ts`
- `src/cli/cli.ts`
- `src/cli/autopilot.ts`
- `test/lead-runtime.test.ts`
- max_modified_files: `8`
- exception_reason: 新运行协议的公开显式开关、登记校验、状态转移与原子决定/制品引用属于不可分割数据流；原 UI 和旧模式保持不变。

## 明确非目标

不切换现有 UI；不改旧运行身份；不自动提交/合并/push；不绕过 TASK-025 起点/锚点检查；不自动执行未提交增量胶囊；不实现换人或跨项目队列。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/lead-runtime.test.ts`
2. `node --test --test-timeout=120000 test/autopilot-record.test.ts test/autopilot-engine.test.ts test/autopilot-worktree.test.ts`
3. `npm run typecheck`
4. `git diff --check`
5. `node --test --test-timeout=120000 test/plan-dispatch.test.ts`

## 禁止验证

不运行全量 npm test、UI、build、e2e；不启动真实模型，不查询真实账户；测试均为临时登记与假选手。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `prompt_soft`
- soft_timebox_minutes: `90`
- soft_call_limit: `40`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

若需改变原起点保证、自动提交策略、选手权限或开放 UI/队列，保留本轮边界并返回检查点；不得宣称完整无人看守已发布。

## 精简 Implementation Report（固定格式）

- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | scope_conflict`
- workspace_branch: [path and branch]
- changed_files: [paths]
- completed_scope: [observable results]
- remaining_gaps: [specific gaps]
- anchors_touched: [symbols]
- verification: [command/result; latest_code_covered: yes/no]
- active_findings: [none or findings]
- scope_or_baseline_notes: [new facts]
