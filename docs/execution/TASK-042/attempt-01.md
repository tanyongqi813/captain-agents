# Execution Capsule — TASK-042 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-042.md`
- task_id: `TASK-042`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
在无人看守详情显示负责人最后决定、脱敏理由和待处理胶囊数量，解释真实暂停事实，不增加写入口。

## 本轮验收切片
五动作固定中文标签；修正/拆分显示制品数量及尚未授权续跑；旧记录/暂无决定/损坏记录不伪造；只读调用无写入且不泄漏路径、令牌、原始胶囊。

## 已确认事实（禁止重新推导）
- TASK-041 已修复并同步，当前运行记录经 assertRun / assertLeadRuntime 验证。
- run.flow.lead.decisions 保存已验证 reply 与 compilation；窗口只需要摘要，不接收原对象。
- 现有 owner_requested 通用文字会掩盖已保存制品事实，须仅在新流程保留准确的脱敏停止说明。
- ViewAutopilot 新字段必须可选，旧 View/记录仍读原审查时间线。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/autopilot-view.ts` — autopilotView / clean。
2. `src/core/view-types.ts` — ViewAutopilot。
3. `app/renderer/components/Autopilot.tsx` — AutopilotDetail。
4. `test/autopilot-desktop.test.ts` — world / 只读摘要夹具。
5. `test/e2e/lead-review.ts` — 临时应用与截图。

## 修改白名单
- `src/core/autopilot-view.ts`
- `src/core/view-types.ts`
- `app/renderer/components/Autopilot.tsx`
- `test/autopilot-desktop.test.ts`
- `test/ui/autopilot.test.tsx`
- `test/e2e/lead-review.ts`
- `docs/ui-spec.md`
- max_modified_files: `7`

## 明确非目标
不改运行协议、负责人决定、任务状态、权限、预算、通知发送或恢复；不导出全文、写仓库、提交/采用成果或自动续跑。历史费用与界面改动不纳入提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/autopilot-desktop.test.ts`
2. `npx vitest run test/ui/autopilot.test.tsx`
3. `npm run typecheck`
4. `npm run build && npm run test:e2e` — 隔离真实窗口与浅/深/窄截图。
5. `git diff --check`

## 禁止验证
不跑全量核心/UI，不调用真实模型或账户；不直接读取真实登记；不把缺少或损坏记录显示为通过。

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
需要新增命令、路径、导出或写入口时停止；若摘要读不出权威事实，不得猜测。

## 精简 Implementation Report（固定格式）
- outcome: completed | partial | blocked
- handoff: none | checkpoint
- stop_reason: none | scope_conflict
- workspace_branch: 绝对路径与分支
- changed_files: 文件路径
- completed_scope: 已实现
- remaining_gaps: 剩余项
- anchors_touched: 符号
- verification: 命令与结果；latest_code_covered: yes/no
- active_findings: none
- scope_or_baseline_notes: 新事实
