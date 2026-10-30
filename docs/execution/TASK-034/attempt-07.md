# Execution Capsule — TASK-034 / attempt-07
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-034.md`
- task_id: `TASK-034`
- attempt: `07`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
F-02费用停止专用本机通知，复用已有开关和持久去重。
## 本轮验收切片
- buildView从当前round money-stop-N.json只读投影moneyStopAt，可选字段不影响旧记录；仅DS及有效证据时间/冻结组，坏/缺证据不猜、不复制reason/日志或密钥。
- notices只为终态且有该标记的任务发固定说明，指向原任务，key含任务/证据时间；默认done/普通出错/手动停止不新增通知。
- tracker开关/首次初始化不补发/重启去重保持；不发真实系统通知，用替身验证。
## 已确认事实（禁止重新推导）
- 05 runner产生证据；现ViewJob没有标记且普通错误不发通知，此为034已规划的费用停止例外。
- 06看管17/17已过，生产看管/账本保持不动。
## Active findings
- F-02: 缺少费用停止专用通知接线。
## 源码锚点（最多 5 个）
1. `src/core/view.ts` — rows/publicJob。
2. `src/core/view-types.ts` — ViewJob。
3. `app/main/notifications.ts` — notices/tracker。
4. `test/chat-view.test.ts` — tracker替身参考。
## 修改白名单
- `src/core/view.ts`
- `src/core/view-types.ts`
- `app/main/notifications.ts`
- `test/money-budget-notices.test.ts`
- `docs/ui-spec.md`
- max_modified_files: `5`
## 明确非目标
- 不改runner/账本，不飞书/网络/真实系统通知，不全局开启普通错误通知。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/money-budget-notices.test.ts test/view-state.test.ts test/chat-view.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不旧金额/暂停/全量/UI/build/e2e或真实通知权限。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `8`
- soft_call_limit: `9`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 超白名单/需新权限/一次纠偏仍失败保存检查点。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: F-02
- remaining_gaps: 发布
- anchors_touched: view/notices
- verification: 结果与latest_code_covered
- active_findings: F-02
- scope_or_baseline_notes: 边界
