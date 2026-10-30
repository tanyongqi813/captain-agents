# Execution Capsule — TASK-031 / attempt-17

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `17`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
仅修自动目录授权截图定位，补完整标题、说明、开关同屏视觉证据。

## 本轮验收切片
- 定位完整自动授权行而非仅toggle，截图前断言标题与开关在固定头部下、固定尾部上；浅深900窄均实际查看。
- 新17截图不覆盖16历史图，保留已过真实授权流程断言。

## 已确认事实（禁止重新推导）
- 最新build通过，16真实窗口1/1证明取消/保存重启/换地址撤销；外层设置已打开不能再次点击设置。
- XAGENTS_E2E禁用后台catalogLoop，临时假认证，不点击模型获取；不冒称生产后台生命周期实测。

## Active findings
- `F-13`: toggle滚动导致授权标题被粘性头部遮挡，截图不完整。

## 源码锚点（最多 5 个）
1. `test/e2e/deepseek-catalog-consent.ts` — 截图循环。
2. `app/renderer/components/DeepseekSettings.tsx` — 自动目录行结构，只读。

## 修改白名单
- `test/e2e/deepseek-catalog-consent.ts`
- `output/playwright/task-031-attempt-17-light.png`
- `output/playwright/task-031-attempt-17-dark.png`
- `output/playwright/task-031-attempt-17-narrow.png`
- max_modified_files: `4`

## 明确非目标
- 不改生产、不覆盖旧截图、不重写已过功能断言、不真实联网。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/e2e/deepseek-catalog-consent.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重复build（生产未改）、旧组件/核心或全量测试；只因新截图需要重跑该窗口用例。

## 已知基线失败
- 隔离Electron启动失败；按已批准的同命令明确范围工具审批启动临时窗口。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `10`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 需要生产修正或一次纠偏仍失败则回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / permission / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 截图修正
- remaining_gaps: 整项集成
- anchors_touched: 截图循环
- verification: 结果与latest_code_covered
- active_findings: F-13
- scope_or_baseline_notes: 视觉和功能证据边界
