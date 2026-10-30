# Execution Capsule — TASK-032 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-032.md`
- task_id: `TASK-032`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
实际模型能力声明解析与新派发前显式档位核验同批生效。

## 本轮验收切片
- 可选reasoningCapabilities绑定规范化baseUrl/wireApi，models按实际ID保存high布尔、source=user、ISO updatedAt，最多128项，深复制/严格拒绝非法；无可信导入器不接受metadata。
- default不需要声明；旧缺字段/high保持可读不猜支持，显式未知/不支持/身份错配启动前零注册拒绝。存在模型目录不能证明high。
- 原下线门槛先检查，默认模式与非DeepSeek行为保持；不改启动模板。

## 已确认事实（禁止重新推导）
- 03119功能验收80/80与UI17/17，保存身份/实际ID接口稳定；依赖未正式通过，只在032 IN_PROGRESS独立实施，无READY机器授权。
- workers现已在default省略参数；旧缺模式等同显式，需保留配置但不放行未知能力。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/deepseek-settings.ts` — Endpoint严格解析。
2. `src/core/dispatch.ts` — 实际ID映射与目录门槛、注册前。
3. `test/deepseek-dispatch.test.ts` — 目录及零注册拒绝范式。

## 修改白名单
- `src/core/deepseek-settings.ts`
- `src/core/dispatch.ts`
- `test/deepseek-reasoning.test.ts`
- max_modified_files: `3`

## 明确非目标
- 不改workers/roster/runner/UI、不做真实探测；续接复核和界面确认后批，不冒称整项通过。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-reasoning.test.ts test/deepseek-dispatch.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不全量/UI/build/e2e/真实通道，不重复031已过整个套件。

## 已知基线失败
- 旧成功派发夹具若依赖未核验high，后续集成须显式改用default或登记假能力，不能添加fake绕过。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 来源不清并发/越白名单、一次纠偏仍失败保存检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict / soft_budget
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 能力解析和派发拒绝
- remaining_gaps: 续接/界面/集成
- anchors_touched: 符号
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 行为兼容说明
