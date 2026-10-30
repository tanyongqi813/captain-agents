# Execution Capsule — TASK-032 / attempt-06

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-032.md`
- task_id: `TASK-032`
- attempt: `06`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
模型/强度确定性错误登记→桌面已授权一次目录核对→固定提示回交原子接线。

## 本轮验收切片
- runner仅检查日志末64KiB完整JSON行error/turn.failed：model_not_found或unsupported_parameter且param为两种reasoning_effort键；不猜散文、工具错误或未知码，不存原文。
- job/round持久去重；消费先留历史再请求，崩溃/失败/冷却不重试。登记及实际请求核对原grant/binding、冻结地址/协议/凭据版本；未授权零请求、重开授权不复活旧队列。
- 新模块复用031controller/scheduler及取消，main既有非E2E周期消费/退出stop，runner不联网。固定诊断通过既有error回交，报告/费用保留，不推理重试/切模型。

## 已确认事实（禁止重新推导）
- 05真CLI default/high7/7；现周期刷新并非错误事件恢复，需真正生产消费者。
- 031控制器接受显式fetch，持久调度限频、设置锁授权核验已过，复用而不另造通道。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/runner.ts` — finally报告/费用收尾。
2. `app/main/index.ts` — catalogLoop生命周期。
3. `src/core/deepseek-catalog-loop.ts` — 取消及依赖注入。
4. `src/core/deepseek-catalog-refresh.ts` — 显式请求受控调度。

## 修改白名单
- `src/core/deepseek-model-recovery.ts`
- `src/core/runner.ts`
- `app/main/index.ts`
- `test/deepseek-model-recovery.test.ts`
- max_modified_files: `4`

## 明确非目标
- 不改错误解析器全局行为、UI/模板/隔离/真实权限，不真实查询或读取真实认证。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-model-recovery.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不全量/旧核心/UI/build/e2e或真实通道。main本批仅源码接线/类型验证。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `18`
- soft_call_limit: `14`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 需第五文件/真实权限、并发来源冲突，或一次纠偏仍失败保存检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 错误回交接线
- remaining_gaps: 兼容与整项
- anchors_touched: 符号
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界
