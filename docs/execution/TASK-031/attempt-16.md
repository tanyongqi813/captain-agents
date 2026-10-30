# Execution Capsule — TASK-031 / attempt-16

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `16`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
真实离线窗口证明目录授权保存、重启回显、取消和连接变化撤销，检查最新浅深窄编辑布局。

## 本轮验收切片
- 临时配置/假认证，用XAGENTS_E2E禁用生产后台请求，不点击获取模型；开关默认关闭，取消不写，保存后进程重启仍开启，修改地址时开关禁用且保存撤销，切回不复活。
- 三种布局截图并实际查看；仅证明真实IPC与磁盘窗口流程，不冒称生产后台请求或退出取消生命周期实测。

## 已确认事实（禁止重新推导）
- 15组件6/6、types已过；main e2eHidden不创建catalogLoop，授权专用桥仍注册。
- 现有Electron定向文件使用playwright-core与临时context，仓库已有依赖；不安装。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `test/e2e/deepseek-model-prices.ts` — launch/edit/截图范式。
2. `app/main/index.ts` — e2eHidden及专门授权IPC，只读。
3. `app/renderer/components/DeepseekSettings.tsx` — Switch与submit，只读。

## 修改白名单
- `test/e2e/deepseek-catalog-consent.ts`
- `output/playwright/task-031-attempt-16-light.png`
- `output/playwright/task-031-attempt-16-dark.png`
- `output/playwright/task-031-attempt-16-narrow.png`
- max_modified_files: `4`

## 明确非目标
- 不改生产逻辑、不触真实密钥或网络；不把切片当整任务通过。

## 定向验证（最多 5 条）
1. `npm run build`
2. `node --test --test-timeout=120000 test/e2e/deepseek-catalog-consent.ts`
3. `npm run typecheck`
4. `git diff --check`

## 禁止验证
- 不跑全量核心/UI/e2e，不重复旧授权核心与组件测试。隔离启动失败可申请同命令明确临时目录窗口权限，不算源码纠偏。

## 已知基线失败
- Electron在隔离内可能Process failed to launch，须按实际结果记录。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 需要生产修正或越白名单；一次纠偏仍失败保存检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / permission / scope_conflict / soft_budget
- workspace_branch: 路径及分支
- changed_files: 路径
- completed_scope: 窗口授权
- remaining_gaps: 整项集成
- anchors_touched: 定向窗口测试
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 隔离与真实窗口证明边界
