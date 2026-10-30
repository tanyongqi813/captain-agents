# Execution Capsule — TASK-038 / attempt-07
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `07`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
精确修复F-05：已确认根退出且成功强清的同一POSIX组不重复清理；真正失败保持可见。
## 本轮验收切片
- 平台层提供每实例终态清理器；仅非Windows、明确exitedAt且成功SIGKILL才记同pid/since/exitedAt成功，其他身份/失败/未退出仍尝试，Windows每次沿旧快照路径。
- runner仅killWorker换用本实例终态清理器，SIGTERM/原错误记录不改。原双任务组合B须done，A报告patch保留/另任务隔离及无重派仍过。
## 已确认事实（禁止重新推导）
- 06真实包装器记录第一清理OK、第二EPERM，同组exit0无残留。修复不吞EPERM，不改安全启动模板。
## Active findings
- `F-05`: 成功清理同一终态组又清理造成失败。
## 源码锚点（最多 5 个）
1. `src/core/platform.ts` — killTree。
2. `src/core/runner.ts` — killWorker。
3. `test/execution-guard-runner.test.ts` — 原不弱化组合。
## 修改白名单
- `src/core/platform.ts`
- `src/core/runner.ts`
- `test/execution-guard-runner.test.ts`
- max_modified_files: `3`
## 明确非目标
- 不改Windows回收/killTree错误语义、原预算/模板/其他dirty hunk，不接后续功能。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=45000 test/execution-guard-runner.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不重复04/纯01/02/037/UI/build/全量，不真实模型。
## 已知基线失败
- 修复前本组合B failed/重复SIGKILL EPERM。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `8`
- soft_call_limit: `10`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 超3文件/第一次真正清理错误不可解决则保存partial，不放宽安全。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget
- workspace_branch: 当前路径分支
- changed_files: 三白名单
- completed_scope: F-05修复
- remaining_gaps: 负责人回交
- anchors_touched: 终态清理
- verification: PASS/FAIL/latest_code_covered
- active_findings: F-05 resolved/unresolved
- scope_or_baseline_notes: 历史dirty保留
