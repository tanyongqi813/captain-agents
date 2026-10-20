# Review Record — TASK-018 / attempt-03

- task_id: `TASK-018`
- attempt: `03`
- capsule: `docs/execution/TASK-018/attempt-03.md`
- reviewed_at: `2026-10-20`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围
- implementation_report: 用户提供的 attempt-03 报告。
- diff_scope: `.worktrees/task-018/src/core/cost-budget.ts` 与 `test/cost-budget.test.ts`，直接检查实际文件。
- acceptance_slice: F-01 账户并发时长预占及旧账本兼容。

## 验证证据
- `node --test --test-timeout=120000 --test-name-pattern='成本预算预占（核心）' test/cost-budget.test.ts` → PASS，19/19，约 0.43 秒，覆盖当前代码。
- `git diff --check` → PASS。
- 新格式正常路径：首件预占 3600 秒后第二件拒绝；结算 1800 秒后仅可领取 1800 秒；启动失败归还预占。上述实现和测试接受并保留。
- 旧格式路径：新增测试明确断言无 seconds 的旧占位存在时，新任务仍领取 60 分钟。该断言固化了未确认在途消耗按 0 计算的缺陷，测试通过不能证明账户总上限安全。

## Findings
- F-01 — active; severity: blocking; priority: P1; anchor: `src/core/cost-budget.ts::costGate`（171 行）及 `test/cost-budget.test.ts::旧账本的并发位没有时长预占字段也能读`。`slot.seconds ?? 0` 将旧任务的未知预占当成 0。升级/重启读取仍在运行的旧任务后，新任务可领满当日预算，旧任务稍后结算使总用时超限。合法旧账本可继续读取，但每日时长策略启用时必须对未知在途时长保守拒绝新分配，或依据可靠证据迁移；不能把缺字段等同已确认无消耗。替换现有测试预期，补 running 旧任务及结算后恢复分配用例。
- F-03/F-04 — resolved，维持上轮结论。
- F-02/F-05/F-06/F-07 — active，未在本轮修复；沿用 attempt-02 的范围及要求。

## 架构与范围结论
- 新格式预占方向正确、修改范围符合两文件白名单；旧格式降级路径仍违反总量上限。
- 本次不提交、不推送。用户已授权整个任务通过后的提交同步，该授权保留。
- 最终 verify、窗口截图及整体接线验收仍待全部阻塞发现修复。

## 优先级复核
- 已复核，无调整。TASK-018 保持 P1 / High，其他相关任务优先级不变。

## 下一状态
- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-018/attempt-04.md`
- active_findings_for_next_attempt: `F-01`
- remaining_findings: F-02/F-05/F-06/F-07 后续单独派发，不扩大本轮。
