# Execution Capsule — TASK-018 / attempt-13

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `13`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
在原副本补真实成本页保存、关闭放弃草稿、旧草稿冲突与窗口截图，不整合主仓。

## 本轮验收切片
- 临时目录真实IPC保存后关闭进程重开；旧基线冲突保留草稿和新磁盘值；浅深窄编辑截图实际查看。

## 已确认事实（禁止重新推导）
- 主仓保存合同/Review至12，副本Task旧文档停留05，主仓合同为当前权威。
- 副本costSave接收完整资料和读取基线，CAS冲突保留草稿；已过核心不重测。
- 副本node_modules指向主仓；构建输出在副本，不替代主仓发布证据。
- 主仓dispatch/job/runner仍有多任务重叠，不整文件复制。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/renderer/components/CostSettings.tsx` — save与名称字段。
2. `app/main/cost-settings.ts` — status/save。
3. `test/e2e/smoke.ts` — Electron隔离启动。
4. `test/helpers.ts` — context。
5. `test/ui/settings-cost.test.tsx` — 成本夹具。

## 修改白名单
- `test/e2e/cost-settings.ts`
- max_modified_files: `1`

## 明确非目标
- 不改生产/UI规范或旧通过测试；不真实联网、读密钥、安装、提交或合并。

## 定向验证（最多 5 条）
1. `npm run build`
2. `node --test --test-timeout=60000 test/e2e/cost-settings.ts`
3. `npm run typecheck`
4. `git diff --check`

## 禁止验证
- 不全量核心/UI/verify；不重复其他任务窗口。

## 已知基线失败
- 隔离Electron通常Process failed to launch，按临时用户目录范围审批，不改安全设置。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `18`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 生产缺陷或并发归属冲突；一轮纠偏后仍失败，保存检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 原副本分支
- changed_files: 路径
- completed_scope: 可验证窗口行为
- remaining_gaps: 整合与发布
- anchors_touched: 测试
- verification: 结果及latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 真实边界
