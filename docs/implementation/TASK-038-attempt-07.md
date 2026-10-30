# TASK038 attempt07 — F-05精确幂等修复
- outcome: completed
- handoff: none
- stop_reason: none
- workspace_branch: /Users/yyw./Documents/ChatGPT/派活工作台/captain-agents @ codex/custom-requirements
- changed_files: src/core/platform.ts; src/core/runner.ts; test/execution-guard-runner.test.ts
- completed_scope: 平台层每看管实例finalTreeCleanup只记非Windows且明确根退出、成功SIGKILL的同pid/since/exitedAt；首次错误不缓存，未退出/换身份仍调用，Windows保留每次原快照回收。runner仅killWorker换此闭包，SIGTERM和错误上报不改。
- remaining_gaps: needs_owner/负责人入口消费、实际看管崩溃恢复、正式阈值/策略启用及037正式依赖/全仓发布。不能将F-05修复当整项038通过。
- anchors_touched: finalTreeCleanup/runWorker.killWorker/组合与首次失败单测
- verification: planning PASS后实施；初类型FAIL为cleaned?.pid===undefined不能收窄对象，一次纠偏改显式cleaned存在检查；最终四工程types PASS，最终新测试文件2/2 PASS4.65秒、diff PASS。latest_code_covered: yes。
- active_findings: F-05 resolved
- scope_or_baseline_notes: 原runner历史67增2删hunk保留，仅import和killWorker新增本轮改动；platform此前干净。无安全模板/Windows逻辑更改、真实模型登录联网/提交部署/build/UI/旧矩阵重跑。

## 最新实测证据
原全部done断言保持。A请求后state stopped、report.md及diff.patch保留、子孙心跳停止；B仍活跃且总job仅2，释放后B exit0/state done。B释放前自有runner/worker/child身份及组明确，结束后三者ps均不在；清理包装器仅记录一次SIGKILL OK，不再第二次EPERM。A子孙只验证心跳停止，不冒称所有A进程独立ps核验。Windows未在本机实测，代码保持原重复快照路径。

注入首次EPERM的单测确认异常仍抛、下一次仍尝试；只有成功后同一终态身份才幂等。未退出和身份变化继续调用，不用事后“无进程”来吞任何真正错误。未启用生产新停滞策略。
