# Implementation Report — TASK-018 / attempt-08

- outcome: completed（F-02 切片）；整任务 partial
- handoff: checkpoint
- stop_reason: none（当前有界合同完成，下一独立保存协议需新 Capsule）
- workspace_branch: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018 @ feat/task-018-cost-budget`
- changed_files: src/core/cost-budget.ts、src/core/job.ts、src/core/dispatch.ts、src/core/wake.ts、src/core/runner.ts、test/cost-budget.test.ts、test/cost-claim.test.ts
- completed_scope: claimId 持久化与传递；释放/结算幂等与身份校验；旧终态不能回收续跑新预占；未知状态保守保留；活跃预占不按 TTL 回收；旧无身份账本兼容。runner 使用原尝试的轮号/身份，不以新轮 fresh 数据冒充旧轮。
- remaining_gaps: F-05 旧草稿覆盖；完整集成、浅深窄截图及必要发布验证；独立副本尚未安全整合主仓。
- anchors_touched: CostClaim/loadLedger/jobOwners/reapSlots/costGate/releaseAttempt/recordSeconds、Job.cost、dispatch、resumeMember、runner 收尾。
- verification: 最新生产代码下 cost-budget 28/28、cost-claim 纠正错误文案断言后 4/4；四工程 typecheck 和 diff PASS；latest_code_covered yes。详见独立 Review，未重复已覆盖的 28 项。
- active_findings: F-02 resolved；F-05 unresolved（整任务）。
- scope_or_baseline_notes: 五个主要文件原子接口迁移已在 Task/Capsule 声明；副本有历史未提交改动，本轮只批准增量，未提交同步；无真实收费调用。

## 下一检查点
仍为 TASK-018 IN_PROGRESS。先新建 attempt-09，原子实现设置快照版本/CAS 冲突拒绝、UI 保留用户草稿并提示重新读取、两个窗口先后保存与非法提交离线证明。不能只加 UI 提示而保留后台盲覆盖；不自动合并用户草稿。之后核对完整任务验收和副本整合边界，不把本报告当成整任务通过。
