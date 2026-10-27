# Review Record — TASK-018 / attempt-04

- handoff_contract: `1`
- task_id: `TASK-018`
- attempt: `04`
- capsule: `docs/execution/TASK-018/attempt-04.md`
- reviewed_at: `2026-10-20`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围
- implementation_report: 用户提供的 attempt-04 报告，核对 `.worktrees/task-018` 的实际实现与测试。
- acceptance_slice: F-01 旧账本兼容缺口。

## 验证证据
- `node --test --test-timeout=120000 --test-name-pattern='成本预算预占（核心）' test/cost-budget.test.ts` → PASS，20/20，约 0.41 秒，覆盖当前代码。
- `git diff --check` → PASS。
- 代码核对：每日时长启用且旧占位未知时明确拒绝；recordSeconds 结算 900 秒后只分配 45 分钟；不设每日时长上限时仍沿用原次数/并发规则。
- 未运行全量 verify、构建或窗口截图：整体仍有已知阻塞发现，待修复后统一验收。

## Findings
- F-01 — resolved; severity: non_blocking; anchor: `src/core/cost-budget.ts::costGate`。接受新格式时长预占及本轮旧格式保守拒绝；正常结算后按余额恢复分配。
- F-03/F-04 — resolved，保持原结论。
- F-02 — active; severity: blocking; priority: P1; anchor: `cost-budget.ts::reapSlots/releaseAttempt/recordSeconds` 与 `wake.ts::resumeMember`。尝试级所有权、重复释放与旧终态误回收仍需修复；F-01 关闭不代表这些生命周期路径已安全。
- F-05 — active; severity: blocking; priority: P2; anchor: `app/main/cost-settings.ts::save`。旧草稿冲突保护未实现。
- F-06 — active; severity: blocking; priority: P2; anchor: `app/renderer/components/CostSettings.tsx::localRow` 及次数套餐 count 输入。清空后未删除原字段，直接检查最新代码仍存在。
- F-07 — active; severity: blocking; priority: P2; anchor: `src/core/dispatch.ts::dispatch`。登记前失败遗漏当前 claim 回滚，仍开放。

## 架构与范围结论
- 本轮切片通过，TASK-018 整体保持 CHANGES_REQUESTED；未提交、未推送，保留通过后同步的用户授权。
- 下一步选择独立、两文件的 F-06 界面修正；F-02 跨派发/续跑/收尾的预占身份迁移需另行完整规划，避免扩大单次执行。

## 优先级复核
- 已复核，无调整。TASK-018 保持 P1 / High；其他相关未完成任务优先级不变。

## 下一状态
- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-018/attempt-05.md`
- active_findings_for_next_attempt: `F-06`
- remaining_findings: `F-02,F-05,F-07` 后续另行胶囊。
