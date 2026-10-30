# Execution Capsule — TASK-035 / attempt-11
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `11`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
修复全局模型ID改变后未选中legacy预算组仍借旧槽位价格的035真实缺口。
## 本轮验收切片
- DeepseekMoney可选legacyModels {pro,flash}严格合法ID/深复制。无表旧配置兼容；有modelPrices继续优先精确ID；legacyModels存在时槽位价必须匹配实际模型否则注册前拒绝。
- 编辑全局Pro/Flash ID变化时，为所有尚无价表/无绑定legacy配置绑定变化前的两槽位ID，不删除原价、不改旧账/已冻结任务；已有绑定不重贴标签，实际ID表不变。
- 当前ID与槽位绑定不符显示未知/空白，不补0；只有主人编辑该槽位价格才绑定当前实际ID。启用保存总是核对两款实际ID价格。取消不写。
- 未选中旧组切回后不得借价；填新价可保存，其他组价/旧绑定保留；非法绑定拒绝。
## 已确认事实（禁止重新推导）
- 03312组路由只清当前legacy槽位，全局模型却共享，inactive legacy组会沿用旧价；现dispatch已统一调用deepseekModelPrice，可同批生效，无需改runner。
- 10/03314–16已有窗口证据，不借其图证明本次新未知状态。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/deepseek-settings.ts` — DeepseekMoney/deepseekMoney/deepseekModelPrice。
2. `app/renderer/components/DeepseekSettings.tsx` — setField/priceFor/priceField/submit。
3. `test/ui/deepseek-money.test.tsx` — legacy换模型。
4. `test/ui/deepseek-model-prices.test.tsx` — ID价表。
## 修改白名单
- `src/core/deepseek-settings.ts`
- `app/renderer/components/DeepseekSettings.tsx`
- `test/deepseek-legacy-price-binding.test.ts`
- `test/ui/deepseek-money.test.tsx`
- `test/ui/deepseek-model-prices.test.tsx`
- `docs/ui-spec.md`
- max_modified_files: `6`
## 明确非目标
- 不改账本/已运行价/组归属/runner/权限，不按价格猜模型，不重写实际ID表。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-legacy-price-binding.test.ts test/deepseek-model-prices.test.ts`
2. `npx vitest run test/ui/deepseek-money.test.tsx test/ui/deepseek-model-prices.test.tsx test/ui/deepseek-active-group.test.tsx`
3. `npm run typecheck`
4. `git diff --check`
## 禁止验证
- 不全量/旧看管/031/032/build/e2e；新视觉另合同。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `12`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需额外实现文件/并发或一次纠偏仍失败交回。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: legacy绑定
- remaining_gaps: 窗口/任务验收
- anchors_touched: price/setField
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界

