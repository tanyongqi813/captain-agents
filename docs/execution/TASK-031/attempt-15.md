# Execution Capsule — TASK-031 / attempt-15

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `15`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
在DeepSeek编辑弹窗提供显式自动目录授权草稿，保存才调用专门桥。

## 本轮验收切片
- 默认读取状态，不修改；仅已保存且未改地址/协议/密钥的身份可开关，缺binding或读取失败不猜授权。
- 开关改动保存后才写，取消不写；新连接/密钥先保存再重开确认，不能普通保存隐式开启；授权失败明确连接已保存但授权未更新。
- 先ui-spec后组件，统一Switch；本批组件替身，真实窗口后续验收。

## 已确认事实（禁止重新推导）
- 13专门IPC3/3、14夹具及types已过；setter开启需64位binding，关闭不带binding。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/renderer/components/DeepseekSettings.tsx` — submit及sameConnection。
2. `app/shared/ipc.ts` — 专门授权桥，只读。

## 修改白名单
- `docs/ui-spec.md`
- `app/renderer/components/DeepseekSettings.tsx`
- `test/ui/deepseek-catalog-consent.test.tsx`
- max_modified_files: `3`

## 明确非目标
- 不改核心/IPC，不联网，不冒称窗口截图通过。

## 定向验证（最多 5 条）
1. `npm run test:ui -- test/ui/deepseek-catalog-consent.test.tsx test/ui/deepseek-catalog-status.test.tsx`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量/build/e2e/真实请求或重复旧核心测试。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `10`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 越白名单或一次纠偏仍失败回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 编辑开关
- remaining_gaps: 窗口集成
- anchors_touched: submit
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
