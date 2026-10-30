# TASK038 attempt08 — 已停止离线任务回交现有owner入口
- outcome: completed
- handoff: none
- stop_reason: none
- workspace_branch: /Users/yyw./Documents/ChatGPT/派活工作台/captain-agents @ codex/custom-requirements
- changed_files: src/core/execution-guard-handoff.ts; src/core/execution-guard-consumer.ts; test/execution-guard-handoff.test.ts
- completed_scope: consumer.handoff实际消费02停止证据，核对已停止/stopRequested/同轮/假命令和固定sidecar计划；普通job返回负责人检查点。autopilot归属核对action token/jobs、执行node及attempt token/jobs，再经原transition+advance owner_requested进入needs_owner。重复只认相同ownerNote/事件及attempt归属，不新建事件/尝试，不写job.decision。
- remaining_gaps: 无生产自动入口/正式阈值启用；实际看管崩溃恢复仍拒绝旧sidecar，尚未完成。回交针对executing写手动作；未验证review/diagnose分支或同动作多job的完整生命周期。正式037依赖/全仓发布未过，不标整项通过。
- anchors_touched: OfflineGuardConsumer.handoff/deliverOfflineGuardHandoff
- verification: planning PASS后实施；首1PASS/2FAIL是临时autopilot编号不符合已有严格格式，一次纠偏仅改合法编号后最新3/3 PASS1.09秒；四工程types覆盖最终生产PASS（编号纠偏只测试字符串，未重跑types）；diff PASS。latest_code_covered: yes（生产）。
- active_findings: none
- scope_or_baseline_notes: 未修改autopilot.ts/engine/028、runner或旧安全模板；未真实网络/登录/模型/系统通知/提交部署，不重复07/旧通过矩阵。夹具直接写临时登记后由parseRun严格核验，不触碰真实登记。

## 范围与复审
回交在独立guard锁内串行，不锁写autopilot原文件；通过原transition按token锁内修改且advance负责ownerEvent和终态校验。callback重读job，避免旧轮次/旧引用回交；action在transition清除后按当前node与attempt归属复核。普通job没有autopilot不伪造run。固定原因来自已验证计划两类停止原因，不复制原始错误日志。

不声称自动定时调用handoff已接线、不声称实际整runner崩溃/跨进程恢复已验证，默认生产策略仍关闭。回交文案由固定模板生成，报告/候选文件的实际归档仍依赖runner既有收尾；本次未另测文件归档失败分支。
