# Review Record — TASK-036 / attempt-08
- handoff_contract: `1`
- task_id: `TASK-036`
- attempt: `08`
- capsule: `docs/execution/TASK-036/attempt-08.md`
- reviewed_at: `2026-10-29`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`
## 审查范围
- implementation_report: docs/implementation/TASK-036-attempt-08.md
- diff_scope: 仅验收文档，源码只读审查。
- acceptance_slice: 最新旧输出/取消边界及失败分支。
## 验证证据
- 旧边界5/5 PASS、总时限/取消4/4 PASS、diff PASS；没有新增生产修改。
## Findings
- `F-06` — `active`; severity: `blocking`; anchor: src/core/channel-probe-bounded-fixture.ts::finally; core明确返回cleanupFailed时外层仍删除拥有根，不能保证选手已停。须保留上下文和固定脱敏恢复记录，故障替身证明不误删，再受控回收测试自己创建的进程。
## 架构与范围结论
- alignment: 在已通过测试之外识别错误分支，不拿通过数替代安全判断。
- scope: 未越验收白名单修生产，09有界纠偏。
- preserved_behavior: 已通过窗口/真实权限/其他任务边界保持。
- task_rollup: IN_PROGRESS。
## 优先级复核
- 已复核，无调整，P1/High，先修回收失败安全。
## 下一状态
- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-036/attempt-09.md`
- active_findings_for_next_attempt: `F-06`
