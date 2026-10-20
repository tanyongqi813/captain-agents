# Review Record — TASK-018 / attempt-01

- task_id: `TASK-018`
- attempt: `01`
- capsule: `legacy-task-spec-only`
- reviewed_at: `2026-10-20`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围
- implementation_report: `.worktrees/task-018/docs/tasks/TASK-018.md` 实施报告。
- diff_scope: `.worktrees/task-018` 相对 ff57992 的 TASK-018 未提交改动（含新增文件）。没有合并或修改实现。
- acceptance_slice: 账户级限额、预占与收尾、设置保存、界面输入；窗口截图与最终集成验收未完成。

## 验证证据
- `npm run typecheck` → PASS。
- `node --test --test-timeout=120000 test/cost-budget.test.ts test/cost-settings.test.ts test/desktop.test.ts` → PASS，60 项。
- `npm run test:ui -- test/ui/settings-cost.test.tsx test/ui/bridge.test.tsx` → PASS，7 项。
- 临时独立 XAGENTS_HOME 核心/桥探针 → 确认 F-01 至 F-05，未访问真实账户：60 分钟限额得到两个 60 分钟 claim；两次回滚把仍有一次预占的 attempts 减为 0；重复任务预占回滚后 slots 为 0；终态任务续跑预占被下一次 gate 回收；空结构账本与无任何上限的 local 仍放行；旧草稿保存覆盖已更新的账户名称。
- 全量测试、build、真实窗口冒烟、截图 → NOT_RUN；已发现阻塞缺陷，留待修复后的最终验收。实施报告中的 build PASS 未在本轮重跑。
- 新版 handoff 结构校验 → FAIL：旧 Task Spec 缺少新版英文元数据及规定标题，校验器还强制整体任务难度与微批难度一致。本轮保持旧规格兼容，手工核对下一胶囊为两个文件、一个定向命令；不声称新版结构校验已通过。

## Findings
- `F-01` — active; severity: blocking; priority: P1; anchor: `src/core/cost-budget.ts::costGate`（134–143 行）。剩余时长仅减已结算的 day.seconds，不扣运行中任务的预占。每日 3600 秒、并发 2 时，两件任务各获 60 分钟，合计可耗 120 分钟。需要原子预占可执行时长并可靠结算/归还，补覆盖并发时长分配测试。
- `F-02` — active; severity: blocking; priority: P1; anchor: `src/core/cost-budget.ts::reapSlots/releaseAttempt/recordSeconds`、`src/core/wake.ts::resumeMember`。预占只以 jobId 标识，续跑在任务锁前预占，此时旧任务仍是终态，其他 gate 可误回收新预占；重复叫醒回滚按 jobId 删除所有占位；releaseAttempt 重复调用会再次减次数。需要每次尝试独立身份及所有权、幂等释放，避免旧终态、重复请求或旧轮收尾影响新轮。
- `F-03` — active; severity: blocking; priority: P1; anchor: `src/core/cost-budget.ts::loadLedger`（34–58 行）。非 ENOENT 的读取错误以及非法结构被当作空账本，后续保存会覆盖预算历史并重新放行。仅首次不存在可初始化；损坏、读取失败或不支持的版本必须明确拒绝，保留原文件。
- `F-04` — active; severity: blocking; priority: P1; anchor: `src/core/cost-budget.ts::usable/costGate`（109–120 行）。只有 recordedAt、没有任何上限的 local 被认作可用预算，额度未知仍能启动，违背不得默认无限的契约。未知额度必须至少具有一个有效有限上限；明确 0 是禁止使用，不能当未设置。保留已知额度的既有策略。
- `F-05` — active; severity: blocking; priority: P2; anchor: `app/main/cost-settings.ts::save`（21–26 行）。文件锁只串行整份替换，无法检测旧草稿。两个窗口读同版本，A 改名称保存，B 改经验保存后 A 的名称被还原。应加入锁内版本检查或等效冲突保护，并提示刷新/重试。
- `F-06` — active; severity: blocking; priority: P2; anchor: `app/renderer/components/CostSettings.tsx::localRow`（145–149 行）。清空每日尝试数、同时运行数、时区时仍展开包含旧字段的 base，空值分支没有删除旧字段，输入无法清空。次数套餐 allowance.count 同样存在。需要删除对应属性并覆盖清空后保存的界面测试。
- `F-07` — active; severity: blocking; priority: P2; anchor: `src/core/dispatch.ts::dispatch`（120–136 行）。costGate 成功后 createJob/worktreePath 失败，本次 claim 尚未加入 jobs；catch 只回滚 jobs，遗漏当前预占，最多留住并发位 48 小时。需独立跟踪每个已成功预占并覆盖登记失败注入测试。

## 架构与范围结论
- alignment: 专用桥、核心共用预算门及界面三种来源区分方向正确；限额可靠性与并发保存尚不满足验收。
- scope: 原任务跨层较大，后续按发现拆成独立纠偏，不重做已完成界面与接线。
- preserved_behavior: 既有额度触顶拒绝、策略与隔离不得放宽；不新增依赖。
- remaining_acceptance: 修复全部 active findings 后，仍需复核失联/重启记账、跨日时长归属、时区留存、窗口截图及完整 verify；本轮未宣称这些已通过。

## 优先级复核
- TASK-018 P2 → P1：预算边界可被正常并发流程突破，需在集成前修复。
- TASK-015/016/020–023 已复核，无调整。

## 下一状态
- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-018/attempt-02.md`
- active_findings_for_next_attempt: `F-03,F-04`
- sequencing: 下一轮只修 F-03/F-04；F-01/F-02/F-05/F-06/F-07 保持 active，后续分别生成胶囊，不因局部通过关闭整个 TASK。
