# Execution Capsule — TASK-035 / attempt-02

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-035.md`
- task_id: `TASK-035`
- attempt: `02`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
最新费用编辑真实窗口验证，补缓存写入价保存/进程重开及浅深窄截图。

## 本轮验收切片
- 使用现有 Electron 离线测试、临时登记处及假选手；Pro 零价、Flash 独立价保存，重启应用后回显。
- 截图覆盖浅/深/窄窗口的新价格字段，负责人查看实际图片；未成功打开窗口不能说通过。
- 未点击获取模型、不发推理/真实请求，不读取实际用户密钥。

## 已确认事实（禁止重新推导）
- attempt-01 已完成组件与单元测试，未重复；已有定向窗口文件可扩展，不新增依赖或安装。
- 构建需更新以包含最新 UI；测试在 XAGENTS_E2E 与临时用户目录运行。
- 隔离可能拦 Electron，先实际运行；需要时按明确范围申请，不放宽产品安全规则。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `test/e2e/deepseek-money.ts` — 单项 Electron 测试。
2. `app/renderer/components/DeepseekSettings.tsx` — 新输入，只读。
3. `test/helpers.ts` — context 临时目录，只读。

## 修改白名单
- `test/e2e/deepseek-money.ts`
- max_modified_files: `1`

## 明确非目标
- 不修改产品源码，不安装发布、不真实收费，不接管其他在途实现、不提交历史差异。

## 定向验证（最多 5 条）
1. `npm run build`
2. `node --test --test-timeout=120000 test/e2e/deepseek-money.ts`
3. `git diff --check`

## 禁止验证
- 不重跑全量/types/UI/费用核心；不启动真实模型或访问真实凭据。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 权限拒绝、无法打开桌面或一次纠偏仍失败保留真实检查点；不删除测试以放行。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / permission / soft_budget
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 验收
- remaining_gaps: 未完成项
- anchors_touched: 测试名称
- verification: 结果与 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
