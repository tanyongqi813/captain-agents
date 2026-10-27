# Review Record — TASK-031 / attempt-02

- handoff_contract: `1`
- task_id: `TASK-031`
- attempt: `02`
- capsule: `docs/execution/TASK-031/attempt-02.md`
- reviewed_at: `2026-10-24`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围

- implementation_report: 用户提供的 attempt-02 报告；其他仓库 TASK-037 不在范围。
- diff_scope: src/core/deepseek-models.ts、test/deepseek-settings.test.ts。
- acceptance_slice: F-01～F-03 修正。

## 验证证据

- node --test --test-timeout=120000 test/deepseek-settings.test.ts → PASS，11/11，latest_code_covered: yes。
- npm run typecheck、git diff --check → PASS。
- 离线假凭据复现 A → FAIL：空目录下早发慢成功、晚发快 HTTP 503；失败因 current 为空不留顺序，旧成功最终写 stale=false。
- 离线假凭据复现 B → FAIL：空目录下已保存凭据请求先发慢回，临时凭据后发快回；最终缓存保留 temporary 且 accountVerified=false，合法已保存结果被 current.sequence 检查丢弃。
- 测试覆盖审计：手写未来 sequence 只证明读取落盘值，不等价于两个独立进程同毫秒争锁。

## Findings

- `F-01` — `resolved`; severity: `blocking`; anchor: `src/core/deepseek-models.ts::refreshDeepseekCatalog`; 临时失败不再改已存在权威目录。
- `F-02` — `resolved`; severity: `blocking`; anchor: `src/core/deepseek-models.ts::catalogFailure`; 新写入 failure 使用固定摘要与稳定码，原文不落盘。
- `F-03` — `active`; severity: `blocking`; anchor: `src/core/deepseek-models.ts::refreshDeepseekCatalog`; 只有全局分配号，没有与目录是否存在解耦的连接级权威请求预占。冷启动失败无法阻止旧成功回写；临时目录的高序号会挡住已保存凭据结果。须将连接级最新已保存请求记录与成功目录分离，锁内预占并在成功/失败时核对；临时请求不得占用或屏蔽该权威槽。补冷启动、临时交错与真实双进程替身测试。

## 架构与范围结论

- alignment: 修正方向正确；全局单调号解决撞号不等于完整发布顺序保护。
- scope: 两个白名单文件；工作区另有其他任务改动，不能声称全仓仅这两项修改。
- preserved_behavior: 不覆盖已接受的固定摘要与临时失败保护；原查询返回类型不改。

## 优先级复核

- 已复核，无调整。TASK-031 仍 P1 / High；后续任务不推进。

## 下一状态

- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-031/attempt-03.md`
- active_findings_for_next_attempt: `F-03`
