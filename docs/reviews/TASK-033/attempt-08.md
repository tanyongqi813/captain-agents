# Review Record — TASK-033 / attempt-08

- handoff_contract: `1`
- task_id: `TASK-033`
- attempt: `08`
- capsule: `docs/execution/TASK-033/attempt-08.md`
- reviewed_at: `2026-10-28`
- verdict: `PASSED`
- reviewer_role: `lead-ai`

## 审查范围
- implementation_report: `docs/implementation/TASK-033-attempt-08.md`
- diff_scope: 单核心文件本轮分组增量及新测试，其他历史差异不批准同步。
- acceptance_slice: 组账本核心和旧账兼容，非多组运行完整集成。

## 验证证据
- `node --test --test-timeout=120000 test/money-budget-groups.test.ts test/money-budget.test.ts test/money-budget-margin.test.ts test/money-budget-identity.test.ts` → PASS22/22（新增5项），无纠偏。
- `npm run typecheck`四工程、`git diff --check` → PASS。
- 首次显式新组升级v2，root days/stopped与旧Entry深比较不变；旧模型无identity仍未知。默认0.2消费/0.8预留及停派锁保持，新组独立预留1且不受默认停派影响，跨进程冷读一致。
- B组上限锁不影响C组，B组跨日迟到增量0.5仍进B、未知区间保留，重放原账字节不变；默认消费不变。
- 回收B组终态只在B兜底1元并释放0.5安全余量，默认仅持有自身新预留。两独立进程同组1元容量仅1成功，C组可独立预留。
- 归属篡改、身份与组错配、原型保留名、坏版本、v1带分组及v2缺组均拒绝；不合法请求不改变原账。
- 源码复核所有余额/预留/计费路径使用冻结会计组；旧缺组统一default，不从历史identity猜移。显式组与身份分离，旧标签本身仍不产生额度。
- 降级核对为源码证据：此前v1读取器严格拒绝version!=1；新组写v2，不能被旧代码当空账。未实际运行旧二进制，不声称跨版本发布已测。
- UI/build/窗口/全量/真实服务均NOT_RUN。

## Findings
- none，本切片无新增阻断。

## 架构与范围结论
- alignment: 同文件同锁原子升级，旧默认历史不清空、不复制到新组；新组只由显式参数选择。
- scope: 两白名单文件，未改生产设置/派发/runner或权限。
- preserved_behavior: 旧调用仍default且不升级v2；定点金额、余量、冻结价及未知兜底保持。
- task_rollup: TASK-033仍IN_PROGRESS。当前生产仍默认组，多组设置/阈值归属和组内停止未接线，不能因22/22宣称完整多账户可用或TASK-034通过。尤其runner须按Job冻结组取该组配置，不能把当前编辑连接的阈值用于别组。

## 优先级复核
- 已复核，无调整，P1 / High；下一范围为每组配置解析和运行快照绑定，先合同后接线。

## 下一状态
- task_status: `PASSED`
- next_action: `none`
- next_capsule: `none`
- active_findings_for_next_attempt: `none`
- status_scope: 仅预算组账本核心。
