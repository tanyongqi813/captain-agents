# Execution Capsule — TASK-033 / attempt-03

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLAIMED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `03`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

补齐金额账本的跨日不确定性记录与恢复/并发确定性证据；直接实施已获主人授权，不启动真实下游。

## 本轮验收切片

- 北京时间换日前后的累计量仅入账新增差额；跨日迟到量按观测日保守记预算，但必须永久保留日期无法精确归属的标记、区间与原因，重复最终事件不能洗掉标记。
- 缺最终用量保守结算预留后，迟到量不重复扣账；重启后行为相同。
- 并发领取不超过共享预算；改价不追改已预留任务；非法用量拒绝且账本不写。

## 已确认事实（禁止重新推导）

- F-01 已通过：只有 ENOENT 可初始化，坏账本不覆盖，保持该实现。
- Usage 的 read 已由通道归一为含缓存输入，cacheWrite 是可选附加量；本轮不改解析器或计价口径。
- 当前跨日累计量按观测日差额记账，但 unknown 会被任何累计量清除，缺少可审计来源和原因。
- 已有一份全局 DeepSeek 账本及冻结价格；多账户预算组与独立缓存写入价格仍是后续切片，不宣称本轮完成整任务。

## Active findings

- none；这是剩余业务实现切片，不重做已解决问题。

## 源码锚点（最多 5 个）

1. `src/core/money-budget.ts` — Entry、load、reserveMoney、observeMoney、status。
2. `src/core/job.ts` — Usage；只读复用。
3. `test/deepseek-settings.test.ts` — 既有金额与坏账本回归；只运行不修改。

## 修改白名单

- `src/core/money-budget.ts`
- `test/money-budget.test.ts`
- max_modified_files: `2`

## 明确非目标

- 不改 UI、配置协议、派发/运行接线、凭据、模型或公共解析器；不改旧 Capsule/Review。
- 不提交/push、不读真实密钥、不发收费请求；不自动推进 TASK-034/035。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/money-budget.test.ts test/deepseek-settings.test.ts test/money-budget-runner.test.ts test/deepseek-credentials.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证

- 不跑全量测试、UI、build、e2e、真实接口；已覆盖最新代码的通过命令不重复。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `prompt_soft`
- soft_timebox_minutes: `35`
- soft_call_limit: `20`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

- 需要超白名单、改变费用配置/通道协议或新增真实调用时，返回剩余缺口。
- 一次实现及一次纠偏仍不通过时返回检查点，不扩修。

## 精简 Implementation Report（固定格式）

- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 绝对工作区与分支
- changed_files: 路径
- completed_scope: 已完成切片
- remaining_gaps: 整任务未完成项
- anchors_touched: 符号与测试
- verification: 命令结果及 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
