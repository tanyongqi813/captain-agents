# Execution Capsule — TASK-028 / attempt-01

- planning_source: `docs/tasks/TASK-028.md`
- handoff_contract: `1`
- task_id: `TASK-028`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- capsule_schema: `2`
- dispatch_state: `CLOSED`

## 本轮唯一目标

将负责人已校验的 correct/split 增量 Capsule 在规划锁内发布，并在指纹、依赖、预算和副本均可核对时自动续派；只将真正需要外部决定的情况交给主人。

## 本轮验收切片

- 用替身证明 correct/split 的规划三份文件成组发布、续派无需点击、崩溃重放不重复；过期指纹、预算不足和无法核对副作用才求助。

## 已确认事实（禁止重新推导）

- `runner.ts` 和既有自治记录已保留 `stalled` / `timed_out` 终止语义，不得改成单一“失败”。
- TASK-027 已建立唯一受信负责人的五动作复审协议；TASK-040 已建立增量 Capsule 编译与结构校验。
- 中断后的副本、diff、日志尾、活动与验证证据必须保留；不自动提交、不删除副本。

## Active findings

- none

## 源码锚点（最多 5 个）

1. `src/core/lead-capsule.ts` — `compileLeadCapsules` 及新发布事务：锁内重读、防覆盖、成组写入与可派发复核。
2. `src/core/lead-runtime.ts` — `makeLeadDecision`：决定、候选指纹与已发布 Capsule 绑定。
3. `src/core/autopilot-flow.ts` — `stepFlowReview`：correct/split 发布后生成有界续派动作，并保留恢复证据。
4. `test/lead-runtime.test.ts` — 真实临时 Git 仓库中的发布、过期、重放和零手动点击回归。

## 修改白名单

- `src/core/lead-capsule.ts`
- `src/core/lead-runtime.ts`
- `src/core/autopilot-flow.ts`
- `test/lead-runtime.test.ts`
- max_modified_files: `4`

## 明确非目标

- 不实现 TASK-029 的写手回退顺序或最终失败通知，不实现 TASK-026 的多项目队列。
- 不把单条命令无输出直接判定为停滞，不影响其他并行任务的进程树。
- 不改动负责人身份、模型、权限、联网、计价或任务规划文档；不提交、不 push。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/lead-runtime.test.ts test/lead-capsule.test.ts` — 发布事务、续派、过期和崩溃重放边界通过。
2. `npm run typecheck` — 共享核心、桌面桥与测试类型一致。

## 禁止验证

- 不运行全量 `npm test`、UI、build、e2e，不启动真实选手或真实负责人。
- 已通过的定向命令只在其覆盖代码再次改动后重跑。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `prompt_soft`
- soft_timebox_minutes: `45`
- soft_call_limit: `16`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

- 需要修改白名单外文件、超过 4 个修改文件，或需要改变 TASK-027/TASK-040 已通过的协议。
- 无法区分停滞、超时、主人手动停止或外部取消；或发现副本/外部副作用无法保留。
- 需要新权限、凭据、真实付费调用或产品/架构决策。

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
