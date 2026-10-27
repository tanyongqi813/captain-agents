# Execution Capsule — TASK-031 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

将现有模型查询结果持久化为按连接隔离的目录，给后续管理模型与实际 ID 同步提供同一数据源。本轮是 TASK-031 的目录基础切片；完成本轮不代表整个 TASK-031 通过。

## 本轮验收切片

- 查询成功后可在重新读取时得到同一模型列表及更新时间；失败保留上次成功目录并标记陈旧；地址或协议不同不能复用目录。

## 已确认事实（禁止重新推导）

- 当前 queryDeepseekModels 返回 string[]；现有编辑弹窗依赖此返回类型，保持兼容。
- 查询已支持请求替身、15 秒超时与禁止重定向；不需要启动真实选手。
- 现有模型目录仅在弹窗本地状态，管理模型接线、运行身份冻结与自动定时刷新由后续切片完成。
- 本轮不实现凭据版本迁移：带 freshKey 的查询可以返回结果，但不得把未经保存的凭据查询结果发布为已保存连接的权威目录。缓存应标注账户身份未核验，不据此阻止或批准派发。

## Active findings

- none

## 源码锚点（最多 5 个）

1. `src/core/deepseek-models.ts` — queryDeepseekModels、parseDeepseekModels；新增目录读取与持久化接口，保留原查询返回类型。
2. `src/core/fsx.ts` — withLock、writeJson、readOptional；复用原子写入和锁，仅阅读。
3. `test/deepseek-settings.test.ts` — 已有模型请求替身与临时 XAGENTS_HOME；补目录隔离、失败保留和并发验证。

## 修改白名单

- `src/core/deepseek-models.ts`
- `test/deepseek-settings.test.ts`
- max_modified_files: `2`

## 明确非目标

- 不改 UI、派发、workers、roster、模型选择、推理强度或价格。
- 不读取真实凭据、不联网、不提交、不 push。
- 不新增定时器或后台自动刷新，不改变已有模型解析语义。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/deepseek-settings.test.ts`
2. `npm run typecheck`
3. 替身证明成功结果跨读取保持，失败保留成功列表与时间并标陈旧；不同规范化地址/协议隔离，临时密钥结果不覆盖已保存连接权威目录。
4. 并发刷新以请求序号或等价机制防止较早请求晚返回覆盖新结果，JSON 不损坏；缓存不包含密钥、认证头或密钥派生指纹。

## 禁止验证

- 不运行全量测试、UI、build、e2e；不请求真实模型列表或收费推理。
- 已通过的命令仅在覆盖代码再次变动后重跑。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `prompt_soft`
- soft_timebox_minutes: `30`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

- 需要修改白名单外文件、扩大到 UI/派发或保存真实密钥时停止并报告。
- 不能兼容原查询返回类型或无法避免临时凭据污染目录时返回检查点。
- 本轮报告必须列明剩余的管理模型接线与运行身份冻结；不将 TASK-031 整体标为完成。

## 精简 Implementation Report（固定格式）

- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | runner_limit | context_limit | external_decision | permission | scope_conflict`
- workspace_branch: `[absolute workspace or worktree] @ [branch or detached SHA]`
- changed_files: [paths only]
- completed_scope: [observable work completed]
- remaining_gaps: [specific unfinished work]
- anchors_touched: [symbols/tests only]
- verification: [command → PASS/FAIL/NOT_RUN; latest_code_covered: yes/no]
- active_findings: [finding id → resolved/unresolved]
- scope_or_baseline_notes: [new fact only; no transcript]
