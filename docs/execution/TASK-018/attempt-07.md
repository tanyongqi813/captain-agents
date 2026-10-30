# Execution Capsule — TASK-018 / attempt-07

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `07`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
仅修 F-07：预算已成功预占但登记尚未成功时，也能回滚当前预占。

## 本轮验收切片
- createJob 故障在登记前回滚当前 claim；无残留尝试、并发位或时长预占。
- 多选手先成功登记、后登记失败时各预占恰回滚一次，已登记任务留下失败原因。
- 注入仅测试进程模块替身，不增加生产绕过开关。

## 已确认事实（禁止重新推导）
- catch 只遍历 jobs，createJob 失败的当前预算未加入 jobs，因而漏回滚。
- F-08/F-09 本轮已通过；F-02/F-05 后续单独处理，不改 releaseAttempt 协议。

## Active findings
- `F-07`：登记前失败遗漏当前已成功预占。

## 源码锚点（最多 5 个）
1. `src/core/dispatch.ts` — costGate/createJob/catch 的预占生命周期。
2. `test/cost-budget.test.ts` — 成本预算与派发续跑替身组。

## 修改白名单
- `src/core/dispatch.ts`
- `test/cost-budget.test.ts`
- max_modified_files: `2`

## 明确非目标
- 仅在指定副本执行；不覆盖主仓，不改 F-02/F-05、公共设置和运行收尾，不真实调用。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/cost-budget.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量/UI/build/e2e/真实接口。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `30`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 超白名单或需改变预占身份协议时停止本轮，单独规划 F-02。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict / soft_budget
- workspace_branch: 绝对路径及分支
- changed_files: 路径
- completed_scope: 内容
- remaining_gaps: 缺口
- anchors_touched: 符号
- verification: 命令结果及 latest_code_covered
- active_findings: F-07 resolved/unresolved
- scope_or_baseline_notes: 新事实

