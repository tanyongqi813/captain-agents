# Execution Capsule — TASK-031 / attempt-02

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `02`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标

修正模型目录的临时凭据污染、错误原文落盘和请求排序三项缺陷；只完成目录基础切片。

## 本轮验收切片

- 临时查询不能改变已保存连接目录；缓存无认证信息；跨进程早请求晚返回不能覆盖较新请求的成功或失败状态。

## 已确认事实（禁止重新推导）

- 现有 9 条定向测试和类型检查通过，新增接口尚未接入 UI/IPC。
- 现有成功分支禁止临时结果覆盖权威目录，失败分支遗漏同一保护。
- failure 来自不可信 error.message；序号来自 Date.now 加进程内计数；失败不更新序号。
- readDeepseekCatalog/queryDeepseekModels 的返回类型保持兼容；历史目录可丢弃或兼容读取，不读真实凭据。
- withLock/writeJson 可复用；锁只保护预占与落盘，不跨网络请求持有。

## Active findings

- `F-01` — 临时密钥失败不能修改权威目录的 stale、failure、序号等字段。
- `F-02` — 落盘仅用固定中文摘要和稳定码；禁止原始异常信息与认证内容。
- `F-03` — 在跨进程锁下原子预占单调请求号，成功/失败均按最新有资格请求核对；较新失败应保留最后成功列表与时间并标陈旧，早成功不可抹掉失败。

## 源码锚点（最多 5 个）

1. `src/core/deepseek-models.ts` — refreshDeepseekCatalog、nextSequence、catalogOf；修复以上三项。
2. `test/deepseek-settings.test.ts` — 目录替身回归，补失败路径及双进程排序。

## 修改白名单

- `src/core/deepseek-models.ts`
- `test/deepseek-settings.test.ts`
- max_modified_files: `2`

## 明确非目标

- 不改 UI、IPC、workers、roster、定时刷新或推理强度。
- 不联网、不读取真实凭据、不提交、不 push。
- 已通过且未被 findings 指向的实现保持。

## 定向验证（最多 5 条）

1. `node --test --test-timeout=120000 test/deepseek-settings.test.ts`
2. `npm run typecheck`
3. 假密钥错误含 Authorization、密钥和敏感 URL 时缓存无泄漏；临时成功/失败均不改变已保存连接目录。
4. 覆盖早慢成功/晚快失败、早慢失败/晚快成功、同毫秒双进程请求和临时请求与已保存凭据请求交错；文件保持完整，较新失败保留最后成功列表/时间且 stale=true。

## 禁止验证

- 不运行全量测试/UI/build/e2e；不启动真实选手或请求真实接口。
- 同命令通过后仅在相关代码修改时重跑。

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

- 需要修改白名单外文件或扩展到 UI/派发时停止并报告。
- 修正仍未通过时返回检查点，不自动重试或自行生成下一轮。
- 完成本切片不标记整个 TASK-031 通过，剩余 UI/运行身份接线须报告。

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
- active_findings: [F-01/F-02/F-03 → resolved/unresolved]
- scope_or_baseline_notes: [new fact only; no transcript]
