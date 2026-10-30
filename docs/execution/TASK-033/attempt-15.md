# Execution Capsule — TASK-033 / attempt-15
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `15`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
补显式本地新组创建草稿入口，不需手工改配置文件。
## 本轮验收切片
- 统一input/Button提供新预算组名，仅用户点击创建，合法名字/32上限/重复default等复用Endpoint验证拒绝。
- 创建不立即写盘；新组从关闭预算/零价的缺省配置独立复制，不复制旧账/默认价格，不自动授权；自动选中草稿供编辑，保存才生效，取消不写。
- 原组/default保留，创建后可编辑预算/价格；保存关闭非默认组合法但派发仍拒绝直到显式启用并填价。
## 已确认事实（禁止重新推导）
- 12–14已配置组选择/编辑/派发/窗口已过，新组尚需手工配置，是剩余真实入口缺口。
- deepseekEndpoint校验组名/上限/全部配置；withMoney路由已过，复用不改核心。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `app/renderer/components/DeepseekSettings.tsx` — 组Select/withMoney/submit。
2. `src/core/deepseek-settings.ts` — 组名/32上限解析。
3. `test/ui/deepseek-active-group.test.tsx` — 组编辑夹具。
## 修改白名单
- `app/renderer/components/DeepseekSettings.tsx`
- `test/ui/deepseek-active-group.test.tsx`
- `docs/ui-spec.md`
- max_modified_files: `3`
## 明确非目标
- 不组删除/改名/账户探测、不写账本、不改派发/runner、创建不自动启用收费。
## 定向验证（最多 5 条）
1. `npx vitest run test/ui/deepseek-active-group.test.tsx`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不旧核心/金额/UI全量/build/e2e，后续最新窗口另合同。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `8`
- soft_call_limit: `8`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 超范围、并发或一次纠偏仍失败保存检查点。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 新组草稿
- remaining_gaps: 视觉/整项
- anchors_touched: createGroup
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界
