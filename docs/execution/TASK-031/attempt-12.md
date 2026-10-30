# Execution Capsule — TASK-031 / attempt-12

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `12`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
接入默认关闭的桌面后台刷新生命周期，授权撤销/身份变化及退出主动取消在途请求。

## 本轮验收切片
- 核心控制器每次poll先查有效授权，无授权不调用刷新；本地单飞，但在途仍可poll授权，变化主动abort。
- 合并既有查询超时signal与退出/撤销signal，stop后不再请求或发布；读取授权失败保守取消并只报固定摘要，不泄漏原异常。
- main在非e2e启动控制器与2秒授权观察定时器，消费11持久化入口；退出清timer并stop，默认配置无真实请求。

## 已确认事实（禁止重新推导）
- 11持久化限频与10提交授权已过；2秒poll仅本地授权观察，不等于每2秒发网络请求。
- main已有electronRequest支持signal，before-quit已有调度清理。IPC/UI主人开关尚缺，后续另批，不伪称完整可用。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/main/index.ts` — 启动、electronRequest、before-quit。
2. `src/core/deepseek-catalog-refresh.ts` — 持久化单次入口，只读。
3. `src/core/settings.ts` — 授权读取，只读。

## 修改白名单
- `src/core/deepseek-catalog-loop.ts`
- `app/main/index.ts`
- `test/deepseek-catalog-loop.test.ts`
- max_modified_files: `3`

## 明确非目标
- 不接新IPC/UI，不改旧网络/选手权限，不访问真实密钥或中转站，不安装部署。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-catalog-loop.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重跑已过目录/调度/费用测试，不跑全量/UI/build/e2e或启动真实应用。

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
- 白名单外/来源不清停下报告，一次纠偏仍失败保存检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 开关窗口/集成
- anchors_touched: 后台生命周期
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
