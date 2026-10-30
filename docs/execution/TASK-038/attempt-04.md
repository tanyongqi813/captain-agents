# Execution Capsule — TASK-038 / attempt-04
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `04`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
定位F-05正常父退出遗留子孙时kill EPERM，建立可复核的最小拥有进程证据。
## 本轮验收切片
- 使用独立临时假父子进程与既有treeSpawn/killTree，记录仅自有pid/组/出生及回收前后状态；区分进程不存在、僵尸/残留、真实拒绝。不能仅心跳停止就说树已回收。
- 保留03整体失败及done断言；根因未定不改生产或吞EPERM。发现需生产修复时另建有界合同，报告当前真实partial。
## 已确认事实（禁止重新推导）
- 03唯一夹具纠偏后两次同代码FAIL，后一范围工具审批仍EPERM；A前置断言通过，不重做01/02。
- 不接needs_owner、不动其他任务dirty，真实策略仍关闭。
## Active findings
- `F-05`: 正常父退出遗留子孙清理EPERM导致B failed。
## 源码锚点（最多 5 个）
1. `src/core/platform.ts` — treeSpawn/killTree，只读。
2. `src/core/runner.ts` — killWorker/两层finally，只读。
3. `test/execution-guard-runner.test.ts` — 原失败断言，只读。
## 修改白名单
- `test/execution-guard-exit.test.ts`
- max_modified_files: `1`
## 明确非目标
- 不改runner/platform或安全模板，不扩大真实权限，不对旧PID补刀，不吞EPERM/削弱断言，不造回交功能。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=15000 test/execution-guard-exit.test.ts`
2. `git diff --check`
## 禁止验证
- 不重复03/01/02/037/全量/types/build/UI；仅新诊断代码改变且有必要时按一次纠偏验证。
## 已知基线失败
- `node --test --test-timeout=45000 test/execution-guard-runner.test.ts`：B正常退出kill EPERM，03记录。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需要真实权限/外部进程/生产变更即保存范围，不无限重试。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 当前路径分支
- changed_files: 新诊断
- completed_scope: 根因证据
- remaining_gaps: F-05修复
- anchors_touched: test
- verification: PASS/FAIL/latest_code_covered
- active_findings: F-05 resolved/unresolved
- scope_or_baseline_notes: 仅自有新建测试进程
