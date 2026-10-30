# Execution Capsule — TASK-028 / attempt-03
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-028.md`
- task_id: `TASK-028`
- attempt: `03`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
接手后先封住不完整事务仍可发布规划并自动续跑的路径，保留现场，不能冒充事务已经完成。
## 本轮验收切片
- publishLeadCorrection 在任何规划写入前明确拒绝；已有和不存在的临时仓库都不创建/改变文件，不返回可续跑 compilation。
- 纯 compileLeadCapsules 保持可用且不落盘。F01–03完整修复仍由后续合同接入，不解除045依赖。
## 已确认事实（禁止重新推导）
- 主人明确确认原执行者停止，授权本会话接手；保留原dirty。
- 原publish锁内依次写三文件，无提交点/恢复/租约，调用方收到结果即可能续跑。
- 本轮是完整实现前的安全止血，不是新事务接口或发布验收。
## Active findings
- `F-01`: 无事务提交/恢复的发布路径可能留下半套规划。
## 源码锚点（最多 5 个）
1. `src/core/lead-capsule.ts` — publishLeadCorrection/compileLeadCapsules。
2. `src/core/lead-runtime.ts` — makeLeadDecision等待发布后才返回。
3. `src/core/autopilot-flow.ts` — 发布失败进入既有fail回交。
## 修改白名单
- `src/core/lead-capsule.ts`
- `test/lead-publication-safety.test.ts`
- max_modified_files: `2`
## 明确非目标
- 不实现租约/Git自动提交/新事务存储；不改flow/engine/旧脏修改，不真实调用或提交push。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=10000 test/lead-publication-safety.test.ts test/lead-capsule.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不全量/UI/build/真实选手，不修改旧测试迁就拒绝。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `14`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需改flow/engine或放宽真实权限即停止并保留检查点。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 当前路径/分支
- changed_files: 两白名单文件
- completed_scope: 不完整发布零写入
- remaining_gaps: F01完整事务/F02租约/F03执行基准
- anchors_touched: publishLeadCorrection
- verification: 命令及latest_code_covered: yes/no
- active_findings: F01–03未完整解决
- scope_or_baseline_notes: 安全切片不是整Task通过
