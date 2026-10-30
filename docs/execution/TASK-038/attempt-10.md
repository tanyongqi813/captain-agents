# Execution Capsule — TASK-038 / attempt-10
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `10`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
真实新建看管消费子进程中断后，以独立冷进程证明拒绝恢复且检查点/停止标记原样保留，无新worker/费用。
## 本轮验收切片
- 前后各独立Node进程，前者持久预警或停止计划后只向自身SIGKILL；后者新消费者sample拒绝旧记录，不重置时间/计划。
- 两阶段检查点、job及假账本字节不变，假worker启动标记始终缺失，job总数不增；不能把本用例当真实模型或整个runner崩溃/重启。
- 不新增自动恢复功能，沿当前拒绝策略。平台不支持自杀信号则明确跳过对应证据。
## 已确认事实（禁止重新推导）
- 02持久记录来自单次会话，冷消费者不认领；09多job安全已过不重测。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/execution-guard-consumer.ts` — established/expected拒绝。
2. `test/execution-guard-consumer.test.ts` — fixture数据流，只读。
## 修改白名单
- `test/execution-guard-recovery.test.ts`
- max_modified_files: `1`
## 明确非目标
- 不改生产/runner/真实账本/自动重启或真实登录联网模型，不重跑01–09。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=20000 test/execution-guard-recovery.test.ts`
2. `git diff --check`
## 禁止验证
- 不全量/types/build/UI/旧通过项。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `7`
- soft_call_limit: `8`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 若拒绝后仍写数据/启动子worker则保存真实finding，生产修改另合同。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 当前路径分支
- changed_files: 新测试
- completed_scope: 中断拒绝恢复
- remaining_gaps: 整项矩阵/启用发布
- anchors_touched: test
- verification: PASS/FAIL/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 不是整个runner或OS休眠
