# Execution Capsule — TASK-035 / attempt-06

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `06`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
最新安全余量和剩余状态真实窗口验收。

## 本轮验收切片
- 临时目录启动Electron，安全余量0.5保存，关闭进程后重开回显；剩余按保存预算显示而非草稿。
- 浅/深/窄窗口截图实际查看；不触发模型获取或真实凭据。

## 已确认事实（禁止重新推导）
- 04核心17/17、05编辑9/9及types通过，不重跑。
- 既有02窗口可经明确工具审批在临时用户目录运行；本批沿用仓库既有Node:test用例，不引入测试框架。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `test/e2e/deepseek-money.ts` — 真实窗口用例。
2. `app/renderer/components/DeepseekSettings.tsx` — 安全余量及剩余文案，只读。

## 修改白名单
- `test/e2e/deepseek-money.ts`
- `output/playwright/task-035-attempt-06-light.png`
- `output/playwright/task-035-attempt-06-dark.png`
- `output/playwright/task-035-attempt-06-narrow.png`
- max_modified_files: `4`

## 明确非目标
- 不改生产代码或运行权限，不真实探测/收费，不提交。

## 定向验证（最多 5 条）
1. `npm run build`
2. `node --test --test-timeout=120000 test/e2e/deepseek-money.ts`
3. `git diff --check`

## 禁止验证
- 不重跑全量、types、UI、已过核心；不得用旧图冒充最新视觉。

## 已知基线失败
- 隔离启动Electron可能Process failed to launch，实际失败后申请限定本用例的工具审批。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 真实网络/密钥需求或审批拒绝、一次纠偏仍失败则回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / permission
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 整项剩余
- anchors_touched: 测试
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
