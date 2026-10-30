# TASK018 attempt13 — 原副本窗口

- outcome: partial
- handoff: checkpoint
- stop_reason: none
- workspace_branch: .worktrees/task-018 @ feat/task-018-cost-budget
- changed_files: test/e2e/cost-settings.ts
- completed_scope: 真实IPC保存、关闭进程重开、关闭放弃草稿、另一调用先保存导致旧窗口CAS拒绝，草稿/新磁盘值保持。
- remaining_gaps: 三图虽显示冲突和来源，但名称编辑区被滚动截掉，不能认编辑态视觉验收；主仓安全整合与完整verify尚缺。
- verification: build PASS（既有动态导入警告）；隔离launch失败后审批可启动；初次名称定位器匹配group/input失败，一次纠偏textbox后窗口1/1 PASS 3.22秒。四工程types在定位器纠偏前PASS；仅测试定位器变化。diff PASS。
- active_findings: F-12 视觉编辑区缺证据。
- scope_or_baseline_notes: 三图实际查看，历史图不覆盖。副本Task文档停留05，当前合同在主仓；未合并/提交/真实调用。副本dispatch/job/runner/wake逐段增量是cost预占/回收，主仓同文件多任务变更，不可整文件替换；尚未完成主仓逐段整合审查。
