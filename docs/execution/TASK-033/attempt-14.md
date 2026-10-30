# Execution Capsule — TASK-033 / attempt-14
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-033.md`
- task_id: `TASK-033`
- attempt: `14`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
已配置活动组选择/预算价格编辑真实窗口持久化和最新视觉验收。
## 本轮验收切片
- 临时XAGENTS_HOME、Electron用户目录、假配置，XAGENTS_E2E=1禁后台catalogLoop/消费；不点获取模型、不使用真实凭据。
- 选择B取消不写；重新选择B改预算/实际ID单价保存，其他组/default不变，进程关闭重启仍B及新值。
- 新浅深900窄截图，组选择/说明/预算行在固定头尾内，坐标断言并实际查看；不借历史图。
## 已确认事实（禁止重新推导）
- 12/13核心/UI/type已有证据，生产组件变更后需一次build和新窗口，不重复旧核心/UI。
- 已有test/e2e/deepseek-model-prices.ts离线Electron模式可复用；本批使用既有playwright-core，非新增框架/安装。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `test/e2e/deepseek-model-prices.ts` — launch/edit/截图。
2. `app/renderer/components/DeepseekSettings.tsx` — 组选择及预算输入。
## 修改白名单
- `test/e2e/deepseek-active-group.ts`
- max_modified_files: `1`
## 明确非目标
- 不改生产/权限，不新增组创建，不真实调用，不重跑旧测试。
## 定向验证（最多 5 条）
1. `npm run build`
2. `node --test --test-timeout=120000 test/e2e/deepseek-active-group.ts`
3. `npm run typecheck`
4. `git diff --check`
## 禁止验证
- 不全量/核心/UI、真实密钥/系统存储访问；启动受限只申请本临时测试明确审批。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `14`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 一次纠偏仍失败、需生产修复或权限拒绝保存检查点。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / permission / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 窗口持久化视觉
- remaining_gaps: 整项
- anchors_touched: 测试
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 边界

