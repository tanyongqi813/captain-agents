# Execution Capsule — TASK-033 / attempt-12
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `12`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
已配置预算组的显式活动选择、费用编辑/显示与派发原子接线。

## 本轮验收切片
- Endpoint可选budgetGroup，缺省default，非法/缺组拒绝；不按地址推导、不清账；关闭非默认组仍派发前拒绝。
- dispatch无内部覆盖时采用保存组，Job冻结组和该组money/实际ID价格；既有runner冻结组读最新阈值不改。
- 编辑器统一Select选择已配置组，费用修改只写所选组，其他组/default保留；取消不写、换组草稿不沿用另一组价格；显示只使用保存组账本，未保存换组隐藏旧状态。
- buildView按保存组读账，不拿default消费/阈值套新组。暂不新增组创建/删除入口。

## 已确认事实（禁止重新推导）
- 03308–11已过组账本/配置/runner/ID价表，035价表编辑已过；032功能验收齐但正式发布未过。
- 四主要文件settings/dispatch/view/组件是本自动化既有差异，需原子例外以免活动字段被忽略或错账展示。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/deepseek-settings.ts` — Endpoint/组解析。
2. `src/core/dispatch.ts` — moneyGroup。
3. `src/core/view.ts` — moneyBudget。
4. `app/renderer/components/DeepseekSettings.tsx` — money/各setter。
5. `test/deepseek-model-prices.test.ts` — 假派发价冻结参考。
## 修改白名单
- `src/core/deepseek-settings.ts`
- `src/core/dispatch.ts`
- `src/core/view.ts`
- `app/renderer/components/DeepseekSettings.tsx`
- `test/deepseek-budget-groups.test.ts`
- `test/deepseek-active-group.test.ts`
- `test/ui/deepseek-active-group.test.tsx`
- `docs/ui-spec.md`
- max_modified_files: `8`
## 明确非目标
- 不改账本/runner/密钥/启动模板，不新增组创建删除或真实权限。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-active-group.test.ts test/deepseek-budget-groups.test.ts`
2. `npx vitest run test/ui/deepseek-active-group.test.tsx test/ui/deepseek-money.test.tsx test/ui/deepseek-model-prices.test.tsx`
3. `npm run typecheck`
4. `git diff --check`
## 禁止验证
- 不旧账本/看管/031/032全量，不build/e2e；最新视觉另合同，不借旧图。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `18`
- soft_call_limit: `16`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需额外主要文件、并发冲突或一次纠偏仍失败保存partial。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 活动组接线
- remaining_gaps: 新组创建/窗口/整项
- anchors_touched: 符号
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界

