# Execution Capsule — TASK-031 / attempt-19

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `19`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
一次任务级兼容性回归并归档验收矩阵，形成准确整项判断，不继续制造同义功能切片。

## 本轮验收切片
- 在033等共享settings/models/dispatch变化后的最新工作区，合跑目录/身份/派发/展示/授权相关核心与组件一次；记录精确结果并映射三条业务验收。
- 不改生产/旧测试，失败保存真实finding；区分任务级证据、整仓verify和安全整合发布闸门，不伪称后两项通过。

## 已确认事实（禁止重新推导）
- 17完整三图与18真实默认核心链通过，不重复截图/build；本轮复跑属于整项共享接口最终兼容验收，不是触发即重跑。
- 主仓大量历史差异，028他人在途不接管，018仅其副本；无整仓提交。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/deepseek-models.ts` — 目录及受控入口，只读。
2. `src/core/settings.ts` — 保存授权与模型设置，只读。
3. `src/core/dispatch.ts` — 身份冻结及模型门槛，只读。
4. `test/deepseek-catalog-integration.test.ts` — 真实核心链，只读。

## 修改白名单
- `docs/implementation/TASK-031-acceptance.md`
- max_modified_files: `1`

## 明确非目标
- 不修白名单外生产/测试，不真实请求、密钥或收费，不改既有安全权限。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-settings.test.ts test/deepseek-model-response.test.ts test/deepseek-catalog-view.test.ts test/deepseek-dispatch.test.ts test/deepseek-credentials.test.ts test/deepseek-catalog-schedule.test.ts test/deepseek-catalog-consent.test.ts test/deepseek-catalog-authorized.test.ts test/deepseek-catalog-refresh.test.ts test/deepseek-catalog-loop.test.ts test/deepseek-catalog-bridge.test.ts test/deepseek-catalog-integration.test.ts test/models.test.ts test/plan-dispatch.test.ts`
2. `npm run test:ui -- test/ui/deepseek-catalog-consent.test.tsx test/ui/deepseek-catalog-status.test.tsx test/ui/settings-models.test.tsx`
3. `git diff --check`

## 禁止验证
- 不跑整仓verify/全量核心/UI、build或系统安全存储窗口；最新types18通过且代码未变不重复。

## 已知基线失败
- none confirmed for this selection

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 有失败则报告精确范围及新合同建议，不越白名单修复。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict / soft_budget
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 验收矩阵
- remaining_gaps: 整仓及整合
- anchors_touched: none
- verification: 精确结果与latest_code_covered
- active_findings: none或发现项
- scope_or_baseline_notes: 验收边界
