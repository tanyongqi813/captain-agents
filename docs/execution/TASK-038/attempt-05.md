# Execution Capsule — TASK-038 / attempt-05
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `05`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
给原03失败组合增加精确自有身份诊断，定位F-05真实发生时的组与清理阶段。
## 本轮验收切片
- 不改原B done断言或子孙场景。假程序记录自己的子PID/随机拥有标记；B释放前后只读核对已记录的worker/runner/自有子PID、组/状态及完整job固定收尾字段。
- 仅在新增诊断覆盖后重跑一次03，输出自有行有界；ps若被拒走明确范围工具审批，不把权限拒绝当无进程。
- 不能在根因未明时改生产/吞EPERM，若需生产修复另建有界合同。
## 已确认事实（禁止重新推导）
- 04范围审批最小父退子组1/1 PASS，两次killTree成功，子孙均消失；03实际组合仍FAIL，F-05未解。
- 不用历史42731/42732或其他旧PID；每次仅新测试拥有身份。
## Active findings
- `F-05`: 03 B正常退出清理EPERM导致failed。
## 源码锚点（最多 5 个）
1. `test/execution-guard-runner.test.ts` — 原组合。
2. `test/execution-guard-exit.test.ts` — 自有ps范围/nonce，只读。
3. `src/core/runner.ts` — 两层finally，只读。
## 修改白名单
- `test/execution-guard-runner.test.ts`
- max_modified_files: `1`
## 明确非目标
- 不改生产/模板、不弱化断言，不继续重复04/01/02，不接needs_owner，不对外部进程操作。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=45000 test/execution-guard-runner.test.ts`
2. `git diff --check`
## 禁止验证
- 无新诊断代码前不重跑03；不全量/types/UI/build/真实模型或凭据。
## 已知基线失败
- 原03组合：B正常退出kill EPERM，4.56秒FAIL。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需要生产修改另建合同；一次纠偏仍无明确证据保存partial，不无限重试。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 当前路径分支
- changed_files: 新诊断增量
- completed_scope: F-05证据
- remaining_gaps: F-05修复
- anchors_touched: test
- verification: PASS/FAIL/latest_code_covered
- active_findings: F-05 resolved/unresolved
- scope_or_baseline_notes: 仅自有进程
