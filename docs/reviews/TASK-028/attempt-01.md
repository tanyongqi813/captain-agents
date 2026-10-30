# Review Record — TASK-028 / attempt-01

- task_id: `TASK-028`
- handoff_contract: `1`
- attempt: `01`
- capsule: `docs/execution/TASK-028/attempt-01.md`
- reviewed_at: `2026-10-27`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围
- implementation_report: 当前工作区的 TASK-028 部分实现与定向验证记录。
- diff_scope: `src/core/lead-capsule.ts`、`src/core/lead-runtime.ts`、`src/core/autopilot-flow.ts`、`src/core/autopilot-engine.ts`、`src/core/autopilot.ts` 及定向测试。
- acceptance_slice: correct/split 规划发布、自动续派、崩溃重放与人工介入边界。

## 验证证据
- `npm run typecheck` → PASS：先前记录显示四工程类型检查通过；本次复审未修改上述实现。
- `node --test --test-timeout=120000 test/lead-runtime.test.ts test/lead-capsule.test.ts` → NOT_RUN：最终改动后未留下完整套件的新鲜通过证据。
- 静态状态流检查 → FAIL：多文件依次写入、运行登记滞后和公开 READY 窗口不能证明原子性或唯一领取。

## Findings
- `F-01` — `active`; severity: `blocking`; anchor: `src/core/lead-capsule.ts::publishLeadCorrection`; 锁内逐文件写入不是多文件事务，崩溃可留下 Capsule、Task Spec、TASK_LIST 与 Review Record 不一致；必须加入意图、提交点、恢复和同指纹幂等规则。
- `F-02` — `active`; severity: `blocking`; anchor: `src/core/autopilot-flow.ts::stepFlowReview`; 新胶囊发布与运行登记/领取分离，存在重复派发窗口；必须用唯一租约将发布、领取和恢复绑定。
- `F-03` — `active`; severity: `blocking`; anchor: `src/core/dispatch.ts::assertCapsuleInStart`; 新规划只在工作区可见，跨进程重启无法保证执行基准包含 Capsule；必须形成明确 ADR 和项目级授权策略。

## 架构与范围结论
- alignment: 增量 Capsule 和指纹校验方向保留，但当前实现不满足无人值守所需的一致性与恢复边界。
- scope: 原 Task 同时承载事务、correct、split 和恢复，超过可独立验收范围；已拆为 TASK-028、TASK-045、TASK-046。
- preserved_behavior: 已实现的严格负责人协议、候选指纹和旧运行证据继续保留，不要求回退。

## 优先级复核
- `TASK-028` 保持 P1，但在 P1 自动化链内提到最前：半发布或重复派发会破坏规划数据和无人值守安全。
- `TASK-045/TASK-046/TASK-043`：按单任务返工、拆分、自动队列顺序保持 P1。
- `TASK-044` 保持 P2，但解除对 TASK-043 的伪依赖，仅按产品顺序后置。

## 下一状态
- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-028/attempt-02.md`
- active_findings_for_next_attempt: `F-01,F-02,F-03`
