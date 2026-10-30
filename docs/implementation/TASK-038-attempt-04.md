# TASK038 attempt04 — 最小父退子孙诊断
- outcome: partial
- handoff: checkpoint
- stop_reason: scope_conflict
- workspace_branch: /Users/yyw./Documents/ChatGPT/派活工作台/captain-agents @ codex/custom-requirements
- changed_files: test/execution-guard-exit.test.ts
- completed_scope: 固定临时父子、随机nonce及PID对应，自有POSIX组检查，父退前后与两次killTree结果。子进程自带5秒退出上限，不操作旧PID。
- remaining_gaps: 最小场景不复现03 EPERM，F-05仍未定位/修复；不能据此将03改通过。
- anchors_touched: 新最小诊断
- verification: planning PASS后执行；隔离内ps启动EPERM，未得到组核验；随后明确范围工具审批同代码1/1 PASS0.605秒。latest_code_covered: yes（诊断）。diff PASS；无源码纠偏、不重跑03/旧测试/types。
- active_findings: F-05 unresolved
- scope_or_baseline_notes: 仅自有假进程/临时目录，无生产或真实登录网络模型/提交部署。

## 新实测证据
本次自有parent42731/child42732，仅作本报告历史证据，严禁后续按此旧PID发信号。父退后ps仅child存在，ppid=1/pgid=parent/state=S；第一次killTree SIGKILL返回OK，150ms后这两个PID均不见，第二次killTree返回OK，之后同样不见。说明本机审批路径下最小POSIX父退遗留子孙可以回收并重复调用，不支持“所有父退组必然EPERM”的假设。

隔离内只读ps被拒绝与03组合中的kill EPERM不能混同。03范围审批执行仍失败，必须在真实失败组合中核对当时worker/runner/自有子PID和组状态，不能用本次最小通过替代03验收。
