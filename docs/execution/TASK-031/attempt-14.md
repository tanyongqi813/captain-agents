# Execution Capsule — TASK-031 / attempt-14

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `14`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
补齐新专门授权桥的UI默认替身，解除类型阻断。

## 本轮验收切片
- fixtureBridge提供默认关闭read/set替身，不真实开启、不读凭据，允许测试显式覆盖。

## 已确认事实（禁止重新推导）
- 13桥测试3/3已过，不重复；类型失败只缺fixtureBridge两方法。

## Active findings
- `F-12`: fixtureBridge缺新增必需授权方法，不能将Bridge改可选。

## 源码锚点（最多 5 个）
1. `test/ui/fixtures.tsx` — fixtureBridge。

## 修改白名单
- `test/ui/fixtures.tsx`
- max_modified_files: `1`

## 明确非目标
- 不改生产/界面，不重写旧测试。

## 定向验证（最多 5 条）
1. `npm run typecheck`
2. `git diff --check`

## 禁止验证
- 不重跑已过桥/目录/费用测试，不跑全量/UI/build/e2e或真实应用。

## 已知基线失败
- typecheck：fixtureBridge缺两新方法。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `5`
- soft_call_limit: `5`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 越白名单或一次纠偏仍失败停下报告。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 夹具
- remaining_gaps: UI/窗口
- anchors_touched: fixtureBridge
- verification: 结果与latest_code_covered
- active_findings: F-12
- scope_or_baseline_notes: 新事实
