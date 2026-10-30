# Execution Capsule — TASK-036 / attempt-07
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-036.md`
- task_id: `TASK-036`
- attempt: `07`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
补消费入口到实际spawn间的授权安全数据流，同轮收口已确认剩余安全缺口，不开真实通道。
## 本轮验收切片
- 单次消费产生仅一次的authorizeSpawn闭包，锁内重读同一consumed审批/绑定/时间；同步调用实际spawn后才释放锁，拒绝复用或损坏记录。
- 核心完成固定文件准备后必须经该闭包发起spawn，事件监听在锁释放await前同步装好，快速退出不漏事件；等待门计入执行余量。
- 05已有透传expected选项保持，06外层必须传递该门，不接受字段却忽略。过期/篡改在准备后仍零启动。
## 已确认事实（禁止重新推导）
- 04只在run回调前核验，core后续await固定文件操作，不能当成真实spawn前原子核验。
- 06总流程及树回收已过；本批只变授权链，不重复挂起/子孙/取消矩阵。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/channel-probe-consent.ts` — runApprovedChannelProbe。
2. `src/core/channel-probe.ts` — runProbe实际spawn。
3. `src/core/channel-probe-bounded-fixture.ts` — 外层消费回调透传。
4. `src/core/fsx.ts` — withLock，仅复用。
## 修改白名单
- `src/core/channel-probe-consent.ts`
- `src/core/channel-probe.ts`
- `src/core/channel-probe-bounded-fixture.ts`
- `test/channel-probe-spawn-consent.test.ts`
- max_modified_files: `4`
- atomic_exception: 审批闭包/实际spawn/外层消费者/证明同时接线，避免接受门却绕过。
## 明确非目标
- 不真实运行、不改模板/凭据/runner/UI/旧CLI；owner/manual仍可信协议不是鉴权。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=30000 test/channel-probe-spawn-consent.test.ts test/channel-probe-consent.test.ts test/channel-probe-expiry.test.ts`
2. `node --test --test-name-pattern='正常准备' test/channel-probe-bounded-fixture.test.ts`
3. `npm run typecheck`
4. `git diff --check`
## 禁止验证
- 不06整套/旧核心全量/UI/build/真实CLI网络认证。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 超白名单/真实权限/一次纠偏失败保存partial。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 原子spawn门
- remaining_gaps: 手动真实入口及验收
- anchors_touched: 授权链
- verification: 结果/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 不冒称真实权限
