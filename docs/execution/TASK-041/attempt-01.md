# Execution Capsule — TASK-041 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-041.md`
- task_id: `TASK-041`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
把已有负责人流程显式接入桌面启动弹窗，保留旧模式，不越过未提交制品暂停边界。

## 本轮验收切片
默认关闭；切换清空负责人及权限/联网确认；仅受信独立负责人可提交；严格 IPC 校验；离线窗口可启动新版本记录并停止。

## 已确认事实（禁止重新推导）
- TASK-027 的 leadReview 开关、受信校验及原子运行记录已通过并同步。
- 原桥仅接受七个必填字段，旧窗口不得被迫升级。
- 桌面统一部件与名单模块可复用；截图在 output/playwright。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/shared/ipc.ts` — AutopilotInput。
2. `app/main/autopilot-bridge.ts` — autopilotActions.start。
3. `app/renderer/components/Autopilot.tsx` — AutopilotStartDialog。
4. `src/core/lead-runtime.ts` — trustedLead（只复用，不修改）。
5. `test/autopilot-desktop.test.ts` — 桥接真实核心夹具。

## 修改白名单
- `app/shared/ipc.ts`
- `app/main/autopilot-bridge.ts`
- `app/renderer/components/Autopilot.tsx`
- `test/autopilot-desktop.test.ts`
- `test/ui/autopilot.test.tsx`
- `test/e2e/lead-review.ts`
- `docs/ui-spec.md`
- max_modified_files: `7`

## 明确非目标
不改运行状态机、选手启动参数、费用逻辑、自动提交或恢复接口，不安装或发布应用，不读真实密钥。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/autopilot-desktop.test.ts`
2. `npx vitest run test/ui/autopilot.test.tsx`
3. `npm run typecheck`
4. `npm run build && node --test --test-timeout=120000 test/e2e/lead-review.ts`
5. `git diff --check`

## 禁止验证
不跑全量核心/UI/e2e；不联网调用模型，不读取真实账户；所有真实窗口测试使用临时登记与假选手。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `60`
- soft_call_limit: `35`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
需要改变权限、Git 起点或收费边界时停止；窗口不能运行时保留未验收状态，不冒充截图已通过。

## 精简 Implementation Report（固定格式）
- outcome: completed | partial | blocked
- handoff: none | checkpoint
- stop_reason: none | scope_conflict | permission
- workspace_branch: 绝对路径与分支
- changed_files: 文件路径
- completed_scope: 已实现结果
- remaining_gaps: 剩余验收
- anchors_touched: 符号
- verification: 命令与结果；latest_code_covered: yes/no
- active_findings: none
- scope_or_baseline_notes: 新事实
