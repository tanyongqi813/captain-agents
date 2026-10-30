# Execution Capsule — TASK-038 / attempt-08
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `08`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
02离线消费者停止后实际回交已有autopilot受控owner入口；普通job仅检查点，不伪造run。
## 本轮验收切片
- consumer新增显式handoff调用；仍仅offline_fixture，默认零IO，不开生产timer/真实策略。
- 任务必须本轮已停止/有stopRequested/sidecar固定计划匹配，假命令及环境吻合；action token、当前执行node与attempt jobs归属核对。
- transition带token并advance owner_requested固定脱敏说明，幂等仅认同一任务/轮次/原因及对应attempt；过期token/轮次/其他run拒绝。普通job仅返回检查点，不写decision。
## 已确认事实（禁止重新推导）
- F-05在07修复2/2通过不重测；autopilot.ts已dirty不修改，用其transition/advance及严格登记校验。
- job.autopilot={run,token}，transition先检token再清action，故callback按当前node/attempt归属复核，不能依赖已删除action。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/execution-guard-consumer.ts` — sample/新handoff。
2. `src/core/autopilot.ts` — readAutopilot/transition/advance，只读。
3. `src/core/job.ts` — readJob，只读。
## 修改白名单
- `src/core/execution-guard-handoff.ts`
- `src/core/execution-guard-consumer.ts`
- `test/execution-guard-handoff.test.ts`
- max_modified_files: `3`
## 明确非目标
- 不改autopilot状态机/028规划/旧模板或生产启用，不诊断AI/派活/真实通知/联网/密钥；不宣称冷恢复已实现。
## 定向验证（最多 5 条）
1. `node --test test/execution-guard-handoff.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不重复01–07/037/全量/UI/build/真实通道。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `18`
- soft_call_limit: `18`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需修改状态机/新产品权限或超白名单保存检查点。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 当前路径分支
- changed_files: 白名单
- completed_scope: 受控owner回交
- remaining_gaps: 崩溃/启用/发布
- anchors_touched: handoff
- verification: PASS/FAIL/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 无真实调用
