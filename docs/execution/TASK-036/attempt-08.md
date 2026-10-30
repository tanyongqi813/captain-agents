# Execution Capsule — TASK-036 / attempt-08
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-036.md`
- task_id: `TASK-036`
- attempt: `08`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
为06/07启动重排作一次必要的未覆盖分支兼容验收，明确离线已过及真实未完成矩阵。
## 本轮验收切片
- 旧无输出/仅开始/不退出/输出上限/启动失败在最新核心仍符合原语义。
- 06准备挂起、执行总时限和Abort/SIGTERM在07增加spawn门后仍收口；不重复07已过正常组合。
- 不改生产/测试；若发现新缺陷另批，不在本验收白名单偷偷修。
## 已确认事实（禁止重新推导）
- 07新4+旧审批8项12/12和外层正常1/1已覆盖最新代码，不重复。
- 06类型及完整矩阵早于07核心启动重排，不能冒充本轮最新取消/超时证据。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `test/channel-probe.test.ts` — 五个尚未覆盖最新启动结构的旧边界。
2. `test/channel-probe-bounded-fixture.test.ts` — 准备/执行挂起和取消。
## 修改白名单
- `docs/implementation/TASK-036-acceptance.md`
- `docs/implementation/TASK-036-attempt-08.md`
- max_modified_files: `2`
## 明确非目标
- 不修改实现/测试，不运行真实通道/认证，不把离线切片当整项通过。
## 定向验证（最多 5 条）
1. `node --test --test-name-pattern='无输出|仅工具|结果正确|stderr|启动失败' test/channel-probe.test.ts`
2. `node --test --test-name-pattern='挂起|总时限|取消' test/channel-probe-bounded-fixture.test.ts`
3. `git diff --check`
## 禁止验证
- 不重复已过审批/正常组合/types，不全量/UI/build/e2e/真实网络密钥模型。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `4`
- soft_call_limit: `6`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 用例失败保存新事实，不跨白名单修代码。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 兼容矩阵
- remaining_gaps: 真实入口及整项
- anchors_touched: none
- verification: 结果/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 验收非新功能
