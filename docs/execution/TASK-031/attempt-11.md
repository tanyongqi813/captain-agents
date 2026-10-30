# Execution Capsule — TASK-031 / attempt-11

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `11`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
将08调度和10受控查询接成持久化单次刷新入口，跨进程共享单飞、冷却及失败退避。

## 本轮验收切片
- 调度状态严格序列化/恢复，坏状态拒绝；锁内领取唯一租约，网络在锁外，冷进程不得清空60秒冷却/失败退避。
- 请求前及目录提交前核验当前租约，过期/被替换结果拒绝；崩溃在途保留至超时并退避，不直接立即重试；授权代号变化不复活旧结果。
- 入口必须显式请求适配器，无定时器/真实通道消费者；未授权零请求。不重写已有授权或金额逻辑。

## 已确认事实（禁止重新推导）
- 08纯调度5/5、10受控提交6/6已过；08缺持久化恢复接口，此批受影响才重跑其测试。
- 提交锁顺序目录→调度租约→设置，领取与收尾不持锁等待网络，设置写入不取调度/目录锁。
- 三主要实现文件原子接线，加一测试文件，保持默认关闭；IPC/UI/主动abort后续验收。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/deepseek-catalog-schedule.ts` — 纯调度类。
2. `src/core/deepseek-models.ts` — refreshConsentedDeepseekCatalog提交闸门。
3. `src/core/settings.ts` — 保存授权读取，只读。

## 修改白名单
- `src/core/deepseek-catalog-schedule.ts`
- `src/core/deepseek-models.ts`
- `src/core/deepseek-catalog-refresh.ts`
- `test/deepseek-catalog-refresh.test.ts`
- max_modified_files: `4`

## 明确非目标
- 不接后台定时器/IPC/UI或真实网络，不改手动刷新/价格/模型选用，不添加依赖。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-catalog-refresh.test.ts test/deepseek-catalog-schedule.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重跑未受影响旧授权/费用测试，不跑全量/UI/build/e2e或真实中转站。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `20`
- soft_call_limit: `20`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 越白名单/来源不清停下报告；一次纠偏仍失败保存检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 接线验收
- anchors_touched: 持久化调度入口
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
