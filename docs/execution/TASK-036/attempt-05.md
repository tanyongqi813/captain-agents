# Execution Capsule — TASK-036 / attempt-05
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-036.md`
- task_id: `TASK-036`
- attempt: `05`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
把已有运行包准备、固定临时读取资料、单次消费及有界执行真正组合起来；本批显式仅离线替身，不开放不完整真实登录通道。
## 本轮验收切片
- 新适配器缺替身/缺手动token拒绝，选择来自roster/selection，保存策略与本地额度缓存拒绝仍生效，不刷新网络额度。
- 临时固定文件/独立HOME，prepareRun生成只读单轮命令；保持原env/unset/stdin，不改workers/隔离模板。替身必须使用原命令参数和临时cwd成功读取，不是独立-e假成功。
- 准备失败零启动，消费失败不执行，成功后同token不重试；准备及执行失败清理拥有的临时目录/运行包，不读真实项目文件或凭据。
- 原通用核心仍最小环境，只有显式可信准备路径接受完整环境与固定stdin；不把替身验证称真实适配完成。
## 已确认事实（禁止重新推导）
- 01–04已过；04只保护消费入口的时间，未证明真实spawn时原子授权，不向真实入口推广。
- prepareRun/command会使用任务目录，Cursor凭据由runner单独注入；本批只组合替身，不实现/调用cursorToken。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/run-package.ts` — prepareRun，不修改。
2. `src/core/workers.ts` — command/selection，不修改。
3. `src/core/env.ts` — workerEnv，不修改。
4. `src/core/channel-probe.ts` — 现有执行/回收。
5. `src/core/channel-probe-consent.ts` — runApprovedChannelProbe，不修改。
## 修改白名单
- `src/core/channel-probe.ts`
- `src/core/channel-probe-worker-fixture.ts`
- `test/channel-probe-worker-fixture.test.ts`
- max_modified_files: `3`
## 明确非目标
- 不改真实启动模板/runner/凭据/CLI/UI/定时器，不启用真实适配；离线模块明确fixture命名，不暗塞旧offline脚本。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=30000 test/channel-probe-worker-fixture.test.ts`
2. `node --test --test-name-pattern=固定文件 test/channel-probe.test.ts`
3. `npm run typecheck`
4. `git diff --check`
## 禁止验证
- 不全量/旧审批/旧五场景/UI/build/e2e；不真实CLI/网络/密钥。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `16`
- soft_call_limit: `18`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 超白名单/需真实权限或一次纠偏仍不通过保存partial。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 准备消费执行清理的离线组合
- remaining_gaps: 真实安全适配及验收
- anchors_touched: 新适配/核心执行
- verification: 结果/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 不冒称真实通道完成
