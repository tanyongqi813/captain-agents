# Execution Capsule — TASK-038 / attempt-09
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `09`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
按本轮明确审查要求修复回交对同动作其他运行任务及未确认归档的安全边界。
## 本轮验收切片
- 回交会终止整个autopilot推进，必须在原transition锁内检查同token/action/attempt所有其他job均终态；有运行/排队/未知状态或缺失记录拒绝，不把仍运行的兄弟任务留在终态run下。
- 固定说明只确认观察证据已保留，改动/报告待负责人检查，不在未核验时声称都归档。
- 只改离线回交；B运行拒绝且run字节不变、B结束才可回交，原单job/旧token通过证据只在代码影响下重跑。
## 已确认事实（禁止重新推导）
- 08action.jobs仅includes(A)，advance owner会将整run needs_owner，未检查同token其他job运行状态。
- 08固定文案声称改动保留，但测试没有report/diff；不能用文案代替证据。
## Active findings
- `F-09`: 多job动作回交缺少其他job终态核验。
- `F-10`: 未核验归档时固定说明过度声称改动已保留。
## 源码锚点（最多 5 个）
1. `src/core/execution-guard-handoff.ts` — transition callback/note。
2. `src/core/autopilot.ts` — advance owner终止run，只读。
## 修改白名单
- `src/core/execution-guard-handoff.ts`
- `test/execution-guard-handoff.test.ts`
- max_modified_files: `2`
## 明确非目标
- 不停止其他job、不改autopilot/028状态机，不启用生产策略/自动恢复，不真实模型。
## 定向验证（最多 5 条）
1. `node --test test/execution-guard-handoff.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不重复01–07/037/UI/build/全量或无影响窗口。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需要其他任务状态机修改/权限扩大即保存边界。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 当前路径分支
- changed_files: 两白名单
- completed_scope: F-09/F-10
- remaining_gaps: 冷进程中断
- anchors_touched: transition
- verification: PASS/FAIL/latest_code_covered
- active_findings: resolved/unresolved
- scope_or_baseline_notes: 不改08历史
