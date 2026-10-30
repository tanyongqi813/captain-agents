# 定点边界审查 — 非执行批次

- verdict: BLOCKED（仅036真实凭据委托边界，不是全队列）
- reviewed_at: 2026-10-29
- reviewer_role: lead-ai
- report: docs/implementation/TASK-036-manual-authority-boundary.md
- evidence: runner::runWorker与workers::cursorToken源码检查；NOT_RUN真实登录/模型/网络，未重跑测试。
- finding: 诊断用途的真实登录委托尚无主人明确决定；内部token或--real不能代替。
- scope: 仅新增此一次边界说明，并纠正验收矩阵过期Git缺口；无生产差异。
- task_rollup: TASK036 IN_PROGRESS/current10 CLOSED；其他任务状态/正式依赖不变。
- priority: 已复核，无调整，P1/High。
- next_action: 一次询问精确范围，不创建执行Capsule。等待只限此边界，其他已规划独立离线范围可继续核对。
