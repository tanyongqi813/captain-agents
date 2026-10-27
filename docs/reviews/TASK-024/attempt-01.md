# Review Record — TASK-024 / attempt-01

- handoff_contract: `1`
- task_id: `TASK-024`
- attempt: `01`
- capsule: `docs/execution/TASK-024/attempt-01.md`
- reviewed_at: `2026-10-21`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围

- implementation_report: 用户提供的 TASK-024 / attempt-01 精简实施报告。
- diff_scope: `src/core/task-plan.ts`、`src/core/plan-migrate.ts`、`src/cli/cli.ts`、`test/task-plan.test.ts`、`test/plan-migrate.test.ts` 的未提交改动。
- acceptance_slice: 契约 1 与旧中文格式统一解析、doctor/migrate/verify 共核、迁移拒绝边界及当前工作台规划识别。

## 验证证据

- `node --test --test-timeout=120000 test/task-plan.test.ts test/plan-migrate.test.ts` → PASS：39/39，覆盖最新代码。
- `npm run typecheck` → PASS：四个 TypeScript 工程。
- 直接调用当前 `readTaskPlan` → FAIL：虽识别 `TASK-024` 为 READY，但把 `TASK-025/026` 正常等待前置任务记为 error，规划页仍会显示报错。
- 构造 `dependencies: TASK-001[READY]` → FAIL：机器诊断只给 `DEPENDENCY_UNSATISFIED/info`，没有拒绝契约禁止的 accepted state。

## Findings

- `F-01` — `active`; severity: `blocking`; anchor: `src/core/task-plan.ts::readTaskPlan`; 非 READY 的未来任务依赖尚未满足是正常队列状态，不应进入界面错误诊断。保留未知依赖、循环依赖和格式错误的阻断；补 DRAFT 等待依赖不报 error、READY 仍阻断的回归。
- `F-02` — `active`; severity: `blocking`; anchor: `src/core/task-plan.ts::parseDependencies`; 契约依赖括号内只允许 `PASSED` 与 `PASSED_WITH_NOTES`，当前任意大写词都会被接受。非法、空项或重复终态必须产生稳定的 `DEPENDENCY_UNPARSEABLE` 并阻止迁移/派发，补机器诊断与迁移拒绝回归。

## 架构与范围结论

- alignment: 共用解析核心、CLI 路由、迁移对账和 Capsule/Review 交叉引用方向正确；两项边界修正后可复审。
- scope: 首轮五个文件均在 Capsule 白名单内；未发现实现文件越界。
- preserved_behavior: 保留新旧格式兼容、现有安全路径检查、迁移 dry-run/apply 行为及已通过验证。

## 优先级复核

- 已复核，无调整。TASK-024 保持 P1 / High；TASK-025、TASK-026 的顺序与优先级不变。

## 下一状态

- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-024/attempt-02.md`
- active_findings_for_next_attempt: `F-01,F-02`
