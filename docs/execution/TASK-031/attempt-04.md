# Execution Capsule — TASK-031 / attempt-04

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `04`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
已保存连接权威目录确认下线的模型，即使后续刷新失败也不能重新派发。

## 本轮验收切片
- Pro/Flash 缺失在新鲜及陈旧权威目录均启动前拒绝，零注册、零副本、零选手启动。
- 刷新失败保留最后成功目录的下线事实；不静默换模型、不改价格或历史任务身份。
- 未有权威目录的旧安装不在本轮新增强制联网或收费探测。

## 已确认事实（禁止重新推导）
- dispatch 当前仅在 accountVerified 且 !stale 时判断 models.includes，刷新失败会跳过原拒绝。
- 刷新失败保留列表并标 stale；临时密钥目录不属于权威目录。
- 自动刷新与 UI 状态仍属 TASK-031 剩余切片，本轮不宣称整体完成。

## Active findings
- none；本轮补已知启动边界。

## 源码锚点（最多 5 个）
1. `src/core/dispatch.ts` — dispatch 的目录门槛，在登记/副本/启动之前。
2. `src/core/deepseek-models.ts` — refreshDeepseekCatalog/readDeepseekCatalog；只读复用。
3. `test/deepseek-settings.test.ts` — 模型目录替身；只运行不改。

## 修改白名单
- `src/core/dispatch.ts`
- `test/deepseek-dispatch.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不改模型身份、推理档位、凭据、网络参数、额度策略或 UI；不真实调用或付费。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-dispatch.test.ts test/deepseek-settings.test.ts test/plan-dispatch.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量/UI/build/e2e/真实接口；已通过命令无新代码不重复。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `25`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 超白名单或需真实账户、放宽网络与隔离时回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict / soft_budget
- workspace_branch: 绝对路径及分支
- changed_files: 路径
- completed_scope: 本轮内容
- remaining_gaps: 整任务缺口
- anchors_touched: 符号
- verification: 命令结果及 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实

