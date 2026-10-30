# Execution Capsule — TASK-036 / attempt-02
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-036.md`
- task_id: `TASK-036`
- attempt: `02`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `Medium`
- required_planning_lookup: `none`
## 本轮唯一目标
提供只能显式选择离线假场景的独立脚本及真CLI替身验收，不开放真实命令。
## 本轮验收切片
- 无参数/真实模式拒绝；固定假场景输出可解析安全报告，明确offline/未知用量/未设金额硬限额；无自动入口。
## 已确认事实（禁止重新推导）
- 01核心已过，直接复用，不重写/重测。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/channel-probe.ts` — runChannelProbe。
2. `test/helpers.ts` — exec。
## 修改白名单
- `scripts/channel-probe-offline.ts`
- `test/channel-probe-cli.test.ts`
- max_modified_files: `2`
## 明确非目标
- 不真实适配器/密钥/网络/模型，不改核心与旧任务。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=15000 test/channel-probe-cli.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不01旧核心/全量/UI/build/e2e。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `6`
- soft_call_limit: `8`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需超范围/真实权限或一次纠偏仍失败回交。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 新脚本与测试
- completed_scope: 离线入口
- remaining_gaps: 手动真实范围
- anchors_touched: CLI
- verification: 结果/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 不冒充供应商探测
