# Execution Capsule — TASK-035 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
DeepSeek 编辑窗口补齐可选缓存写入单价，保持空值与 0 的区别及模型价格隔离。

## 本轮验收切片
- Pro/Flash 单独编辑 cacheWrite，空白省略字段，0 保留；非法价保存前拒绝，不破坏草稿。
- 保存后用校验结果重开可回显；取消不生效，换模型清除原模型全部价格含写入价。
- 说明留空按输入价计、独立价需要通道提供写入量，不编用量。

## 已确认事实（禁止重新推导）
- TASK-033 attempt-05 已验证核心可选字段、校验、冻结、计价，本轮不重写。
- 现有组件仅渲染 input/cached/output；换模型替换整个价格对象已能清除 cacheWrite。
- 当前组件历史变化可追溯031/035，保留；TASK035整体依赖仍未通过，仅独立离线切片。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/renderer/components/DeepseekSettings.tsx` — submit、模型价格输入。
2. `src/core/deepseek-settings.ts` — deepseekMoney，仅使用不修改。
3. `test/ui/deepseek-money.test.tsx` — 编辑保存替身。

## 修改白名单
- `app/renderer/components/DeepseekSettings.tsx`
- `test/ui/deepseek-money.test.tsx`
- `docs/ui-spec.md`
- max_modified_files: `3`

## 明确非目标
- 不改金额核心、IPC、凭据、真实联网、自动刷新、其他任务在途实现，不提交历史差异。

## 定向验证（最多 5 条）
1. `npm run test:ui -- test/ui/deepseek-money.test.tsx test/ui/deepseek-catalog-status.test.tsx`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重跑已过金额核心/全量/build/e2e，不调用真实选手/密钥/网络；窗口截图另做负责人验收，不冒称整项通过。

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
- 超白名单、来源不明并发或初始加一次纠偏仍失败，保留检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 可观察结果
- remaining_gaps: 未完成项
- anchors_touched: 符号
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
