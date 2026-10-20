# Review Record — TASK-016 / attempt-01

- task_id: `TASK-016`
- attempt: `01`
- capsule: `legacy-task-spec-only`
- reviewed_at: `2026-10-20`
- verdict: `PASSED_WITH_NOTES`
- reviewer_role: `lead-ai`

## 审查范围
- implementation_report: .worktrees/task-016/docs/tasks/TASK-016.md 的首轮修正报告。
- diff_scope: .worktrees/task-016 @ feat/task-016-rating，src/core/rate.ts 与 test/rate.test.ts；未将实现复制到主工作区。
- acceptance_slice: 关闭首轮并发自动落分幂等与验收证据覆盖两项阻断。

## 验证证据
- `npm run typecheck`（task-016 worktree）→ PASS：四个工程。
- `node --test --test-timeout=120000 test/rate.test.ts`（同worktree）→ PASS：12/12。
- 人工检查 rate::changeJob 回调 → PASS：同source幂等、已有其他来源评分禁止覆盖均在锁内读取最新记录；手动评分历史仍保留。
- 人工检查 noteEvidence → PASS：调用方证据合并后以锁内verifyOf(job)覆盖verify；rating/evaluation两处一致。
- `git diff --check`（同worktree）→ PASS。
- 全量核心/UI/构建/Electron、合并后集成验证 → NOT_RUN；本轮不重复扩大为整任务实现重审。

## Findings
- F-01 — resolved; severity: blocking; anchor: src/core/rate.ts::rate; 两路并发同source只产生一份评分，不增加previous，双方读取同一结果。
- F-02 — resolved; severity: blocking; anchor: src/core/rate.ts::noteEvidence; passed/failed/skipped/missing权威验收均不能被传入相反结论覆盖，补证据不改分。
- N-01 — accepted_note; severity: non_blocking; anchor: .worktrees/task-016; 修正通过不等于实现已合入主线或已安装，合并需逐文件处理与主工作区其他任务的冲突并重新验收。

## 架构与范围结论
- alignment: 原两项缺陷关闭，评分不增加AI尝试，不回滚任务收尾。
- scope: 只复审首轮两项修正，保留先前接受的实现边界。
- preserved_behavior: 自动评分不覆盖手动评分、评分历史、非评分任务字段保持。
- git_sync: 未执行；该副本尚未完成合并验收，主工作区有独立并行改动，不自动提交混合内容或切换分支。

## 优先级复核
- 已复核，无调整。TASK-016仍P2/High；TASK-015仍P2/High；TASK-018现有P1与其独立修正不变。

## 下一状态
- task_status: `PASSED`
- next_action: `none`
- next_capsule: `none`
- active_findings_for_next_attempt: `none`
