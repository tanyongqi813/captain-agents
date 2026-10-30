# Execution Capsule — TASK-038 / attempt-01
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
独立纯看管判定消费037真实快照，默认关闭，不接任何实际停止。
## 本轮验收切片
- 三原因预警首事件等待/读未完/重复读取，固定宽限；只有新有效进展清预警，错误增长不取消。重复读仅预警不能仅按次数停。
- 明确策略/阈值/校准引用才可生成job+round绑定的停止计划；无校准只能预警，null默认完全关闭。计划不是权限、不含PID。
- 数据缺失/积压/不完整暂停决策，恢复重算连续宽限；已退出零计划，重复请求幂等，睡眠沿037awake时钟扣除；不影响其他job。
## 已确认事实（禁止重新推导）
- 03701–03只读快照稳定且业务功能已选证据齐，正式依赖不解除；90/180秒只是候选，不能拿旧budget改下限。
- runner/job/live历史dirty保持，不改生产停机。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/execution-progress.ts` — ProgressState/progressEvidence。
2. `src/core/budget.ts` — 原budgetTick只读。
## 修改白名单
- `src/core/execution-guard.ts`
- `test/execution-guard.test.ts`
- max_modified_files: `2`
## 明确非目标
- 无IO/进程/真实密钥/网络/真实阈值授权，无生产消费者/自动续跑，不改runner/预算/安全模板。
## 定向验证（最多 5 条）
1. `node --test test/execution-guard.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不重复037/036/其他已过核心/UI/build/e2e/全量。
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
- 超白名单/需实际阈值产品决定时仅停启用边界。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget
- workspace_branch: 当前路径分支
- changed_files: 白名单
- completed_scope: 纯判定
- remaining_gaps: 实际接线/验收
- anchors_touched: guardTick
- verification: PASS/FAIL/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 未启用强停
