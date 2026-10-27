# Review Record — TASK-041 / attempt-03

- handoff_contract: `1`
- task_id: `TASK-041`
- attempt: `03`
- capsule: `docs/execution/TASK-041/attempt-03.md`
- reviewed_at: `2026-10-27`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围
- implementation_report: 本轮 F-01/F-02 修正增量，及独立提交边界核对。
- diff_scope: Autopilot 启动筛选、UI 测试与标准 e2e 脚本。
- acceptance_slice: 动态身份修正已接受；标准入口还必须补齐旧夹具，不能混入其他未提交代码冒充独立通过。

## 验证证据
- 工作区 UI → PASS，15/15；核心桥 → PASS，8/8；四工程 typecheck / build → PASS。
- 静态范围核对 → PASS：HEAD 的 smoke 仍使用六列台账且没有 Capsule；工作区已有夹具升级增量，但不在 attempt-03 白名单，按停止条件不擅自提交。
- 工作区标准 e2e 已启动，仅作集成证据；独立候选标准 e2e 须在后续补齐夹具后验收。

## Findings
- `F-01` — `resolved`; severity: `blocking`; anchor: `app/renderer/components/Autopilot.tsx::trusted`; 优先用后台 channel + kept 事实，动态受信模型可选，伪装前缀的非受信模型不放行，目录变化使旧选择失效。
- `F-02` — `active`; severity: `blocking`; anchor: `package.json / test/e2e/smoke.ts`; 新入口接入已实现，还需按共享契约迁移旧冒烟夹具，才能证明标准验收独立通过。

## 架构与范围结论
- alignment: 不放宽主进程或核心信任。
- scope: 原修正三文件不扩展；追加 attempt-04 只处理入口与一份既有测试夹具。
- preserved_behavior: 动态筛选及原模式切换实现保持，不重发整份任务。

## 优先级复核
- 已复核，无调整；041 仍 P1 / High，042 待前置完成。

## 下一状态
- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-041/attempt-04.md`
- active_findings_for_next_attempt: `F-02`
