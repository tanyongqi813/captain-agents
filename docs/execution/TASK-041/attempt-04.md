# Execution Capsule — TASK-041 / attempt-04

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-041.md`
- task_id: `TASK-041`
- attempt: `04`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
完成 F-02 的独立标准验收入口：增加新窗口用例，并将旧冒烟测试的任务夹具升级到共享契约。

## 本轮验收切片
候选提交不含未提交收费/界面代码时，标准 test:e2e 能发现并通过新旧窗口用例。

## 已确认事实（禁止重新推导）
- F-01 实现及新增动态模型测试已通过，不重改。
- test/helpers.ts 已有 upgradeAutopilotFixture；旧 smoke 的无人看守夹具缺这一步，仍是六列且没有当前 Capsule。
- smoke 里另有收费界面定位调整，不属于本轮，不能混入提交。

## Active findings
- `F-02`: 接入标准窗口入口并迁移旧夹具，保留已通过新流程行为。

## 源码锚点（最多 5 个）
1. `package.json` — test:e2e / verify。
2. `test/e2e/smoke.ts` — 无人看守窗口验收的仓库夹具。
3. `test/helpers.ts` — upgradeAutopilotFixture（只复用，不修改）。

## 修改白名单
- `package.json`
- `test/e2e/smoke.ts`
- max_modified_files: `2`

## 明确非目标
不改主进程、运行协议、权限、费用或界面。保留 attempt-03 已接受的动态筛选及测试，不覆盖同文件其他历史改动。

## 定向验证（最多 5 条）
1. `npm run build && npm run test:e2e` — 独立候选快照中标准入口全部通过。
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
不跑全量核心/UI；不使用真实账户、模型，不单独启动收费调用。

## 已知基线失败
- 旧 smoke 未升级任务夹具，与 readyTask 的共享契约要求不兼容，须在提交快照内补齐。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `25`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
如需修改运行行为或收费界面，停止并报告，不扩大范围。

## 精简 Implementation Report（固定格式）
- outcome: completed | partial | blocked
- handoff: none | checkpoint
- stop_reason: none | scope_conflict
- workspace_branch: 绝对路径与分支
- changed_files: 路径
- completed_scope: 已完成
- remaining_gaps: 剩余项
- anchors_touched: 符号
- verification: 命令与结果；latest_code_covered: yes/no
- active_findings: finding 与状态
- scope_or_baseline_notes: 新事实
