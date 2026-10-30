# Execution Capsule — TASK-033 / attempt-05

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `05`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
在费用核心支持可选的独立缓存写入单价，冻结到任务预留；旧配置保持原计价。

## 本轮验收切片
- cacheWrite 价格可省略，省略按 input 单价计；明确 0 保留为 0。
- Usage.read 已含 cacheWrite；分离新输入、缓存读、缓存写、输出，不重复收费。
- 独立写入单价持久化并冻结，后续改价不改历史；非法价格/用量拒绝且账本不改。

## 已确认事实（禁止重新推导）
- TASK-033 attempt-04 已通过定点运算及跨日兜底切片，保留。
- Usage 有可选 cacheWrite，read 已含缓存输入；当前统一将写入按 input 价计。
- 深度编辑界面、账户组与按实际模型 ID 绑定仍缺，不将本轮通过当整体完成。

## Active findings
- none；补既有需求的剩余业务切片。

## 源码锚点（最多 5 个）
1. `src/core/deepseek-settings.ts` — DeepseekPrice、deepseekMoney。
2. `src/core/money-budget.ts` — usageAmount、load、reserveMoney。
3. `test/money-budget.test.ts` — 定点计价、非法用量、冻结价格回归。

## 修改白名单
- `src/core/deepseek-settings.ts`
- `src/core/money-budget.ts`
- `test/money-budget.test.ts`
- max_modified_files: `3`

## 明确非目标
- 不改 UI、派发接线、凭据、网络或模型，不发真实接口请求；不覆盖 TASK-028 在途工作。
- 不提交/推送夹带历史未审改动，不部署，不把前置未通过任务标 READY。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget.test.ts test/deepseek-settings.test.ts test/money-budget-runner.test.ts test/deepseek-credentials.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量/UI/build/e2e/真实账户；同一轮代码未变不重复通过命令。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `25`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 超白名单、并发改同文件、需新架构选择或真实权限时停止；一次实现加一次纠偏后仍失败保留检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict / soft_budget
- workspace_branch: 绝对工作区及分支
- changed_files: 路径
- completed_scope: 切片
- remaining_gaps: 整任务缺口
- anchors_touched: 符号
- verification: 命令结果及 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
