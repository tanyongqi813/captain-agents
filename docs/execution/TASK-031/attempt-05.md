# Execution Capsule — TASK-031 / attempt-05

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `05`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
补齐既有模型目录查询的实际响应字节上限与稳定失败归类，作为后续自动刷新安全前置。

## 本轮验收切片
- 现有 2,000,000 字节上限按实际响应体执行；缺 Content-Length、伪报较小值、分块/多字节内容超限均拒绝，取消剩余流。
- 精确上限内的合法 JSON 仍解析，失败保留最后成功模型和时间且标陈旧。
- 超时和坏 JSON 使用稳定 timeout/invalid 码，固定摘要不落原始正文/密钥；无模型推理请求。

## 已确认事实（禁止重新推导）
- queryDeepseekModels 目前仅检查 Content-Length，再调用 response.json；没有实际体积检查。
- AbortError 已转成固定中文超时错误，但 catalogFailure 只识别 AbortError 名称，导致误归 network。
- 原请求已有 15 秒 AbortController，不改网络授权、认证或请求地址。
- 自动刷新定时接线、目录 UI 和能力证据仍未完成，不将本批当整任务通过。

## Active findings
- none；补既有大小/超时边界，不重开先前已解决发现。

## 源码锚点（最多 5 个）
1. `src/core/deepseek-models.ts` — queryDeepseekModels、catalogFailure、refreshDeepseekCatalog。
2. `test/deepseek-settings.test.ts` — 已有目录/并发测试，只运行不修改。

## 修改白名单
- `src/core/deepseek-models.ts`
- `test/deepseek-model-response.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不改凭据存储、请求身份顺序、目录格式、UI、自动定时器、推理参数或真实网络边界。
- 不接管 TASK-028，不提交夹带历史未审改动，不发布。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-model-response.test.ts test/deepseek-settings.test.ts test/deepseek-dispatch.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不跑全量/UI/build/e2e/真实接口或真实密钥；已覆盖最新代码的通过命令不重复。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `25`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 超白名单、同文件存在其他执行者修改、新架构决策或真实权限需求时停止；最多一次纠偏。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / scope_conflict / soft_budget
- workspace_branch: 绝对路径与分支
- changed_files: 路径
- completed_scope: 切片
- remaining_gaps: 整任务缺口
- anchors_touched: 符号
- verification: 命令结果及 latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
