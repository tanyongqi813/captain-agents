# Execution Capsule — TASK-038 / attempt-03
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `03`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
真实dispatch/runner假进程组合验证02停止请求收尾，保留报告补丁且不影响另一job。
## 本轮验收切片
- 临时项目/假程序启动两个真实runner；01合成明确测试观察→02证据/请求→原watch停止A，自己的子孙停，B继续后正常结束。
- 日志持续输出、报告和候选修改保留，不自动重新启动或新增job；仅验证测试控制面，不冒称037真实流→038完整自动接线。
## 已确认事实（禁止重新推导）
- 02停止请求/sidecar通过，未实际进程组合；原runner负责按拥有身份清理树。
- 默认生产仍关闭，阈值短值仅夹具；正式依赖不解除。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `test/money-budget-group-stop.test.ts` — 原双任务假程序写报告组合模式，只读。
2. `src/core/runner.ts` — watch/stop/收尾，只读。
3. `src/core/execution-guard-consumer.ts` — sample，只读。
## 修改白名单
- `test/execution-guard-runner.test.ts`
- max_modified_files: `1`
## 明确非目标
- 不改生产/模板、不伪造needs_owner已接通、不实际真实通道或安装部署。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=45000 test/execution-guard-runner.test.ts`
2. `git diff --check`
## 禁止验证
- 不重复01/02/037/types/build/UI/全量。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `10`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 发现生产缺陷另建有界合同，不越白名单；只清理新建测试登记拥有进程。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict
- workspace_branch: 当前路径分支
- changed_files: 新测试
- completed_scope: 真实runner假程序
- remaining_gaps: 回交/真实配置
- anchors_touched: test
- verification: PASS/FAIL/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 无真实模型
