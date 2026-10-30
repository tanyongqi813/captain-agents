# Execution Capsule — TASK-037 / attempt-02
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-037.md`
- task_id: `TASK-037`
- attempt: `02`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
把01观察核心接入LiveProgress只读影子采集，不改停机/任务持久化语义。
## 本轮验收切片
- 每次最多读256KiB/UTF8流式解码，积压明确；EOF仅解析完整末行，不能自动结束工具。
- 每个LiveProgress实例随机盐，仅Cursor；从最新任务sleep记录算观察起点之后累计休眠。IO失败/截断替换保守不可用，影子错误不影响旧采集。
- getter只脱敏快照，不存日志/盐到job，不新增计时器/启动/网络。
## 已确认事实（禁止重新推导）
- live历史3处增量为promptBytes/dispatchTrace，必须保持；activity旧finish自动闭合不能复用。
- 01八项通过，036正式依赖未过；无机器派发授权。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/live.ts` — sample/apply。
2. `src/core/execution-progress.ts` — CursorProgressStream。
3. `src/core/duration.ts` — sleptSeconds，只读。
## 修改白名单
- `src/core/live.ts`
- `src/core/execution-progress.ts`
- `test/execution-progress-observer.test.ts`
- max_modified_files: `3`
## 明确非目标
- 不修改activity/runner/Job类型/费用/旧总时限和强停，不重写历史trace。
## 定向验证（最多 5 条）
1. `node --test test/execution-progress-observer.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不重复01不受影响核心/036/build/UI/全量或真实模型。
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
- dirty来源不清/真实并发或超白名单保存检查点。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget
- workspace_branch: 当前路径分支
- changed_files: 白名单
- completed_scope: 影子观察
- remaining_gaps: 整体验收
- anchors_touched: sample/observer
- verification: PASS/FAIL/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 无强停
