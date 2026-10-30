# Execution Capsule — TASK-035 / attempt-12
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `12`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
11旧价绑定跨组未知的真实窗口/磁盘重启与最新浅深窄视觉。
## 本轮验收切片
- 临时XAGENTS_HOME/userData，E2E禁后台，不认证/请求；保留旧账文件逐字。
- 全局Pro改ID，选原未编辑legacy组新价未知不借11；填5/0/6保存，旧Flash价13/default表不变，重启新绑定和价保持。
- 新三图展示当前Pro实际ID/未知/空白，坐标在固定头尾内，实际查看；旧图不覆盖。
## 已确认事实（禁止重新推导）
- 11核心6/UI18/types已过不重跑；UI及共享main改变后build一次，沿用现有Node:test/Electron离线模式，不加框架。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `test/e2e/deepseek-model-prices.ts` — launch/edit/截图模式。
2. `app/renderer/components/DeepseekSettings.tsx` — legacy未知显示。
## 修改白名单
- `test/e2e/deepseek-legacy-binding.ts`
- `output/playwright/task-035-attempt-12-light.png`
- `output/playwright/task-035-attempt-12-dark.png`
- `output/playwright/task-035-attempt-12-narrow.png`
- max_modified_files: `4`
## 明确非目标
- 不生产修改/旧截图/真实请求/认证/安装/提交。
## 定向验证（最多 5 条）
1. `npm run build`
2. `node --test --test-timeout=120000 test/e2e/deepseek-legacy-binding.ts`
3. `npm run typecheck`
4. `git diff --check`
## 禁止验证
- 不核心/UI/全量或系统存储。
## 已知基线失败
- 隔离Electron启动已知受限，需明确此临时用例审批。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `10`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 一次纠偏仍失败/权限拒绝保存partial。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / permission / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 窗口
- remaining_gaps: 整项
- anchors_touched: 测试
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界
