# Execution Capsule — TASK-031 / attempt-18

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `18`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
补真实默认核心接口组合证据：控制器→持久调度→授权→目录提交，不替换内部依赖，只替换外部请求。

## 本轮验收切片
- 临时配置和假认证，默认关闭零请求，显式授权一次仅GET模型目录，发布及落盘，连续poll不能绕过持久限频，模型价格配置逐字不变。
- 在途撤销/stop使用真实授权与调度入口，主动abort、无成功目录和发布，停止后不重启；不据此冒称Electron退出事件实测。

## 已确认事实（禁止重新推导）
- 12现有loop测试替换了consent/refresh，11调度测试独立，17窗口E2E禁后台，三者尚无真实默认依赖组合证据。
- 17最新窗口1/1及三种图已过，生产build未变不重复。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/deepseek-catalog-loop.ts` — catalogRefreshController默认依赖。
2. `test/deepseek-catalog-refresh.test.ts` — 临时设置/认证和持久目录读取范式。
3. `src/core/deepseek-models.ts` — readDeepseekCatalog/query路径。

## 修改白名单
- `test/deepseek-catalog-integration.test.ts`
- max_modified_files: `1`

## 明确非目标
- 不改生产，不加定时器/真实网络或真实认证，不重写已过单元测试。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-catalog-integration.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量、build、窗口或旧通过核心/UI。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `10`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 发现生产缺陷或越白名单，保留证据回交；一次纠偏仍失败停止。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 真实接口组合
- remaining_gaps: 整项判断
- anchors_touched: 新集成测试
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 证明边界
