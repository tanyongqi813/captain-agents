# Execution Capsule — TASK-036 / attempt-04
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-036.md`
- task_id: `TASK-036`
- attempt: `04`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
修复真实适配接线前发现的审批时间窗口缺口：锁等待/异步落盘期间已过期仍可启动，先修收费安全而非开放通道。
## 本轮验收切片
- 使用调用时间加单调流逝与实际墙钟共同核验，消费锁内读取后及消费落盘后、调用执行器前再次确认；过期/回退零执行，已消费不恢复。
- 发放时间溢出拒绝，不写无法被读取的审批。
- 离线锁屏障证明调用时有效但等待后过期拒绝；正常仍只执行一次。不等待真实五分钟。
## 已确认事实（禁止重新推导）
- 03消费前检查使用await之前固定now，withLock最多等待10秒，剩余时间很短的审批存在过期启动窗口。
- workers.command需要临时任务目录/运行包，runner独立负责环境过滤/凭据/预算；generic核心的独立HOME和cwd不能直接替换该链。当前不接裸命令。
- 03门只是可信调用面协议，不是鉴权；本批不增真实权限或消费者。
## Active findings
- none; 新发现的当前实现时间窗口在本批修复，不篡改03通过记录。
## 源码锚点（最多 5 个）
1. `src/core/channel-probe-consent.ts` — issueProbeApproval/runApprovedChannelProbe时间检查。
2. `src/core/fsx.ts` — withLock仅复用，不修改。
## 修改白名单
- `src/core/channel-probe-consent.ts`
- `test/channel-probe-expiry.test.ts`
- max_modified_files: `2`
## 明确非目标
- 不修改workers/runner/platform/core启动、安全模板、旧offline脚本；不跑真实模型/网络/凭据，不扩真实适配入口。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=30000 test/channel-probe-expiry.test.ts test/channel-probe-consent.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不全量/UI/build/e2e，不重跑01/02旧场景。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `12`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 超白名单/真实权限/一次纠偏失败保存检查点。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 时间安全
- remaining_gaps: 适配与真实验收
- anchors_touched: 消费入口
- verification: 结果/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 不把本地协议当真实权限
