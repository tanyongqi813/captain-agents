# TASK038 attempt06 — F-05调用阶段定位
- outcome: partial
- handoff: checkpoint
- stop_reason: scope_conflict
- workspace_branch: /Users/yyw./Documents/ChatGPT/派活工作台/captain-agents @ codex/custom-requirements
- changed_files: test/execution-guard-runner.test.ts
- completed_scope: dispatch既有start注入临时runner包装器，原样调用process.kill不吞错，记录仅自己job.workerPid匹配的负PID信号。
- remaining_gaps: F-05修复与原done断言复验。
- anchors_touched: 临时runner包装脚本
- verification: 事前planning PASS；明确范围审批最新原组合4.62秒FAIL，记录两次同组SIGKILL：第一次OK、第二次EPERM；退出组三PID均不在，exit0却failed。无纠偏；diff PASS。latest_code_covered: yes（诊断FAIL）。
- active_findings: F-05 unresolved（根因已定位）
- scope_or_baseline_notes: 无生产修改/真实调用。历史pid55647等仅记录，严禁以后操作。

定位：runner内层清理及外层finally重复killWorker；第一个已成功清理根已退出的POSIX组，第二个重复调用产生EPERM。不能吞任意EPERM；07只对同一已确认退出身份的成功SIGKILL做幂等，失败不得记成功。Windows仍按已有快照再次回收，不改其行为。
