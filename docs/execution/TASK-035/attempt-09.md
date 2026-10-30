# Execution Capsule — TASK-035 / attempt-09

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `09`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
费用编辑器已有实际ID价表时编辑真正生效的价格，不再改无效legacy槽位。

## 本轮验收切片
- 有modelPrices时当前Pro/Flash ID查表展示/修改该项；缺项显示未配置和空白，填写期间其他必填金额未知，不补0，保存前复用核心校验及两当前模型查价。
- cacheWrite空白省略、0保留；非法/不完整拒绝且草稿保持；取消不写。
- 换模型显示新ID已有价或未知，不沿用旧价；保留其他模型项和moneyGroups；同ID双槽位共用同项。无表保持旧编辑行为。

## 已确认事实（禁止重新推导）
- 03311已验证modelPrices与deepseekModelPrice，显式未知派发拒绝；旧无表兼容。
- 本批仅默认money编辑适配，不开放组选择，不冒称组件重挂载是磁盘重启验证。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/renderer/components/DeepseekSettings.tsx` — setField、submit、价格输入。
2. `src/core/deepseek-settings.ts` — deepseekModelPrice，只读。
3. `test/ui/deepseek-money.test.tsx` — legacy编辑回归。
4. `docs/ui-spec.md` — 费用编辑规范。

## 修改白名单
- `app/renderer/components/DeepseekSettings.tsx`
- `test/ui/deepseek-model-prices.test.tsx`
- `docs/ui-spec.md`
- max_modified_files: `3`

## 明确非目标
- 不改核心/派发/runner、组选择、真实网络或提交。

## 定向验证（最多 5 条）
1. `npm run test:ui -- test/ui/deepseek-model-prices.test.tsx test/ui/deepseek-money.test.tsx test/ui/deepseek-catalog-status.test.tsx`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量、核心/build/窗口或真实收费；最新视觉独立后续合同。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 超白名单、来源冲突或一次纠偏仍失败回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 最新窗口/整项验收
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
