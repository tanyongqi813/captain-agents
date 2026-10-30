# Execution Capsule — TASK-036 / attempt-10
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-036.md`
- task_id: `TASK-036`
- attempt: `10`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
补齐离线专用临时Git仓库准备，失败零选手启动。
## 本轮验收切片
- 固定文件位于新建Git仓库；不提交、不读用户Git配置/模板/钩子，不改变主仓。
- Git准备失败不消费审批、不启动选手；已有准备总闸门保持。
## 已确认事实（禁止重新推导）
- 09已通过回收失败保护；真实入口未开放，单次token不代表真实权限。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/channel-probe-worker-fixture.ts` — runWorkerProbeFixture。
2. `test/channel-probe-worker-fixture.test.ts` — fixture。
## 修改白名单
- `src/core/channel-probe-worker-fixture.ts`
- `test/channel-probe-worker-fixture.test.ts`
- max_modified_files: `2`
## 明确非目标
- 不接真实凭据/通道、不改workers/runner/沙箱模板、不开启应用入口。
## 定向验证（最多 5 条）
1. `node --test --test-name-pattern='Git' test/channel-probe-worker-fixture.test.ts`
2. `node --test --test-name-pattern='正常准备' test/channel-probe-bounded-fixture.test.ts`
3. `npm run typecheck`
4. `git diff --check`
## 禁止验证
- 不重复旧审批/超时矩阵、全量/build/UI/真实CLI模型网络。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `12`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需真实权限或白名单外生产变更即停相关范围。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 当前路径分支
- changed_files: 白名单
- completed_scope: 临时Git
- remaining_gaps: 真实入口/样本
- anchors_touched: prepare
- verification: PASS/FAIL/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 不提交或访问用户仓库
