# Execution Capsule — TASK-034 / attempt-05
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-034.md`
- task_id: `TASK-034`
- attempt: `05`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
关闭看管暂停后新累计用量洗掉无观测间隔的安全缺口，并留下脱敏停机证据。
## 本轮验收切片
- observeMoney在更新observed前冻结是否超过unknownSeconds，迟到新增累计量照实入账但不能撤销本周期停止决定；停止不依赖AI，hard优先/终态不自动续跑保持。
- runner停止时保存每round首个money-stop-N.json：时间、原因、冻结组、已结算/预留/未知/停派及当时hard/soft；不写日志原文/凭据。证据保存失败仍停止，不假成功。
- POSIX临时真CLI/假选手，精确验证自己创建的supervisor pid后SIGSTOP，期间假选手新增累计量，超过30秒后SIGCONT；恢复后10秒内停止/报告补丁保留/保守结算。Windows明确跳过该信号测试，不整机休眠。
## 已确认事实（禁止重新推导）
- 01/03/04组停机/连续无量/冷读/续接拒绝已过；不重复。
- 当前observeMoney先写新observed后检查未知间隔，暂停期间的新累计量可能掩盖超时；runner仅error字符串无金额时间审计文件。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/money-budget.ts` — observeMoney。
2. `src/core/runner.ts` — watch费用停止。
3. `test/money-budget-lifecycle.test.ts` — 无观测夹具。
## 修改白名单
- `src/core/money-budget.ts`
- `src/core/runner.ts`
- `test/money-budget-suspension.test.ts`
- max_modified_files: `3`
## 明确非目标
- 不修改进程/隔离模板、真实OS休眠、凭据/网络，不自动重启，不改旧通过测试。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-suspension.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不旧看管/组停机/全量/UI/build/e2e；必要最终集成另合同。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `14`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 只允许自己测试supervisor信号，来源冲突/一次纠偏仍失败保存检查点。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 暂停恢复安全及证据
- remaining_gaps: 迟到/整项验收
- anchors_touched: observeMoney/watch
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界

