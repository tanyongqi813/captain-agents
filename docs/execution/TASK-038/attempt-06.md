# Execution Capsule — TASK-038 / attempt-06
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `06`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
借dispatch既有start注入点，测试专用runner包装器记录负PID清理调用结果，定位F-05具体阶段。
## 本轮验收切片
- 包装器只记录自己任务worker组SIGKILL/SIGTERM前后自有PID状态/结果，调用原process.kill且不吞错；保持所有原组合断言。
- 不改生产源文件，只生成临时测试脚本，不记录凭据/原日志。若原FAIL仍在，精确结果保留，不无限重试。
## 已确认事实（禁止重新推导）
- 05释放前真实组正确，结束三自有PID均不在、exit0仍failed；需要具体调用证据而非猜权限。
- dispatch已有start参数可调用launch(job,自有脚本)，不改生产模板。
## Active findings
- `F-05`: B正常退出清理EPERM导致failed。
## 源码锚点（最多 5 个）
1. `src/core/dispatch.ts` — dispatch/start/launch，只读。
2. `src/core/runner.ts` — runWorker/killWorker，只读。
## 修改白名单
- `test/execution-guard-runner.test.ts`
- max_modified_files: `1`
## 明确非目标
- 不改生产、不改变信号/吞错、不删原done断言，不接needs_owner。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=45000 test/execution-guard-runner.test.ts`
2. `git diff --check`
## 禁止验证
- 不重复04或无新覆盖的旧测试；不types/build/UI/全量/真实模型。
## 已知基线失败
- 原组合B failed/kill EPERM。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `8`
- soft_call_limit: `8`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需要生产修复另合同先校验；不对非自有PID操作。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 当前路径分支
- changed_files: 包装器测试
- completed_scope: 调用证据
- remaining_gaps: F-05修复
- anchors_touched: test
- verification: PASS/FAIL/latest_code_covered
- active_findings: F-05 resolved/unresolved
- scope_or_baseline_notes: 仅新建测试进程
