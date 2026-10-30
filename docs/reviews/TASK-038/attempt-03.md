# Review Record — TASK-038 / attempt-03
- handoff_contract: `1`
- task_id: `TASK-038`
- attempt: `03`
- capsule: `docs/execution/TASK-038/attempt-03.md`
- reviewed_at: `2026-10-29`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`
## 审查范围
- implementation_report: docs/implementation/TASK-038-attempt-03.md
- diff_scope: 新组合测试；runner/platform只读核对。
- acceptance_slice: 真runner假选手双任务停止/隔离/正常收尾。
## 验证证据
- 指定测试最新FAIL：B正常退出后的kill EPERM，范围工具审批复跑同样FAIL。diff PASS；无生产变化，不重复types/旧矩阵。
- A停止/报告patch保留和B继续心跳等前置断言通过，不称整测试通过或全树消失。
## Findings
- `F-05` — `active`; severity: `blocking`; anchor: runner::killWorker/platform::killTree; B正常父退出遗留子孙清理报EPERM，两次执行一致；必须先定位自有组回收结果，不能吞EPERM/忽略子孙/弱化done断言。
## 架构与范围结论
- alignment: 保留失败，暂停后续回交，不越过finding。
- scope: 一个测试；一次夹具纠偏及一次明确范围权限复核，停止重试。
- preserved_behavior: 原安全模板/runner未改，没有真实调用。
- task_rollup: IN_PROGRESS，04优先解决F-05，不解除正式依赖或发布。
## 优先级复核
- 已复核，无调整，P1/High；F-05阻断优先于回交新功能。
## 下一状态
- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-038/attempt-04.md`
- active_findings_for_next_attempt: `F-05`
