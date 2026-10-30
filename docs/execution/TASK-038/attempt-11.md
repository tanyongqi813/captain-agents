# Execution Capsule — TASK-038 / attempt-11
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `READY`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `11`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
显式离线连续观察→consumer→runner停止→停后handoff闭环，默认关闭且可取消，不改原runner。
## 本轮验收切片
- 新入口无options零IO，仅offline_fixture/保存假命令/Cursor已知协议/同round及worker身份；固定独立观察salt、累计休眠取已有SleepMonitor/登记，不合并旧LogTail；每次256KiB读取。
- 单循环串行、25–2000ms间隔、最大90秒本地总闸门/Abort退出，不残留定时器；超时只留检查点不另发强停，不启动选手。
- 已有停止计划先存证据再请求，终态stopped后仅本计划回交；普通完成不交owner，归属变化拒绝，不重派。回交被安全门拒绝只保留检查点不重试。
- 真dispatch/runner Cursor假选手持续错误+未完read被观察驱动停止，报告patch保留并needs_owner；另job继续，独立核对新建A进程身份/退出，不借伪PID或旧PID发信号。默认/取消/总闸门离线覆盖。
## 已确认事实（禁止重新推导）
- 037观察器和038 consumer/handoff已过；真实策略未启用，函数调用不是权限委托；正式依赖保留。
- 不改live/runner dirty hunk：其归属为031–035/037/03807历史，当前无index.lock。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/execution-progress.ts` — CursorProgressObserver。
2. `src/core/execution-guard-consumer.ts` — sample/handoff。
3. `src/core/sleeps.ts` — SleepMonitor。
4. `src/core/runner.ts` — watch停止/终态，只读。
5. `test/execution-guard-runner.test.ts` — 真派发假进程夹具，只读。
## 修改白名单
- `src/core/execution-guard-loop.ts`
- `test/execution-guard-loop.test.ts`
- max_modified_files: `2`
## 明确非目标
- 不接生产timer/CLI/UI，不改模板/原停机下限，不真实认证联网模型/提交部署，不增加恢复或自动重启。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=30000 test/execution-guard-loop.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不全量/build/UI/旧01–10或037重复矩阵。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `16`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需改白名单外生产文件或新权限则保存partial，不吞回收失败或削弱停止断言。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 当前绝对路径/分支
- changed_files: 两白名单文件
- completed_scope: 连续离线接线
- remaining_gaps: 真启用/正式依赖发布
- anchors_touched: 新循环/组合
- verification: PASS/FAIL/latest_code_covered
- active_findings: none或具体finding
- scope_or_baseline_notes: 不等于真实供应商或跨平台发布
