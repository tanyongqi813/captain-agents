# Execution Capsule — TASK-032 / attempt-04

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-032.md`
- task_id: `TASK-032`
- attempt: `04`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
离线真实窗口确认能力保存重启与最新三种布局。

## 本轮验收切片
- 旧high未知提示、主动确认取消不写、确认后保存关闭进程重启来源时间与模式保持；换模型不借旧能力。
- 浅深900窄截图，确认行完整位于固定头尾内，实际查看；不点模型查询，不启后台，临时目录假选手，无真实认证。

## 已确认事实（禁止重新推导）
- 03组件11/11和types已过；需要最新build覆盖新布局。
- 031窗口已用E2E禁后台及设置打开判断，沿用但不改旧脚本/旧图。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `test/e2e/deepseek-catalog-consent.ts` — 临时启动/设置/固定头尾截图范式。
2. `app/renderer/components/DeepseekSettings.tsx` — reasoningField，只读。

## 修改白名单
- `test/e2e/deepseek-reasoning.ts`
- `output/playwright/task-032-attempt-04-light.png`
- `output/playwright/task-032-attempt-04-dark.png`
- `output/playwright/task-032-attempt-04-narrow.png`
- max_modified_files: `4`

## 明确非目标
- 不改生产，不真实网络/密钥/模型调用，不冒称整项通过。

## 定向验证（最多 5 条）
1. `npm run build`
2. `node --test --test-timeout=120000 test/e2e/deepseek-reasoning.ts`
3. `npm run typecheck`
4. `git diff --check`

## 禁止验证
- 不全量/旧核心/UI，已过03不重复；隔离启动失败走同命令明确工具审批。

## 已知基线失败
- Electron隔离启动可能失败，按实际记录。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 需要生产修复或一次纠偏仍失败保存检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / permission / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 真实窗口
- remaining_gaps: 兼容集成
- anchors_touched: 窗口测试
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 真实窗口证明边界
