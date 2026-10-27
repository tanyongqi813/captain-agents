# Execution Capsule — TASK-041 / attempt-03

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-041.md`
- task_id: `TASK-041`
- attempt: `03`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
仅修复 F-01/F-02，保留已有模式切换、授权失效及主进程受信拒绝逻辑。

## 本轮验收切片
动态受信负责人能显示并选中，非受信候选仍被排除；标准真实窗口验收命令能发现新增用例。

## 已确认事实（禁止重新推导）
- 主进程加载动态名单；窗口只更新短名，不会加载同一份动态 roster。
- 后台 View.models.channels 已有通道与模型 who 的映射，View.roster/pool 已过滤可用选手；不需要新增配置或依赖。
- 不按模型名字或 who 前缀猜受信身份；窗口只作展示，最终校验仍由核心执行。
- 既有窗口测试已单独通过，但 HEAD 的 scripts.test:e2e 只列 smoke.ts。

## Active findings
- `F-01`: 以后台当前名单中的通道事实展示动态负责人，新增动态保留模型回归，验证新旧模式及非受信通道。
- `F-02`: 标准 test:e2e/verify 必须覆盖 test/e2e/lead-review.ts，保留现有窗口用例；不覆盖工作区其他测试脚本改动。

## 源码锚点（最多 5 个）
1. `app/renderer/components/Autopilot.tsx` — trusted / reviewerPool / ready。
2. `test/ui/autopilot.test.tsx` — 负责人流程筛选与模式切换测试。
3. `package.json` — scripts.test:e2e。
4. `src/core/view-types.ts` — ViewModels（只读现有接口，不修改）。
5. `test/e2e/lead-review.ts` — 既有离线窗口用例（不重写）。

## 修改白名单
- `app/renderer/components/Autopilot.tsx`
- `test/ui/autopilot.test.tsx`
- `package.json`
- max_modified_files: `3`

## 明确非目标
不改 IPC、受信通道底线、运行状态机、权限、费用、Git 或续跑。已通过和未被 active finding 指向的实现保持不动。

## 定向验证（最多 5 条）
1. `npx vitest run test/ui/autopilot.test.tsx`
2. `node --test --test-timeout=120000 test/autopilot-desktop.test.ts`
3. `npm run typecheck`
4. `npm run build && npm run test:e2e` — 经标准入口发现负责人用例，只使用临时登记与替身。
5. `git diff --check`

## 禁止验证
不运行全量核心或全量 UI；不调用真实账户、模型；不以单独跑新窗口文件替代标准入口发现验证。

## 已知基线失败
- F-01 的隔离新增回归失败：新模式将动态受信候选过滤为 null；不是既有测试失败。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `30`
- soft_call_limit: `20`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
若现有只读 View 不能安全承载身份，或需要改白名单外接口时停止，交负责人决定；不能用前缀放宽受信范围。

## 精简 Implementation Report（固定格式）
- outcome: completed | partial | blocked
- handoff: none | checkpoint
- stop_reason: none | scope_conflict
- workspace_branch: 绝对路径与分支
- changed_files: 文件路径
- completed_scope: 已完成范围
- remaining_gaps: 剩余项
- anchors_touched: 符号
- verification: 命令与结果；latest_code_covered: yes/no
- active_findings: finding 编号与状态
- scope_or_baseline_notes: 新事实
