# TASK038 attempt10 — 看管中断冷进程验证

- outcome: completed
- handoff: checkpoint
- stop_reason: none
- workspace_branch: codex/custom-requirements
- changed_files: test/execution-guard-recovery.test.ts
- completed_scope: 两个独立看管消费进程分别在预警/停止计划持久后向自身SIGKILL，独立冷Node进程sample拒绝旧记录；旧sidecar/job/假账本字节原样，worker启动标记缺失、任务仍仅1个。
- remaining_gaps: 连续观察到停止/回交的运行接线、生产默认关闭启用合同、正式依赖与发布验收。现有测试主动调用sample，不是已部署的独立连续看管。
- anchors_touched: 新测试，无生产修改。
- verification: 新2/2 PASS，1.17秒；无纠偏。diff PASS；不重跑types/build/历史矩阵。
- active_findings: none
- scope_or_baseline_notes: POSIX实际自杀信号/冷进程，不是整个runner崩溃、整机休眠或自动恢复；Windows明确跳过。假账本不变不等于真实费用结算验收。沿既有拒绝恢复策略，不增加自动续跑。
