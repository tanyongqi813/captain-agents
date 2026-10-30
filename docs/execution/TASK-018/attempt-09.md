# Execution Capsule — TASK-018 / attempt-09

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `09`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
修复 F-05：旧窗口草稿不能覆盖其他窗口刚保存的成本资料。

## 本轮验收切片
- costSave 必须同时提交整份新设置和当时读取的基线；缺基线、非法参数拒绝。
- 核心锁内读取、比较规范化基线、写入；并发不同修改恰好一个成功，另一个明确提示关闭重开读取，失败不写。
- 保存返回本次写入快照，不在解锁后重读冒充本次结果；界面失败保留草稿和原基线，不静默刷新或合并。

## 已确认事实（禁止重新推导）
- updateCostSettings 已有锁内读改写；桥当前整份替换且只收一个参数，锁本身不能发现旧草稿。
- F-02 及其他已过切片保持；四个主要实现文件为不可分割保存协议迁移。

## Active findings
- `F-05`：旧草稿覆盖新配置。

## 源码锚点（最多 5 个）
1. `src/core/cost-settings.ts` — updateCostSettings、checkCostSettings。
2. `app/main/cost-settings.ts` — snapshot、save。
3. `app/shared/ipc.ts` — XaBridge.costSave。
4. `app/renderer/components/CostSettings.tsx` — save。
5. `test/desktop.test.ts` — 成本资料桥。

## 修改白名单
- `src/core/cost-settings.ts`
- `app/main/cost-settings.ts`
- `app/shared/ipc.ts`
- `app/renderer/components/CostSettings.tsx`
- `test/desktop.test.ts`
- `test/ui/settings-cost.test.tsx`
- `docs/ui-spec.md`
- max_modified_files: `7`

## 明确非目标
- 不改预算记账、选手启动、网络、密钥和其他页面；不覆盖主仓源文件。
- 仅保存协议修复，不自动合并草稿、不新增依赖；未审历史差异不提交。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/cost-settings.test.ts test/desktop.test.ts`
2. `npm run test:ui -- test/ui/settings-cost.test.tsx`
3. `npm run typecheck`
4. `git diff --check`

## 禁止验证
- 本切片不跑全量/build/e2e/真实调用；截图与完整集成另作整任务收口验收，未跑不得标整体通过。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `18`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 来源不明的同文件修改、超白名单或需新授权即停；一次纠偏后仍失败保留检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径及分支
- changed_files: 路径
- completed_scope: 可观察结果
- remaining_gaps: 剩余验收
- anchors_touched: 符号
- verification: 命令结果及 latest_code_covered
- active_findings: F-05 resolved/unresolved
- scope_or_baseline_notes: 新事实
