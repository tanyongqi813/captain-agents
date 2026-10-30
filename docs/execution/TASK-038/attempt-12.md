# Execution Capsule — TASK-038 / attempt-12
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `12`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
移除连续观察身份核对前的休眠写副作用，保留11接线并补正常生命周期兼容。
## 本轮验收切片
- 只消费runner写入的job.sleeps；观察自身超过60秒无采集保守invalidate，不用日志增长抵消，不把盲区累计成停机宽限；不新增SleepMonitor写入。
- 可控时钟模拟盲区，不是OS休眠，证明零停止请求/无job.sleeps新写；真假选手正常read结束后长命令超过read阈值仍完成，不误杀、不交owner。
## 已确认事实（禁止重新推导）
- 11真实异常组合已过；本批移除额外写入，最终必须定向确认受影响异常组合。90秒只为协作循环截止，不能抢占IO/冒称硬强停。
## Active findings
- `F-11`: 身份核对前SleepMonitor可能污染新轮次休眠。
## 源码锚点（最多 5 个）
1. `src/core/execution-guard-loop.ts` — sleeps.sample/identity。
2. `test/execution-guard-loop.test.ts` — 已接组合。
## 修改白名单
- `src/core/execution-guard-loop.ts`
- `test/execution-guard-loop.test.ts`
- max_modified_files: `2`
## 明确非目标
- 原consumer/runner/模板保持，不真实调用/发布，不补同义审批或恢复测试。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=30000 test/execution-guard-loop.test.ts` — 最终新增及受影响链；如ps隔离失败仅范围审批原样组合。
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不全量/build/UI/旧矩阵。
## 已知基线失败
- ps隔离EPERM已确认，必要走范围明确工具审批，不削弱退出断言。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `8`
- soft_call_limit: `10`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需改白名单外或再次放宽归属即保存partial。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 当前绝对路径/分支
- changed_files: 两白名单文件
- completed_scope: F11修复/生命周期兼容
- remaining_gaps: 实际校准/正式依赖发布
- anchors_touched: 循环休眠
- verification: PASS/FAIL/latest_code_covered
- active_findings: F11 resolved/unresolved
- scope_or_baseline_notes: 只离线/非硬IO超时
