# Execution Capsule — TASK-018 / attempt-06

- dispatch_state: `CLOSED`
- handoff_contract: `1`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `06`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `Medium`
- required_planning_lookup: `none`
- capsule_schema: `2`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
修复已确认的类型诊断及 UI 测试非法夹具，保留已通过业务行为。

## 本轮验收切片
- loadLedger 的 unknown 校验能通过类型检查，严格拒绝坏账本的行为不变。
- UI 清空回归使用真实合法成本设置；四个字段可清空并从 payload 删除，明确 0 保留。

## 已确认事实（禁止重新推导）
- 类型检查首阶段有 9 个错误，位于 cost-budget.ts 的 56/69/71/80 行（行号仅提示）。
- F-01/F-03/F-04/F-06 的运行行为已接受，保持不变。
- UI 新测试 channel='claude' 不受 roster 支持；tsconfig 不含 test，运行 Vitest 也不做静态类型检查。

## Active findings
- `F-08`：loadLedger 校验后 unknown 未收窄导致类型检查失败。
- `F-09`：UI 新测试使用非法通道；改用合法通道，校验夹具并补 concurrent 清空后保存的断言。

## 源码锚点（最多 5 个）
1. `src/core/cost-budget.ts` — `loadLedger/broken/num`：使用有明确返回类型的校验函数或能收窄的控制流。
2. `test/ui/settings-cost.test.tsx` — 新增清空回归、`setup`：夹具及保存断言。
3. `src/core/cost-settings.ts` — `checkCostSettings`：只读并在测试校验夹具，不修改。
4. `test/cost-budget.test.ts` — 核心组：只运行验证，不修改。

## 修改白名单
- `src/core/cost-budget.ts`
- `test/ui/settings-cost.test.tsx`
- max_modified_files: `2`

## 明确非目标
- 不动 UI 实现、公共契约、账本布局、dispatch/wake/runner/文档；不扩修 F-02/F-05/F-07。
- 不使用 any、ts-ignore、关闭 strict 或削弱账本校验；不提交、不 push、不 stash。

## 定向验证（最多 5 条）
1. `npm run typecheck` — 四阶段均通过。
2. `node --test --test-timeout=120000 --test-name-pattern='成本预算预占（核心）' test/cost-budget.test.ts` — 保留 20 项核心行为。
3. `npm run test:ui -- test/ui/settings-cost.test.tsx` — 合法夹具、四字段清空及明确 0 均通过。

## 禁止验证
- 不跑全量 npm test、verify、build、e2e，不启动真实选手；已通过且未受后续修改影响的命令不重复。

## 已知基线失败
- 本轮初始 typecheck 的上述 9 项是本轮要修的问题，不作为豁免基线。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `20`
- soft_call_limit: `none`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
- 以上为软约束，不声称运行器已强制停止。

## 停止条件
- 超出白名单、或一次实现加一次纠偏仍未完成：保留改动、返回检查点并停止。

## 精简 Implementation Report（固定格式）
- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | scope_conflict | external_decision`
- workspace_branch: 绝对路径与分支
- changed_files: 路径
- completed_scope: 完成项
- remaining_gaps: 未完成点
- anchors_touched: 函数或测试名
- verification: 命令 → PASS/FAIL/NOT_RUN；latest_code_covered: yes/no
- active_findings: F-08/F-09 → resolved/unresolved
- scope_or_baseline_notes: 新事实；报告不超过 400 字。
