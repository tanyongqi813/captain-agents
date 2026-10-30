# Execution Capsule — TASK-036 / attempt-09
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-036.md`
- task_id: `TASK-036`
- attempt: `09`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
修复F06：回收失败保留拥有上下文，不误删，保存固定恢复记录。
## 本轮验收切片
- core cleanupFailed时不删根目录，写本地恢复ID及根/辅助进程身份，不保存原始日志/密钥，不能自动重试。
- 正常通过继续清理；POSIX仅测试自己创建的组，模拟组kill失败证明资料保留，再核对身份后回收该测试组。
## 已确认事实（禁止重新推导）
- 08旧边界/取消通过，07授权链不改；原模板/真实权限保持。
## Active findings
- `F-06`: 外层finally不区分回收成功就删根。
## 源码锚点（最多 5 个）
1. `src/core/channel-probe-bounded-fixture.ts` — report/finally/helper身份。
2. `src/core/channel-probe.ts` — cleanupFailed，仅只读。
## 修改白名单
- `src/core/channel-probe-bounded-fixture.ts`
- `test/channel-probe-cleanup-failure.test.ts`
- max_modified_files: `2`
## 明确非目标
- 不改07门/原模板/真实入口，不重复旧超时矩阵。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=30000 test/channel-probe-cleanup-failure.test.ts`
2. `node --test --test-name-pattern='正常准备' test/channel-probe-bounded-fixture.test.ts`
3. `npm run typecheck`
4. `git diff --check`
## 禁止验证
- 不全量/UI/build/e2e/真实网络凭据模型，不重复无影响项。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `5`
- soft_call_limit: `8`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 超白名单/一次纠偏失败保存partial。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 安全保留
- remaining_gaps: 真实入口及整项
- anchors_touched: finally
- verification: 结果/latest_code_covered
- active_findings: F06 resolved/unresolved
- scope_or_baseline_notes: 故障只发生于测试创建的进程
