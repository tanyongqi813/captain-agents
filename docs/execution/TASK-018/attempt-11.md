# Execution Capsule — TASK-018 / attempt-11

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `11`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
修正完整离线验收暴露的两项 TASK-018 集成测试问题，不改变已通过的生产实现。

## 本轮验收切片
- F-10：显式类型检查准确识别 TypeScript any 类型，而非 HTML step 属性或注释；新增正反例，不放行实际 any 类型。
- F-11：已有设置页分页断言纳入产品已添加的成本资料页，其他顺序与厂家策略断言不变。

## 已确认事实（禁止重新推导）
- 完整 UI 为 343/345，两处失败仅缺“成本资料”分页预期；设置保存新测试通过。
- 架构测试以词法匹配误拒绝合法 HTML step="any"，生产源码未引入 any 类型。
- 完整构建已 PASS，仅既有混合导入告警，生产代码不改无需重建。
- attempt-10 为零源码修改的验证合同，现有结构校验器拒绝空白名单，历史保留 FAIL，不倒改已执行合同。

## Active findings
- `F-10`：架构检查把 HTML 属性值误作显式 any 类型。
- `F-11`：分页测试未纳入成本资料入口。

## 源码锚点（最多 5 个）
1. `test/architecture.test.ts` — 应用和核心源代码不使用显式 any。
2. `test/ui/settings-workers.test.tsx` — 两项设置分页精确断言。

## 修改白名单
- `test/architecture.test.ts`
- `test/ui/settings-workers.test.tsx`
- max_modified_files: `2`

## 明确非目标
- 不改生产源码、设置布局、预算规则和其他测试；不以删断言或编码隐藏 HTML 属性规避检查。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/architecture.test.ts`
2. `npm run test:ui -- test/ui/settings-workers.test.tsx`
3. `git diff --check`

## 禁止验证
- 不重跑完整核心/UI/build/typecheck；只补最新失败文件，已有通过证据保持有效。
- 不运行窗口、真实模型/密钥/网络。

## 已知基线失败
- 仅上述三条已确认失败，其他完整核心结果仍待本轮收尾。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `5`
- soft_call_limit: `8`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 发现其他失败或需生产代码修改则记录交回，不扩范围、不再次纠偏。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 测试纠偏
- remaining_gaps: 最终验收
- anchors_touched: 测试名称
- verification: 结果及 latest_code_covered
- active_findings: F-10/F-11 resolved/unresolved
- scope_or_baseline_notes: 新事实
