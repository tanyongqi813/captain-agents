# Execution Capsule — TASK-036 / attempt-06
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-036.md`
- task_id: `TASK-036`
- attempt: `06`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
离线辅助进程内完成配置/运行包准备和执行，外层统一最多90秒及显式取消，先回收再清理拥有目录。
## 本轮验收切片
- 父级单次消费后只启动一个固定内部--offline-helper，不开放任意命令或真实模式；子级只委托此临时范围的离线审批。
- 辅助进程启动前开始计时，准备挂起零选手；正常组合至多一个会话；超时/Abort/SIGTERM后回收helper和假选手子孙，清理整个拥有根目录。
- helper/选手POSIX共享外层进程组（内层不再detached），Windows复用树控制；继承组仅可信外层管理，不影响通用核心默认行为。
- 报告scope明确是辅助流程，firstEvent不是模型首事件、不伪造tool时间；未知用量/模型/版本不补0。
## 已确认事实（禁止重新推导）
- 05组合已过，仅替身可用。platform.killTree在POSIX只杀同组，原嵌套core会新开组，不能直接套外层就称已回收。
- 不接真实凭据，不修改workers/sandbox/platform/runner；SIGKILL父级及整机崩溃不在可保证清理范围。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/platform.ts` — treeSpawn/killTree/processSince，仅复用。
2. `src/core/channel-probe.ts` — prepared执行/取消。
3. `src/core/channel-probe-worker-fixture.ts` — 准备/消费/执行。
4. `src/core/channel-probe-consent.ts` — 已过单次门，不修改。
## 修改白名单
- `src/core/channel-probe.ts`
- `src/core/channel-probe-worker-fixture.ts`
- `src/core/channel-probe-bounded-fixture.ts`
- `test/channel-probe-bounded-fixture.test.ts`
- max_modified_files: `4`
- atomic_exception: 外层/继承组/拥有目录/测试必须同时接线，防止漏杀独立组。
## 明确非目标
- 不真实运行，不改应用/旧offline脚本，不重启IDE，不宣称OS/Windows实测。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=30000 test/channel-probe-bounded-fixture.test.ts`
2. `node --test --test-name-pattern='固定文件|独立子孙' test/channel-probe.test.ts`
3. `node --test --test-name-pattern='原运行包|固定stdin' test/channel-probe-worker-fixture.test.ts`
4. `npm run typecheck`
5. `git diff --check`
## 禁止验证
- 不旧审批/全量/UI/build/e2e/真实CLI/网络/认证。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `18`
- soft_call_limit: `20`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 超白名单/新权限/一次纠偏失败保存partial。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 外层总闸门
- remaining_gaps: 真实入口及验收
- anchors_touched: 生命周期
- verification: 结果/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: helper事件不冒称模型事件
