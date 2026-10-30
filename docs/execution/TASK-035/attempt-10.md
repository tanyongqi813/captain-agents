# Execution Capsule — TASK-035 / attempt-10

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `10`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
实际ID价表编辑的真实窗口与磁盘重启验收。

## 本轮验收切片
- 临时Endpoint有显式价表且legacy价格不同，窗口显示表价；编辑后实际设置对应项改变、legacy/其他模型不变，关闭Electron重启回显。
- 浅/深/900窄截图逐张实际查看；不点获取模型或使用真实密钥。

## 已确认事实（禁止重新推导）
- 09组件16/16、types通过，不重跑；仓库现有Node:test/Electron用例可经明确范围审批离线运行，沿用不换框架。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `test/e2e/deepseek-money.ts` — 现有离线窗口模式，只读。
2. `app/renderer/components/DeepseekSettings.tsx` — 价表编辑，只读。

## 修改白名单
- `test/e2e/deepseek-model-prices.ts`
- `output/playwright/task-035-attempt-10-light.png`
- `output/playwright/task-035-attempt-10-dark.png`
- `output/playwright/task-035-attempt-10-narrow.png`
- max_modified_files: `4`

## 明确非目标
- 不改生产代码、旧截图或旧窗口测试；不收费/联网/安装/提交。

## 定向验证（最多 5 条）
1. `npm run build`
2. `node --test --test-timeout=120000 test/e2e/deepseek-model-prices.ts`
3. `git diff --check`

## 禁止验证
- 不重复types/UI/核心或全量，真实API禁止。

## 已知基线失败
- 隔离启动可能Process failed to launch；实际失败后仅对此离线用例申请明确工具审批。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 权限实际拒绝、需真实网络/凭据或一次纠偏仍失败时回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / permission
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 整项验收
- anchors_touched: 测试
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
