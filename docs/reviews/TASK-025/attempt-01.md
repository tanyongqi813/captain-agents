# Review Record — TASK-025 / attempt-01

- handoff_contract: `1`
- task_id: `TASK-025`
- attempt: `01`
- capsule: `docs/execution/TASK-025/attempt-01.md`
- reviewed_at: `2026-10-21`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围

- implementation_report: 用户提供的 TASK-025 / attempt-01 精简 Implementation Report。
- diff_scope: `src/core/task-plan.ts`、`src/core/plan-dispatch.ts`、`src/core/dispatch.ts`、`test/task-plan.test.ts`、`test/plan-dispatch.test.ts` 的未提交改动。
- acceptance_slice: Capsule 派发资格、正文隔离、Git 起点一致性与 DeepSeek/Kimi 外层适配。

## 验证证据

- `node --test --test-timeout=120000 test/task-plan.test.ts test/plan-dispatch.test.ts` → PASS：45/45，覆盖最新代码。
- `npm run typecheck` → PASS：四个 TypeScript 工程。
- `git diff --check` → PASS。
- 静态复核 `src/core/dispatch.ts::assertCapsuleInStart` → FAIL：只核对起点中的 Capsule 路径与指纹，没有核对 Capsule“源码锚点”列出的文件是否也存在于同一起点。

## Findings

- `F-01` — `active`; severity: `blocking`; anchor: `src/core/dispatch.ts::assertCapsuleInStart`; TASK-025 验收标准 5 要求派活起点同时包含当前 Capsule 与其源码锚点。当前实现仅验证 Capsule；当默认分支已包含规划文档、但尚未包含任务所依赖的源码文件时仍会开副本，执行者会拿到无法落地的锚点。应从 Capsule 的“源码锚点”章节安全、限量地读取仓库相对文件路径，并在注册任务、创建副本、启动选手之前逐一验证所选 base 含这些路径；路径缺失或无法无歧义解析时拒绝，并给出 base 与工作区 HEAD 短提交号。补齐成功、缺失和非法路径回归。

## 架构与范围结论

- alignment: Capsule 资格、原文投递、正文隔离、指纹核对和模型外层适配方向正确，现有定向验证全部通过。
- scope: 五个改动文件均在 Capsule 白名单内；未发现实现文件越界。
- preserved_behavior: 保留既有公共规则、额度、隔离、并发与 DeepSeek/Kimi 节流层。

## 优先级复核

- 已复核，无调整。TASK-025 保持 P1 / High；修正通过前不提升 TASK-026。

## 下一状态

- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-025/attempt-02.md`
- active_findings_for_next_attempt: `F-01`
