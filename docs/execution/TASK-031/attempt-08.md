# Execution Capsule — TASK-031 / attempt-08

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `08`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
新增默认无授权的模型目录刷新纯调度核心，供后续显式授权接线，不启动网络或定时器。

## 本轮验收切片
- 显式非密钥连接/凭据版本绑定后才可领取一次刷新凭证；同一时刻最多一次，至少60秒间隔。
- 失败指数退避封顶15分钟，15秒超时释放调度占位但不立刻重试；关闭/变更身份撤销在途凭证，旧响应不能被接受。
- 时钟非法/回退拒绝，不读设置/目录/凭据，不修改模型或价格；不因调度器构造触发任何操作。

## 已确认事实（禁止重新推导）
- 04–07目录基础、安全、派发和显示切片已过；不重复。
- 既有模型查询15秒超时。开发默认关闭功能有授权，不代表允许真实启用。
- 本批只产出调度接口，设置授权/主进程接线及整体窗口验收仍缺，不宣称端到端完成。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/deepseek-models.ts` — queryDeepseekModels的15秒超时，只读。

## 修改白名单
- `src/core/deepseek-catalog-schedule.ts`
- `test/deepseek-catalog-schedule.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不接fetch/密钥/目录写入/IPC/设置UI，不加依赖，不改生产启动参数或真实权限。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-catalog-schedule.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重复已过目录/费用测试，不跑全量/UI/build/窗口或真实请求。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 需要真实网络/密钥或白名单外修改，停止并报告；一次纠偏仍失败回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 整项接线验收
- anchors_touched: 调度接口
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
