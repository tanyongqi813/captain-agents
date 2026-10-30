# Execution Capsule — TASK-036 / attempt-03
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-036.md`
- task_id: `TASK-036`
- attempt: `03`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
实现可信手动控制面可调用的一次性审批消费门和核对后的版本/实际模型元数据，不开放真实CLI入口。
## 本轮验收切片
- 显式目录、已准备命令及预期元数据绑定；审批只有手动owner决定，短期token不记原文，锁内先消费再执行，失败/冷进程/并发不重用；缺失/过期/变更零执行。
- 网络/凭据/隔离授权不由token生成，不能替代原有派发校验；无生产消费者或默认真实适配器。
- 核心仅保存与可信预期精确一致的结构化init模型/版本；缺失/异常未知null，不把requested当actual。
## 已确认事实（禁止重新推导）
- workers.command依赖项目运行包/沙箱/登录，generic核心不具备该契约，禁止直接拿cursor-agent裸跑。
- 01/02均通过，offline脚本必须仍只接受五固定场景，不能偷偷加真实模式。
- fsx有withLock/readJson/writeJson，不另写锁。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/channel-probe.ts` — 有界核心及report。
2. `src/core/fsx.ts` — 持久原子锁/写。
3. `src/core/workers.ts` — 只读已有安全准备边界。
## 修改白名单
- `src/core/channel-probe.ts`
- `src/core/channel-probe-consent.ts`
- `test/channel-probe-consent.test.ts`
- max_modified_files: `3`
## 明确非目标
- 不读真实密钥、跑真实命令、改workers/platform/offline脚本/应用入口；门是可信调用面协议，不是对不可信代码的鉴权沙箱。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=30000 test/channel-probe-consent.test.ts`
2. `node --test --test-name-pattern=固定文件 test/channel-probe.test.ts`
3. `npm run typecheck`
4. `git diff --check`
## 禁止验证
- 不旧CLI/全量/UI/build/e2e或真实模型/网络/认证。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `17`
- soft_call_limit: `16`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 超白名单/新权限/一次纠偏仍失败保存partial。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 审批门/元数据
- remaining_gaps: 真实安全适配与验收
- anchors_touched: 新接口
- verification: 结果/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 不冒称真实执行已授权
