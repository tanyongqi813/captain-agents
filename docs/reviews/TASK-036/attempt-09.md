# Review Record — TASK-036 / attempt-09
- handoff_contract: `1`
- task_id: `TASK-036`
- attempt: `09`
- capsule: `docs/execution/TASK-036/attempt-09.md`
- reviewed_at: `2026-10-29`
- verdict: `PASSED_WITH_NOTES`
- reviewer_role: `lead-ai`
## 审查范围
- implementation_report: docs/implementation/TASK-036-attempt-09.md
- diff_scope: 两白名单文件，仅F-06。
- acceptance_slice: 回收失败保留现场及本地恢复，正常清理兼容。
## 验证证据
- 故障注入最新1/1 PASS、正常组合1/1 PASS，最新四工程types/diff PASS。
- 模拟仅自己的POSIX组kill失败：core cleanupFailed真实变true，根及恢复记录保留、假进程仍活；随后核对helper身份回收自己的测试组。
- 首轮测试after钩子失败与一次纠偏、精确范围工具审批恢复旧假进程按Report留痕。
## Findings
- `F-06` — `resolved`; severity: `blocking`; anchor: runBoundedWorkerProbeFixture::finally; 未确认回收成功就不删上下文，记录恢复ID，正常路径仍清理。
- F-07 — accepted_note; severity: non_blocking; anchor: cleanup recovery; 故障记录写入失败会抛错且保留根，不冒称恢复记录已落盘；父进程SIGKILL/崩溃及Windows故障不在已过证据范围。
## 架构与范围结论
- alignment: fail-closed保存现场而非删除仍活跃资料；不自动再派发。
- scope: 两文件；07门/真实模板/凭据不改。
- preserved_behavior: 正常有界组合清理保持，真实通道仍关闭。
- task_rollup: IN_PROGRESS，真实入口/样本及全仓发布未过，不解除037正式依赖。
## 优先级复核
- 已复核，无调整，P1/High。
## 下一状态
- task_status: `PASSED`
- next_action: `none`
- next_capsule: `none`
- active_findings_for_next_attempt: `none`
- status_scope: F-06安全修复切片，非整任务。
