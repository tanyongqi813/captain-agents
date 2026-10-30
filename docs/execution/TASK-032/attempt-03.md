# Execution Capsule — TASK-032 / attempt-03

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-032.md`
- task_id: `TASK-032`
- attempt: `03`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
编辑弹窗显式确认当前连接/实际模型高档能力，不把目录当能力。

## 本轮验收切片
- 先规范，后统一Switch和Select；新配置default，旧缺模式/high保留可见并警告未确认不能派活；未确认不能从default新选high。
- 用户主动开关才生成user来源/ISO时间，取消不保存，保存普通草稿不生成确认。规范化地址/协议/模型变化不借旧声明，匹配同连接保留其他模型；明确确认新连接会替换旧连接声明，不冒充迁移。
- 只读显示来源/时间；不改核心/启动边界，本批组件替身，真实窗口后批。

## 已确认事实（禁止重新推导）
- 01能力字段及dispatch门槛、02实际启动复核已过；能力绑定baseUrl/wireApi/models，有user来源和updatedAt，元数据未知。
- Select无单项disabled，用投影选项和事件校验，不改全局部件。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/renderer/components/DeepseekSettings.tsx` — modelField及推理强度行。
2. `src/core/deepseek-settings.ts` — 能力合同/连接规范化，只读。
3. `test/ui/deepseek-model-prices.test.tsx` — 草稿保存/取消范式，只读。

## 修改白名单
- `docs/ui-spec.md`
- `app/renderer/components/DeepseekSettings.tsx`
- `test/ui/deepseek-reasoning.test.tsx`
- max_modified_files: `3`

## 明确非目标
- 不改统一Select、核心、runner/模板，不联网或自动探测能力；不冒称窗口通过。

## 定向验证（最多 5 条）
1. `npm run test:ui -- test/ui/deepseek-reasoning.test.tsx test/ui/deepseek-catalog-consent.test.tsx test/ui/deepseek-model-prices.test.tsx`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不全量/build/e2e或重复01/02核心；截图需新窗口合同。

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
- 一次纠偏仍失败、并发来源冲突或需白名单外改动时保存检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 编辑确认
- remaining_gaps: 窗口和集成
- anchors_touched: 符号
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
