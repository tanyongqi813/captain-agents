# Execution Capsule — TASK-028 / attempt-02

- planning_source: `docs/tasks/TASK-028.md`
- handoff_contract: `1`
- task_id: `TASK-028`
- attempt: `02`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- capsule_schema: `2`
- dispatch_state: `READY`

## 本轮唯一目标
把现有返工制品发布收敛为可恢复、可重放且只有一个领取者的规划事务，并明确新 Capsule 的跨重启执行基准。

## 本轮验收切片
- 在每个落盘边界故障注入后恢复，规划与运行要么保持完整旧轮次，要么形成 Review Record、关闭旧 Capsule、新 Capsule、Task 指针和领取租约一致的新轮次；不会重复派发。

## 已确认事实（禁止重新推导）
- attempt-01 已实现增量 Capsule 编译、候选指纹和受限续跑入口，这些严格校验继续保留。
- 当前 `writeAtomic` 只保证单文件替换；目录锁不能提供多文件事务语义。
- 自动 Git 同步必须项目级显式启用，不能通过本任务静默扩大提交范围。

## Active findings
- `F-01`: 多文件发布缺少事务提交点、恢复和同指纹幂等接管。
- `F-02`: 发布、运行登记和领取租约分离，存在公开 READY 与重复启动窗口。
- `F-03`: 新 Capsule 的跨重启 Git/规划执行基准没有持久策略。

## 源码锚点（最多 5 个）
1. `src/core/lead-capsule.ts` — `publishLeadCorrection`: 改为事务意图、CAS、提交点和恢复入口。
2. `src/core/autopilot.ts` — 运行登记：保存稳定 transaction id、租约和幂等启动事实。
3. `src/core/dispatch.ts` — `assertCapsuleInStart`: 对接经授权的不可变规划基准。
4. `test/lead-runtime.test.ts` — 增加逐边界崩溃、并发领取和重放测试。

## 修改白名单
- `src/core/lead-capsule.ts`
- `src/core/autopilot.ts`
- `src/core/dispatch.ts`
- `test/lead-runtime.test.ts`
- `docs/decisions/ADR-*.md`
- max_modified_files: `5`

## 明确非目标
- 不实现 TASK-045 的执行器恢复/换新，不实现 TASK-046 的多子任务拆分，不接 DRAFT 自动队列或归档界面。
- 已通过和未被 F-01～F-03 指向的负责人协议、候选编译和证据收集保持不动。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 --test-name-pattern="transaction|lease|replay|crash" test/lead-runtime.test.ts` — 各故障边界、双领取和同指纹重放通过。
2. `node --test --test-timeout=120000 --test-name-pattern="capsule|base" test/plan-dispatch.test.ts` — 未授权基准拒绝、授权基准可跨重启读取。
3. `npm run typecheck` — 核心、桥和测试类型一致。
4. `node --test --test-timeout=120000 test/task-plan.test.ts` — Task 指针、依赖和 Capsule 资格解析保持有效。

## 禁止验证
- 不运行全量 `npm test`、UI、build、e2e，不启动真实选手，不真实提交或推送。
- 已通过命令只在覆盖代码再次改变后重跑。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `50`
- soft_call_limit: `18`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 事务需要覆盖非规划文件、自动提交未授权路径或修改 handoff_contract 1 公共字段。
- 无法用确定性规则恢复半完成事务或区分合法接管与内容冲突。
- 需要真实凭据、联网、付费调用、破坏性 Git 操作或新的产品决定。

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
- active_findings: [F-01/F-02/F-03 → resolved/unresolved]
- scope_or_baseline_notes: [new fact only; no transcript]
