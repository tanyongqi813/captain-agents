# Execution Capsule — TASK-032 / attempt-02

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-032.md`
- task_id: `TASK-032`
- attempt: `02`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
真正spawn前复核冻结推理能力与实际命令，覆盖旧队列和续接，不改参数模板。

## 本轮验收切片
- runner在保存命令/续接变形之后、打开日志及spawn之前调用独立校验；仅DeepSeek，缺冻结连接或实际模型不匹配拒绝，不借当前配置补能力。
- 冻结default命令不得带强度覆盖；显式high须冻结能力支持、effort为high且唯一规范覆盖为high。命令实际-m/--model必须唯一等于冻结ID，歧义拒绝不重写。
- 新增离线临时fake验证拒绝无worker、报告照常保存；default/已确认high及不收费续接可运行，当前另一个连接声明不影响冻结判断。

## 已确认事实（禁止重新推导）
- 01能力解析和新派发门槛4/4通过；runner使用保存command，续接只resumeCommand变形，故需末端门槛。
- 费用续接禁止及报告/patch独立收尾保持，不放宽fake绕过。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/runner.ts` — runWorker命令选择及finally。
2. `src/core/workers.ts` — resumeCommand、command参数，只读。
3. `src/core/deepseek-settings.ts` — assertDeepseekReasoning，只读。

## 修改白名单
- `src/core/deepseek-reasoning-runtime.ts`
- `src/core/runner.ts`
- `test/deepseek-reasoning-runtime.test.ts`
- max_modified_files: `3`

## 明确非目标
- 不改workers参数/隔离、费用/配置/UI，不跑真实模型或读取真实认证。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-reasoning-runtime.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重复01/031全套、全量/UI/build/e2e或付费通道。

## 已知基线失败
- 其他旧成功派发夹具未确认high的兼容调整另批，不为其放宽新门槛。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 生产来源冲突/越白名单，或一次纠偏仍失败保存真实检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict / soft_budget
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 实际启动校验
- remaining_gaps: UI及集成
- anchors_touched: 符号
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实与边界
