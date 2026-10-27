# Review Record — TASK-018 / attempt-05

- handoff_contract: `1`
- task_id: `TASK-018`
- attempt: `05`
- capsule: `docs/execution/TASK-018/attempt-05.md`
- reviewed_at: `2026-10-20`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围
- 用户提供的 attempt-05 报告及 `.worktrees/task-018` 实际 UI 实现与新增测试，补查核心类型检查。

## 验证证据
- `npm run test:ui -- test/ui/settings-cost.test.tsx` → PASS，7/7。
- `git diff --check` → PASS。
- `npm run typecheck` → FAIL，核心首阶段即报 9 个诊断：cost-budget.ts:56 Object.entries(value.days)；69 行 jobId/round/seconds；71 行 seconds/attempts/failures；80 行 jobId/since 均未从 unknown 正确收窄。后续桌面三个阶段未执行，不能视为通过。
- F-06 四处 onChange 已显式 delete 清空字段；新增测试验证三字段清空与 concurrent=0，未单独覆盖 concurrent 清空，但代码路径已直接核对。

## Findings
- F-06 — resolved; severity: non_blocking; anchor: `CostSettings.tsx::localRow` 及 allowance.count 输入。四处删除语义正确，明确 0 保留；已有字段不变。
- F-08 — active; severity: blocking; priority: P1; anchor: `src/core/cost-budget.ts::loadLedger`。局部 broken 箭头函数的 never 返回没有让现有控制流正确收窄，产生 9 处类型诊断。需通过明确类型的校验辅助函数或可收窄控制流解决，保留严格运行时检查；禁止 any/ts-ignore 或关闭 strict。该问题来自此前核心修复，本轮 UI 改动未引入；此前限定运行测试未覆盖类型检查。
- F-09 — active; severity: blocking; priority: P2; anchor: `test/ui/settings-cost.test.tsx::清空可选字段在保存请求里真正移除`。新增账户 channel='claude' 不是 roster 支持的 Vendor，真实 checkCostSettings 会拒绝；UI 替身直接回传掩盖非法夹具。改用支持的通道并让该夹具通过真实 checkCostSettings；顺便覆盖 concurrent 清空后保存，再明确填 0 保存的两个状态。
- F-01/F-03/F-04 — resolved，维持结论。
- F-02/F-05/F-07 — active，维持既有定义与修复要求。

## 架构与范围结论
- F-06 实现切片通过；新增测试夹具需纠正，整体类型检查失败，任务不得集成。
- 未提交或推送，整体通过后的用户授权保留。

## 优先级复核
- 已复核，无调整。TASK-018 保持 P1 / High，其他相关未完成任务优先级不变。

## 下一状态
- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-018/attempt-06.md`
- active_findings_for_next_attempt: `F-08,F-09`
- remaining_findings: `F-02,F-05,F-07` 后续单独处理。
