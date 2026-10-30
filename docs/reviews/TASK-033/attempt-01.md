# Review Record — TASK-033 / attempt-01

- task_id: `TASK-033`
- handoff_contract: `1`
- attempt: `01`
- capsule: `legacy-task-spec-only`
- reviewed_at: `2026-10-27`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围

- implementation_report: docs/implementation/2026-10-26-first-usable.md；直接开发未生成历史 Capsule，本记录不追造执行合同。
- diff_scope: src/core/money-budget.ts、src/core/deepseek-settings.ts、test/deepseek-settings.test.ts、test/money-budget-runner.test.ts。
- acceptance_slice: 账本损坏时停止收费调用；本记录不是任务整体完成验收。

## 验证证据

- `node --test --test-timeout=120000 test/deepseek-settings.test.ts test/money-budget-runner.test.ts test/deepseek-credentials.test.ts` → PASS，21/21。
- `npm run typecheck` → PASS，四工程。
- `npm run test:ui -- test/ui/deepseek-money.test.tsx test/ui/settings-cost.test.tsx` → PASS，仅实际存在的费用 UI 文件 2/2；主仓不存在 settings-cost 文件，不能计作该项通过。
- 临时 XAGENTS_HOME 离线复现 → FAIL：先结算 1 元，将 money-budget/deepseek.json 截为零字节，readMoneyStatus 返回 spent=0，reserveMoney 随后成功写新预留。未碰真实账户。
- 全量 verify、构建、桌面端到端、真实中转站 → NOT_RUN。

## Findings

- `F-01` — `active`; severity: `blocking`; anchor: `src/core/money-budget.ts::load`; readOptional 将 ENOENT 和零字节都返回空串，load 因此将损坏账本当新安装，后续预留覆盖历史。只允许确实不存在时初始化；已存在的空白、坏 JSON、错误根结构必须拒绝并保持原文。补零字节、空白、数组根结构与未安装缺文件回归。

## 架构与范围结论

- alignment: 原子写与锁方向正确，但不能以空内容代表不存在，预算安全尚未闭环。
- scope: 仅审查，不修实现；多账户组、缓存写入、跨日未知归属等完整需求仍未验收，不得凭本修复标整项通过。
- preserved_behavior: 已通过金额公式、幂等、保守预留、收尾保存报告逻辑保持。

## 优先级复核

- 已复核，无调整。TASK-033 保持 P1 / High；本缺陷在任何收费试用前修复，优先于扩展无人看守。

## 下一状态

- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-033/attempt-02.md`
- active_findings_for_next_attempt: `F-01`
