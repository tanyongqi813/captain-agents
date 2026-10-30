# Execution Capsule — TASK-031 / attempt-07

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `07`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
编辑连接窗口展示既有目录最后成功时间与陈旧状态，不额外查询。

## 本轮验收切片
- 从现有 view.models 的 DeepSeek 通道透传时间/错误，不新增 IPC、网络或读密钥。
- 明确标注已保存连接的上次目录；无时间表示尚无成功记录，不能用打开窗口时间冒充。
- 编辑地址/协议或填写临时密钥后不沿用旧连接核验提示；失败仍可看到历史目录状态。

## 已确认事实（禁止重新推导）
- WorkerSettings 已收到 View，DeepseekSettings 尚未收到通道 at/error。
- 当前修改均可追溯既有 first-usable 连接编辑实现，仅加只读提示，不重写费用、推理强度和模型获取。
- 自动刷新调度尚缺，本批不新增；旧通过响应/派发/展示切片不重测。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/renderer/components/WorkerSettings.tsx` — DeepseekSettings props。
2. `app/renderer/components/DeepseekSettings.tsx` — 模型目录区。
3. `docs/ui-spec.md` — 编辑 DeepSeek 规范。

## 修改白名单
- `app/renderer/components/WorkerSettings.tsx`
- `app/renderer/components/DeepseekSettings.tsx`
- `test/ui/deepseek-catalog-status.test.tsx`
- `docs/ui-spec.md`
- max_modified_files: `4`

## 明确非目标
- 不修改 IPC、核心目录、自动刷新、费用/能力或选手；不新加网络/密钥权限，不提交夹带未审差异。

## 定向验证（最多 5 条）
1. `npm run test:ui -- test/ui/deepseek-catalog-status.test.tsx test/ui/deepseek-money.test.tsx`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不运行全量/build/e2e/真实接口；截图验收需桌面环境，未执行则明确保留，不宣称整任务通过。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 同文件来源不明修改或需新增权限即停；最多一次纠偏。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 只读状态
- remaining_gaps: 验收缺口
- anchors_touched: 符号
- verification: 命令及 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
