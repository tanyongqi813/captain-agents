# Review Record — TASK-041 / attempt-02

- handoff_contract: `1`
- task_id: `TASK-041`
- attempt: `02`
- capsule: `docs/execution/TASK-041/attempt-02.md`
- reviewed_at: `2026-10-27`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围
- implementation_report: 用户要求复审上一批开发结果。
- diff_scope: c521d9e6b069a6741bddf479acd75c14f3cfef47 的桌面入口、桥、测试和验收接线；依赖处只读核对。
- acceptance_slice: 动态负责人兼容与新增窗口回归接入；不扩大为收费或整体产品发布审查。
- historical_record: attempt-01 原通过结论保留。本轮独立诊断发现当时用例未覆盖的缺陷，以本轮状态为准。

## 验证证据
- 隔离 HEAD 副本追加 UI 诊断 `npx vitest run test/ui/lead-review-audit.test.tsx` → FAIL，1/1；旧模式可见动态候选，勾新模式后候选为 null。夹具同时提供 View.models 中真实通道映射及 pool 中相同 who，不是在主仓库修改实现。
- 受信诊断 → PASS（诊断执行正常）：specFor 生成合法新增编号 codex-6-review-probe；窗口冷 roster 的 isWho 为 false；主进程 loadRoster 后 vendor 为 codex、trustedLead 为 true，证实两侧名单不一致。
- 静态发现链核对 → PASS（核对完成）：HEAD 的 test:e2e 只执行 smoke.ts，verify 仅调用该脚本；新增 lead-review.ts 没有被标准入口发现。工作区增加其他用例的未提交脚本也仍未包含 lead-review.ts。
- 既有核心/UI/窗口通过结果沿用 attempt-01，不冒充本轮重新执行；没有为未变化代码重复全套通过测试。
- 真实模型、全量测试、构建、安装、提交和 push → NOT_RUN。

## Findings
- `F-01` — `active`; severity: `blocking`; priority: P2; anchor: `app/renderer/components/Autopilot.tsx::trusted`; 前端仅识别静态 roster，管理模型中新保留的受信模型即使后台允许且已在候选池里，也会被隐藏；当只剩这类负责人时错误显示“没有独立且受信的负责人”。应消费后台当前通道事实并覆盖动态模型用例，不能按 who 前缀放宽信任。
- `F-02` — `active`; severity: `blocking`; priority: P2; anchor: `test/e2e/lead-review.ts / package.json::scripts.test:e2e`; 新窗口用例只在本轮被单独运行，标准 verify 不会执行，后续入口回归会静默漏检。必须接入标准脚本并保留既有用例。

## 架构与范围结论
- alignment: 主进程最终校验未发现本批引入的权限放宽；问题是前端错误过滤与持续验收缺口。
- scope: 仅新增复审记录、审计合同及 3 文件增量修正合同；不实现修正，不改历史记录。
- preserved_behavior: 既有新模式 opt-in、确认清空、不同角色、只读审查、暂停与 Git 起点边界保持。

## 优先级复核
- 已复核，无调整。TASK-041 维持 P1 / High，先修复再做 TASK-042；TASK-042 保持 DRAFT，不推进下游。

## 下一状态
- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-041/attempt-03.md`
- active_findings_for_next_attempt: `F-01,F-02`
