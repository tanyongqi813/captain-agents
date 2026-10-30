# Execution Capsule — TASK-038 / attempt-02
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-038.md`
- task_id: `TASK-038`
- attempt: `02`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
消费01纯判定，先持久证据再写已有job.stopRequested；仅离线替身入口，默认零IO。
## 本轮验收切片
- 显式offline_fixture、绝对假程序与job保存命令匹配，job/轮次核验；null默认关闭不读写任务。
- 锁内原子写有界安全sidecar，固定原因和负责人回交记录；停止前再次锁内核对任务轮次/运行状态，不借decision冒充主人采用/丢弃。
- 并发采样串行、重复停止不重复请求，坏文件/其他会话不重置；新进程不自动认领旧会话，保留检查点交人工/负责人。
- 本批仅停止请求，不直接发信号；已有runner正常收尾仍负责拥有树/报告补丁。不得冒称实际树回收或needs_owner接线完成。
## 已确认事实（禁止重新推导）
- runner已有stopRequested收尾，job.decision仅采用/丢弃不适用于诊断回交；autopilot needs_owner是另一受控状态机不可直接写。
- 01六测试通过，生产无校准策略启用接口。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/execution-guard.ts` — guardTick。
2. `src/core/job.ts` — readJob/updateJob。
3. `src/core/fsx.ts` — withLock/writeJson。
## 修改白名单
- `src/core/execution-guard-consumer.ts`
- `test/execution-guard-consumer.test.ts`
- max_modified_files: `2`
## 明确非目标
- 不改runner/job/live/autopilot生产入口，不自动启用真实策略，不修改旧预算/模板，不真实认证联网模型。
## 定向验证（最多 5 条）
1. `node --test test/execution-guard-consumer.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不重复01/037/全量/build/UI/真实通道。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `18`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需要其他任务dirty生产修改/真实授权即保存后续边界，不越权。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget
- workspace_branch: 当前路径分支
- changed_files: 白名单
- completed_scope: 消费和请求
- remaining_gaps: 实际收尾/needs_owner
- anchors_touched: sample
- verification: PASS/FAIL/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 仅假入口
