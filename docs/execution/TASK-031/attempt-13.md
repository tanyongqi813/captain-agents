# Execution Capsule — TASK-031 / attempt-13

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `13`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
将09保存授权接口接成可信窗口专门IPC，不开放通用设置或秘密读取。

## 本轮验收切片
- shared/preload/main和独立桥模块原子接线；read零参数，set只布尔与开启必需的64位身份摘要；拒绝多余参数/临时密钥/不可信来源。
- 成功设置后读取真实新状态，通知既有controller本地poll；关闭不依赖身份摘要。失败不伪称成功，普通设置仍不能授权。
- 四主要文件原子IPC迁移例外已写Spec；UI不开启按钮，后续组件批先规范再接，当前不宣称用户流程已完成。

## 已确认事实（禁止重新推导）
- 09核心set/read已过，main可信来源用trustedSender；preload仅按白名单转发。
- 12后台消费者默认关闭已接。只接专门IPC，不调用真实请求/密钥或启动应用。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `app/main/index.ts` — 专门IPC注册与trustedSender。
2. `app/shared/ipc.ts` — 唯一白名单与Bridge。
3. `app/preload/index.ts` — 受限桥。
4. `src/core/settings.ts` — 专门授权，只读。

## 修改白名单
- `app/main/deepseek-catalog-bridge.ts`
- `app/main/index.ts`
- `app/shared/ipc.ts`
- `app/preload/index.ts`
- `test/deepseek-catalog-bridge.test.ts`
- max_modified_files: `5`

## 明确非目标
- 不改UI/旧网络规则/核心授权逻辑，不真实启用目录联网、不启动应用。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-catalog-bridge.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重跑旧目录/授权/费用测试，不跑全量/UI/build/e2e或真实通道。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 越白名单/来源不清停止；一次纠偏仍失败回交。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: UI/窗口/集成
- anchors_touched: 专门授权桥
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
