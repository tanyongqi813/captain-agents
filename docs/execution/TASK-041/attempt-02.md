# Execution Capsule — TASK-041 / attempt-02

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-041.md`
- task_id: `TASK-041`
- attempt: `02`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
复审已提交 c521d9e 的桌面入口；不修改实现，发现问题则给增量合同。

## 本轮验收切片
核对动态负责人兼容、IPC 受信校验与标准验收入口是否覆盖新增窗口测试。

## 已确认事实（禁止重新推导）
- 原 attempt-01 的通过记录保持原样；本轮为用户要求的追加复审。
- 工作区有历史未提交改动，诊断只用 HEAD 的独立副本。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/renderer/components/Autopilot.tsx` — trusted / reviewerPool。
2. `src/core/roster.ts` — specFor / loadRoster。
3. `package.json` — scripts.test:e2e。

## 修改白名单
- `app/renderer/components/Autopilot.tsx`
- `test/ui/autopilot.test.tsx`
- `package.json`
- max_modified_files: `3`

## 明确非目标
不修实现、不提交或 push；既有通过记录不覆盖，隔离诊断文件不进入主仓库。

## 定向验证（最多 5 条）
1. 隔离 HEAD 中新增动态候选断言，确认问题是否可复现。
2. 比对渲染层冷启动名单和主进程加载动态名单后的受信判定。
3. 读取 HEAD 的 npm run test:e2e 与 verify 脚本，确认发现路径。

## 禁止验证
不调用真实模型，不重跑未变化的既有通过测试，不运行全量验收。

## 已知基线失败
- 无预先确认的新失败。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `30`
- soft_call_limit: `20`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
发现问题只记录证据并规划修正，不自行扩大实施范围。

## 精简 Implementation Report（固定格式）
- outcome: completed | partial | blocked
- handoff: none | checkpoint
- stop_reason: none | scope_conflict
- workspace_branch: 绝对路径与分支
- changed_files: 文件路径
- completed_scope: 已完成范围
- remaining_gaps: 剩余项
- anchors_touched: 符号
- verification: 命令与结果；latest_code_covered: yes/no
- active_findings: finding 编号与状态
- scope_or_baseline_notes: 新事实
