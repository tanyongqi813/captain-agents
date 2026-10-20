# Review Record — TASK-015 / attempt-01

- task_id: `TASK-015`
- attempt: `01`
- capsule: `legacy-task-spec-only`
- reviewed_at: `2026-10-20`
- verdict: `PASSED_WITH_NOTES`
- reviewer_role: `lead-ai`

## 审查范围
- implementation_report: docs/tasks/TASK-015.md 当前实施报告。
- diff_scope: 主工作区 src/core/dispatch-advice.ts 的 flowSeconds/currentRoundArchived/reliableSpan 与 test/dispatch-advice.test.ts 的归档边界测试；复核 guide.ts 既有接线。
- acceptance_slice: 关闭历史三轮评审最后一项时长遗漏；之前已解决项不重新扩展。

## 验证证据
- `npm run typecheck` → PASS：当前主工作区四个工程。
- `node --test --test-timeout=120000 test/dispatch-advice.test.ts` → PASS：12/12，含30+100秒归档前后均130秒、重叠并集150秒、当前queued/running/时间未知。
- `node --test --test-timeout=120000 test/dispatch-advice.test.ts test/guide.test.ts test/task-cost.test.ts` → FAIL：32项中31通过；手册台账契约测试要求“标准以台账和 spec为准”，并行修改的commander.md已变为“标准仍以台账和 spec为准”，字符串断言不匹配，不是本轮时长逻辑回归。
- `git diff --check` → PASS。
- 完整 verify、UI、build、Electron → NOT_RUN，本轮只复审增量修正。

## Findings
- F-01 — resolved; severity: blocking; anchor: src/core/dispatch-advice.ts::flowSeconds; 已归档轮和未归档当前轮同时消费，已汇总记录不重复计算，时间证据不足保留未知。
- N-01 — accepted_note; severity: non_blocking; anchor: test/guide.test.ts::手册接入了任务台账约定; 合并前需协调并行手册文案与契约断言并重跑，不能声称当前主工作区全绿。

## 架构与范围结论
- alignment: 本轮已解决原阻断；保留只读参考，不派活、不换人、不改历史usage。
- scope: 仅验收最新修正；主工作区有大量其他任务未提交变更，不据此直接整包提交。
- preserved_behavior: 账本费用、未知预算、项目/仓库关联和已接受的样本规则保持。
- git_sync: 未执行；完整集成验收未通过且工作区含交叉修改，按自动同步前置要求保留全部本地改动，不提交、不推送。

## 优先级复核
- 已复核，无调整。TASK-015仍P2/High；TASK-016仍P2/High；TASK-018现有P1与其独立修正不变。

## 下一状态
- task_status: `PASSED`
- next_action: `none`
- next_capsule: `none`
- active_findings_for_next_attempt: `none`
