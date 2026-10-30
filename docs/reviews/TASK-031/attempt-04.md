# Review Record — TASK-031 / attempt-04

- handoff_contract: `1`
- task_id: `TASK-031`
- attempt: `04`
- capsule: `docs/execution/TASK-031/attempt-04.md`
- reviewed_at: `2026-10-27`
- verdict: `PASSED`
- reviewer_role: `lead-ai`

## 审查范围
- implementation_report: 本会话直接开发，dispatch.ts 单条件修正与 deepseek-dispatch.test.ts。
- diff_scope: 仅已知下线模型门槛的本轮增量，其他脏工作区改动未接受。
- acceptance_slice: 陈旧目录不得撤销最后成功权威目录中的下线事实。

## 验证证据
- 修复前新增回归 → FAIL：陈旧后跳过模型门槛，进入后续项目读取，已离线复现。
- `node --test --test-timeout=120000 test/deepseek-dispatch.test.ts test/deepseek-settings.test.ts test/plan-dispatch.test.ts` → PASS，37/37。
- `npm run typecheck` → PASS；`git diff --check` → PASS。
- 四种拒绝组合 → PASS：Pro/Flash × 新鲜/陈旧权威目录，均在零注册、零副本、零启动时拒绝；模型配置和最后成功目录不变。
- 源码复核 → PASS：只移除 !stale 门槛，未修改模型身份、凭据、网络、用量或权限参数；未有权威目录的历史行为不变。
- 全量 verify/UI/build/e2e/真实账户 → NOT_RUN。

## Findings
- `F-04` — `resolved`; severity: `blocking`; anchor: `src/core/dispatch.ts::dispatch`; 失败标陈旧不再使已下线模型重新放行。

## 架构与范围结论
- alignment: 权威事实与获取新鲜度分离，失败不抹去最后成功事实。
- scope: 本轮启动门槛通过；自动刷新、目录 UI 时间/陈旧展示仍未完成，TASK-031 保持 IN_PROGRESS，不能整项放行依赖队列。
- preserved_behavior: 成功目录、实际模型 ID、历史任务和价格不改；旧安装不强制新联网。
- sync: 未提交/同步；同文件包含其他历史未审改动，不整文件提交。

## 优先级复核
- 已复核，无调整，保持 P1 / High。随后处理已有明确合同的 TASK-018 F-08/F-09。

## 下一状态
- task_status: `PASSED`
- next_action: `none`
- next_capsule: `none`
- active_findings_for_next_attempt: `none`
- status_scope: attempt-04 修复切片，不是整任务通过。

