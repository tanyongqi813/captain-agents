# Execution Capsule — TASK-018 / attempt-05

- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `05`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `Low`
- required_planning_lookup: `none`
- capsule_schema: `2`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
仅修 F-06：成本资料中可选字段能够清空，并在保存请求中真正移除。

## 本轮验收切片
- 已填每日尝试数、同时运行数、记账时区、次数套餐剩余次数可清空；界面不回弹，保存 payload 不再含对应属性。
- 数字明确填写 0 时保留 0；清空与 0 的语义不同。
- 其他已填字段、记录时间及原有保存成功/失败行为保留。

## 已确认事实（禁止重新推导）
- localRow 三处及 allowance.count 使用展开旧 base 后按条件附加字段；空值分支 {} 不会删除旧属性。
- 修正 onChange 删除相应可选属性即可，不需要修改核心类型、桥或规则。
- F-01/F-03/F-04 已通过，保持原代码；F-02/F-05/F-07 后续另行处理。

## Active findings
- `F-06`：可选输入清空后仍保留原属性。

## 源码锚点（最多 5 个）
1. `app/renderer/components/CostSettings.tsx` — `localRow`：每日尝试数、同时运行数、时区处理。
2. `app/renderer/components/CostSettings.tsx` — 次数套餐“剩余次数” onChange。
3. `test/ui/settings-cost.test.tsx` — `setup` / `seedSettings` / `costSave` 替身：覆盖有值→清空→保存及明确 0。

## 修改白名单
- `app/renderer/components/CostSettings.tsx`
- `test/ui/settings-cost.test.tsx`
- max_modified_files: `2`

## 明确非目标
- 不改字段布局、文案、样式和设置契约，不动核心预算、IPC、文档；不扩修其他发现；不提交、不 push、不 stash。

## 定向验证（最多 5 条）
1. `npm run test:ui -- test/ui/settings-cost.test.tsx` — 原有测试及四个字段清空、保存属性删除、明确 0、其他字段保留的回归通过。

## 禁止验证
- 不跑 typecheck、核心测试、全量、build、e2e；不启动真实选手或重复已通过且未受修改影响的命令。

## 已知基线失败
- none confirmed。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `none`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
- 以上为软约束，不声称运行器强制停止。

## 停止条件
- 需要白名单外改动，或一次实现加一次纠偏仍未完成：保留改动，报告检查点后停止。

## 精简 Implementation Report（固定格式）
- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | scope_conflict | external_decision`
- workspace_branch: 绝对路径与分支
- changed_files: 路径
- completed_scope: 完成项
- remaining_gaps: 未完成点
- anchors_touched: 函数或测试名
- verification: 命令 → PASS/FAIL/NOT_RUN；latest_code_covered: yes/no
- active_findings: F-06 → resolved/unresolved
- scope_or_baseline_notes: 新增事实，报告不超过 400 字。
