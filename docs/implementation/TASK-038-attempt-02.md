# TASK038 attempt02 — 离线消费与停止请求
- outcome: completed
- handoff: none
- stop_reason: none
- workspace_branch: /Users/yyw./Documents/ChatGPT/派活工作台/captain-agents @ codex/custom-requirements
- changed_files: src/core/execution-guard-consumer.ts; test/execution-guard-consumer.test.ts
- completed_scope: 01计划实际消费；默认无options/null策略零IO。仅offline_fixture、显式绝对假程序、当前环境和job保存命令匹配；每轮sidecar独立锁，先原子保存证据及固定负责人回交记录，再锁内复核job/轮次/运行状态写已有stopRequested/error。重复请求/并发幂等，不写主人decision、不代写autopilot needs_owner。
- remaining_gaps: 真实runner假选手进程树收尾组合实测、停止后报告/diff归档、已有needs_owner/负责人展示入口接线、实际看管崩溃/冷恢复设计及实测；正式阈值启用与037依赖/全仓发布仍缺。sidecar目标lead记录不代表负责人入口已消费。
- anchors_touched: OfflineGuardConsumer.sample
- verification: planning PASS后实施；初1PASS/2FAIL因误把文件作为withLock目录，唯一纠偏改独立锁目录；最新3/3 PASS1.20秒、最新四工程types/diff PASS。latest_code_covered: yes。
- active_findings: none
- scope_or_baseline_notes: 未改runner/job/autopilot历史dirty；未发信号、无真实密钥网络模型/提交部署/旧测试重跑。测试workerPid=123仅用于断言未被此模块当信号目标，没有运行该PID。

## 状态及安全边界
最大64KiB记录，写入仅固定schema/时钟/摘要计数/最多三预警/停止计划，不含原日志/命令/路径。当前消费者只接受自己本次写入的完整记录字节序列；既有记录、新实例、变化或坏JSON拒绝，不自行认领/重置冷却。停止请求写失败时已存计划保留，同实例可重试请求；停止标记已存在时不重复变更。新实例不能直接恢复，需后续独立核验设计，不声称冷重启可用。

本模块仅offline_fixture入口，假标记不是身份认证；不能改名真实入口。没有生产timer/runner导入，所以真实强停保持关闭。没有把此轮低风险请求测试冒充真实进程树/看管崩溃验收。
