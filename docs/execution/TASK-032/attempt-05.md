# Execution Capsule — TASK-032 / attempt-05

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-032.md`
- task_id: `TASK-032`
- attempt: `05`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
真实CLI派发默认/已确认high与金额身份价格链兼容，旧夹具显式声明模式而非绕过门槛。

## 本轮验收切片
- 新离线用例默认与用户确认high均运行假选手done，实际argv强度省略/唯一high、实际ID/连接冻结、费用正确，未知high零注册拒绝。
- 原身份/价表成功派发夹具明确default，保持金额/旧账/分组断言不削弱。

## 已确认事实（禁止重新推导）
- 01/02能力与真实末端门槛已过，03UI/04窗口已过，不重复。
- 两旧夹具采用defaultDeepseekEndpoint未声明high能力，会被新门槛拒绝；只改夹具显式default，不改生产迁移或fake绕过。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `test/money-budget-dispatch-identity.test.ts` — 两轮实际ID/价冻结。
2. `test/deepseek-model-prices.test.ts` — 显式组按ID查价。
3. `src/core/deepseek-settings.ts` — 能力字段，只读。

## 修改白名单
- `test/deepseek-reasoning-dispatch.test.ts`
- `test/money-budget-dispatch-identity.test.ts`
- `test/deepseek-model-prices.test.ts`
- max_modified_files: `3`

## 明确非目标
- 不改生产、其他旧夹具、01/02或UI；不真实请求/认证/收费。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-reasoning-dispatch.test.ts test/money-budget-dispatch-identity.test.ts test/deepseek-model-prices.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不全量/UI/build/e2e，不重复已通过旧门槛/窗口。

## 已知基线失败
- 两原成功夹具未确认high与新门槛冲突，保持原业务目标修夹具。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `12`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 需生产修正或一次纠偏仍失败则保存检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: CLI兼容
- remaining_gaps: 错误回交及整项
- anchors_touched: 测试
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
