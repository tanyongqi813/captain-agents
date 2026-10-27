# Execution Capsule — TASK-031 / attempt-03

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLAIMED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `03`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

只补 F-03 的冷启动与临时请求交错边界。此 Capsule 由负责人复审后新建，不是无限自动重试。

## 本轮验收切片

- 已保存连接结果的发布顺序独立于成功目录是否存在；临时凭据请求不得屏蔽或污染权威请求结果。

## 已确认事实（禁止重新推导）

- 11 条现有定向测试、类型检查通过；F-01/F-02 已接受。
- nextSequence 已用跨进程锁分配全局落盘号，但 current 为空的失败直接返回。
- 成功提交先比 current.sequence，再检查账户来源；临时先回会挡住已保存凭据结果。
- 缓存尚未接入 UI/派发；任务整体仍未完成。其他仓库 TASK-037 不相关。
- 原始 error 不落盘，withLock 不跨网络持有，查询返回 string[] 保持。

## Active findings

- `F-03` — 将每连接的最新已保存请求预占与目录成功快照解耦；权威与临时排序分开，修复冷启动旧成功抹掉新失败以及临时结果压住权威结果。

## 源码锚点（最多 5 个）

1. `src/core/deepseek-models.ts` — nextSequence、refreshDeepseekCatalog、readDeepseekCatalog；连接级预占及发布核对。
2. `test/deepseek-settings.test.ts` — 补无初始目录、交错来源和双进程争锁用例。

## 修改白名单

- `src/core/deepseek-models.ts`
- `test/deepseek-settings.test.ts`
- max_modified_files: `2`

## 明确非目标

- 不重写 F-01/F-02、查询返回类型，不改 UI/IPC/凭据存储/模型/档位/派发。
- 不联网、不读取真实凭据、不提交或 push；跨进程测试仅在临时 XAGENTS_HOME 用假凭据与 fetch 替身。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/deepseek-settings.test.ts`
2. `npm run typecheck`
3. 无目录时早慢成功、晚快失败：旧成功不能发布为新鲜目录；无成功结果允许 null，不能编造成功时间。已有成功目录时新失败保留最后成功列表与时间且 stale=true。
4. 已保存与临时查询分别覆盖先发/后发、成功/失败交错：临时请求不更改或阻挡权威槽；所有原 F-01/F-02 测试保持。
5. 真正启动两个独立 Node 子进程竞争同一临时连接请求登记（可固定时钟），用 IPC 屏障控制开始/完成；证明序号唯一且旧返回不覆盖新状态，不能用手写序号文件代替。

## 禁止验证

- 不跑全量测试/UI/build/e2e，不运行收费调用，不把子进程接到真实网络。
- 已通过命令仅在相关代码改变后重跑。

## 已知基线失败

- none confirmed

## 单次执行预算

- budget_mode: `prompt_soft`
- soft_timebox_minutes: `30`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件

- 超出白名单或需要改变原查询/UI/派发接口时停止并报告。
- 无法在预算内完成双进程回归时返回 partial + checkpoint，不能宣称 F-03 已解决。
- 不自行生成下一轮；不将目录切片完成等同于 TASK-031 整体通过。

## 精简 Implementation Report（固定格式）

- outcome: `completed | partial | blocked`
- handoff: `none | checkpoint`
- stop_reason: `none | soft_budget | runner_limit | context_limit | external_decision | permission | scope_conflict`
- workspace_branch: `[absolute workspace or worktree] @ [branch or detached SHA]`
- changed_files: [paths only]
- completed_scope: [observable work completed]
- remaining_gaps: [specific unfinished work]
- anchors_touched: [symbols/tests only]
- verification: [command → PASS/FAIL/NOT_RUN; latest_code_covered: yes/no]
- active_findings: [F-03 → resolved/unresolved]
- scope_or_baseline_notes: [new fact only; no transcript]
