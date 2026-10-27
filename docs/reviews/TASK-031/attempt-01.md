# Review Record — TASK-031 / attempt-01

- handoff_contract: `1`
- task_id: `TASK-031`
- attempt: `01`
- capsule: `docs/execution/TASK-031/attempt-01.md`
- reviewed_at: `2026-10-22`
- verdict: `CHANGES_REQUESTED`
- reviewer_role: `lead-ai`

## 审查范围

- implementation_report: 用户提供的目录基础切片报告。
- diff_scope: src/core/deepseek-models.ts、test/deepseek-settings.test.ts。
- acceptance_slice: 目录持久化、连接隔离、临时密钥保护、并发与落盘隐私。

## 验证证据

- node --test --test-timeout=120000 test/deepseek-settings.test.ts → PASS，9/9，latest_code_covered: yes。
- npm run typecheck → PASS，latest_code_covered: yes。
- git diff --check → PASS。
- 临时目录和假密钥离线复现 → FAIL：临时密钥异常把 accountVerified=true 的缓存标 stale，且 failure 原样包含假 Authorization。
- 早发慢成功、晚发快失败离线复现 → FAIL：早发成功将较新的失败状态清为 stale=false。
- 静态检查序号 → FAIL：Date.now 加进程内小数序号不是跨进程唯一顺序，同毫秒不同进程可相同；失败分支也未记录最新请求序号。

## Findings

- `F-01` — `active`; severity: `blocking`; anchor: `src/core/deepseek-models.ts::refreshDeepseekCatalog`; 临时密钥成功路径保护没有覆盖失败路径；临时查询失败不得改写已保存连接目录的任何字段。
- `F-02` — `active`; severity: `blocking`; anchor: `src/core/deepseek-models.ts::refreshDeepseekCatalog`; error.message 直接落盘，可能带密钥、Authorization 或 URL 中敏感数据；只保存稳定错误码和固定中文摘要，异常对象不可信，不可通过截断充当脱敏。
- `F-03` — `active`; severity: `blocking`; anchor: `src/core/deepseek-models.ts::nextSequence`; 请求顺序必须在跨进程锁下预占单调序号并记录最新有资格请求，成功与失败对称核对；较新失败后早请求不得写回，保留最后成功列表和时间且仍 stale。临时请求不得占用权威请求排序槽。

## 架构与范围结论

- alignment: 目录基础接口和现有查询返回类型保持，UI/运行身份尚未接入，不能标整个 TASK-031 通过。
- scope: 两个改动文件均在白名单。
- preserved_behavior: 保留查询超时、重定向限制、连接目录隔离和原解析语义。

## 优先级复核

- 已复核，无调整；TASK-031 仍为 P1 / High，后续任务不推进。

## 下一状态

- task_status: `READY_FOR_CORRECTION`
- next_action: `correction`
- next_capsule: `docs/execution/TASK-031/attempt-02.md`
- active_findings_for_next_attempt: `F-01,F-02,F-03`
