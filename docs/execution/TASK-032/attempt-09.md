# Execution Capsule — TASK-032 / attempt-09

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-032.md`
- task_id: `TASK-032`
- attempt: `09`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
完成032功能验收矩阵及任务级选定兼容，准确区分整仓发布闸门。

## 本轮验收切片
- 映射三AC到默认命令/显式能力门槛/未知不猜；一次跨核心命令及新错误路径合跑，确认06共享runner改动后兼容。
- 不改代码，报告准确列选定证据及未执行全仓范围。

## 已确认事实（禁止重新推导）
- 01–06能力、末端门槛、UI窗口/错误路径已过；07/08新夹具费用12项已过不重跑。
- 031正式依赖未解除；本批功能判定不能冒充AGENTS完整verify通过。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `test/deepseek-settings.test.ts` — 默认省略与历史兼容。
2. `test/workers.test.ts` — 其他通道命令。
3. `test/deepseek-reasoning-runtime.test.ts` — 末端命令一致。
4. `test/deepseek-model-recovery.test.ts` — 错误回交。

## 修改白名单
- `docs/implementation/TASK-032-acceptance.md`
- max_modified_files: `1`

## 明确非目标
- 不改生产/测试，不重跑窗口/build或金额测试。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/workers.test.ts test/deepseek-settings.test.ts test/deepseek-reasoning.test.ts test/deepseek-reasoning-runtime.test.ts test/deepseek-reasoning-dispatch.test.ts test/deepseek-model-recovery.test.ts`
2. `git diff --check`

## 禁止验证
- 不全仓verify/UI/build/e2e或真实系统访问，types沿08最新通过。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `8`
- soft_call_limit: `8`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 如需源码/测试修复，不越白名单，保存具体finding另批。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 验收报告
- completed_scope: 任务功能判定
- remaining_gaps: 整仓闸门
- anchors_touched: none
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界
