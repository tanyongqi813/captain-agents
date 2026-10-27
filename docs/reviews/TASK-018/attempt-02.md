# Review Record — TASK-018 / attempt-02

- handoff_contract: `1`
- task_id: `TASK-018`
- attempt: `02`
- capsule: `docs/execution/TASK-018/attempt-02.md`
- reviewed_at: `2026-10-20`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围
- 实际副本：`.worktrees/task-018`，分支 `feat/task-018-cost-budget`，HEAD ff57992。
- 本轮检查 `src/core/cost-budget.ts` 与 `test/cost-budget.test.ts` 的 F-03/F-04 修复，并核对上一轮其余发现对应实现。

## 验证证据
- `node --test --test-timeout=120000 --test-name-pattern='成本预算预占（核心）' test/cost-budget.test.ts` → PASS，16 项，覆盖当前代码。
- 独立临时 XAGENTS_HOME 探针 → 每日 60 分钟、并发 2 仍返回两个 60 分钟 claim；两次回滚后 attempts 为 0 而实际仍有一次预占；非法账本现已拒绝。
- 其余发现对应的 wake、dispatch、设置桥、界面处理仍为上一轮实现。
- 全量 verify、截图及集成验证 → NOT_RUN：仍存在已确认阻塞缺陷，不重复运行重验证。

## Findings
- F-03 — resolved; severity: non_blocking; anchor: `src/core/cost-budget.ts::loadLedger`。仅 ENOENT 初始化，非法 JSON/结构/版本及其他读错误明确拒绝；新增测试通过。
- F-04 — resolved; severity: non_blocking; anchor: `src/core/cost-budget.ts::usable/costGate`。无任何上限且额度未知拒绝，明确 0 拒绝，有效预算及已知额度兼容测试通过。
- F-01 — active; severity: blocking; priority: P1; anchor: `src/core/cost-budget.ts::costGate`。未扣运行中预占时长，两个任务可超领每日总时长，探针仍复现。
- F-02 — active; severity: blocking; priority: P1; anchor: `src/core/cost-budget.ts::reapSlots/releaseAttempt/recordSeconds`、`src/core/wake.ts::resumeMember`。预占身份仍仅 jobId，重复回滚减次数、删除有效占位及旧终态误回收风险未修。
- F-05 — active; severity: blocking; priority: P2; anchor: `app/main/cost-settings.ts::save`。整份保存无旧草稿冲突检测，未修。
- F-06 — active; severity: blocking; priority: P2; anchor: `app/renderer/components/CostSettings.tsx::localRow`。清空部分可选字段不删除原值，未修。
- F-07 — active; severity: blocking; priority: P2; anchor: `src/core/dispatch.ts::dispatch`。登记失败前尚未加入 jobs 的当前 claim 不在回滚列表，未修。

## 架构与范围结论
- 本轮胶囊的两个发现已修复；不能据此判定整个任务通过。
- 不接管实现，不提交或推送未通过任务。用户的提交/同步授权保留，待后续整个任务通过并完成验收后执行。

## 优先级复核
- 已复核，无调整。TASK-018 保持 P1 / High；其他相关未完成任务优先级不变。

## 下一状态
- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-018/attempt-03.md`
- active_findings_for_next_attempt: `F-01`
- remaining_findings: `F-02,F-05,F-06,F-07` 留待后续独立胶囊，不扩大下一轮范围。
