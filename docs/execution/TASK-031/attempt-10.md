# Execution Capsule — TASK-031 / attempt-10

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `10`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
把保存授权接入受控模型请求和目录提交，防止撤销/换身份后的在途结果写入目录。

## 本轮验收切片
- 新受控入口必须传入已保存授权快照及请求适配器，无默认fetch、无计时器或生产后台消费者。
- 请求发起前及目录成功/失败写入时，在设置锁内核验有效binding/grant；目录锁→设置锁固定顺序，网络等待不持有设置锁。
- 撤销、关闭重开、换连接或凭据期间的成功/失败均不能覆盖旧目录；合法成功及失败保留/标陈旧有效。手动旧入口兼容。

## 已确认事实（禁止重新推导）
- 08纯调度、09授权通过。旧refreshDeepseekCatalog直接落盘，不能先落盘后检查授权。
- 本批原子连接授权与目录提交；持久化限频、调度器08接线、IPC/UI后续批，不宣称全闭环。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/settings.ts` — readDeepseekCatalogConsent及设置锁。
2. `src/core/deepseek-models.ts` — refreshDeepseekCatalog成功/失败目录锁。

## 修改白名单
- `src/core/settings.ts`
- `src/core/deepseek-models.ts`
- `test/deepseek-catalog-authorized.test.ts`
- max_modified_files: `3`

## 明确非目标
- 不新增真实权限/后台请求，不改旧手动查询含义或费用；不用真实密钥，不加依赖。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-catalog-authorized.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重跑已过目录/费用/调度/授权文件，不跑全量/UI/build/e2e或真实通道。

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
- 越白名单/来源不清停下报告；一次纠偏仍失败回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 接线验收
- anchors_touched: 授权提交
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
