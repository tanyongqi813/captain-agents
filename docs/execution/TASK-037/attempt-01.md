# Execution Capsule — TASK-037 / attempt-01
- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-037.md`
- task_id: `TASK-037`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
## 本轮唯一目标
实现独立离线有界进度观察核心和Cursor已知结构化事件适配，不接生产停机。
## 本轮验收切片
- 纯状态转换/时钟注入，累计休眠扣除，错误与字节不刷新有效进展；工具ID配对及去重，成功读不冒充实现进展，成功edit或result才更新。
- 同读指纹五分钟五次仅提示、并行工具独立；无ID不配对，未知协议保留未知；候选90/180秒不强停。
- ID/路径用调用方会话salt摘要，状态和分块行缓存有界，溢出标记证据不完整；不保存命令正文/路径/日志。
## 已确认事实（禁止重新推导）
- 03601–10离线有界与固定流素材稳定，真实入口待决定不影响纯观察；036正式依赖保持，不输出037机器派发。
- activity/live已有dirty由历史任务拥有，本轮不改。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/activity.ts` — Cursor row分支，只读。
2. `test/fixtures/streams/cursor-stream.jsonl` — tool_call started/completed与result，只读。
3. `src/core/duration.ts` — 休眠约定，只读。
## 修改白名单
- `src/core/execution-progress.ts`
- `test/execution-progress.test.ts`
- max_modified_files: `2`
## 明确非目标
- 不修改runner/activity/live/旧模板，不启用计时器/强停/界面，不真实认证模型网络；不将散文错误猜作重连或失败。
## 定向验证（最多 5 条）
1. `node --test test/execution-progress.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不全量/build/UI/e2e/036旧通过测试。
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
- 超白名单或需要真实权限/新产品强停阈值即保存检查点。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget
- workspace_branch: 当前路径分支
- changed_files: 白名单
- completed_scope: 观察核心
- remaining_gaps: 生产观察/整体验收
- anchors_touched: reducer/adapter
- verification: PASS/FAIL/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 仅离线，不解除正式依赖
