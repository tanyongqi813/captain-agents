# 待审任务核查 — 2026-10-27

## 结论与范围

本轮结论 CHANGES_REQUESTED：没有新增整项 PASSED。审查当前工作区、任务文档及定向替身证据；不修改实现、不收费调用、不提交或同步代码。使用 architect-pm-handoff 区分长期任务与执行切片，没有把历史报告的通过数量当作最新完整验收。

| 任务 | 本轮确认 | 尚未关闭的事项 |
|---|---|---|
| TASK-018 | 在指定 .worktrees/task-018 核查，typecheck 仍有 9 项错误；settings-cost 测试仍使用非法 claude 通道，并未覆盖 concurrent 清空保存 | 原 F-08/F-09 未解决；沿用现有 attempt-06，不追造完成报告或覆写历史合同 |
| TASK-031 | 冷启动与双进程请求屏障测试通过，F-03 的所述边界已有实现证据 | 整任务不通过：自动刷新仍缺；dispatch 仅在目录非陈旧时校验模型存在，模型已被目录移除后，后续失败使目录 stale 就跳过这项拒绝；需补回归并明确陈旧策略 |
| TASK-032 | 默认模式省略强度参数已有替身验证 | workers.ts 直接按 default/非 default 拼参数，无已确认能力来源及档位校验；UI “需服务方支持”提示不能替代启动前检查；无错误触发的一次有界目录刷新证据 |
| TASK-033 | 金额公式、幂等、预留及无用量停止相关定向测试通过 | 新 F-01 已复现：零字节账本被重置；正式记录及下一轮见 reviews/TASK-033/attempt-01.md、execution/TASK-033/attempt-02.md。多账户组、缓存写入独立口径、跨日未知归属仍不等同完成 |
| TASK-034 | 假选手达到金额上限停止、收尾账本损坏仍保留报告与补丁测试通过 | 依赖 TASK-033 安全修正；分组隔离、暂停/睡眠/重启及迟到费用完整验收未完成，不能用单个停止测试代替全部验收 |
| TASK-035 | 编辑入口、保存回调、取消及换模型清价组件测试 2/2 | 编辑组件只展示当次取得的模型数量，未呈现目录 fetchedAt/stale；缺计划要求的安全余量及剩余金额展示。历史截图未作为本轮最新截图重新验收 |

TASK-028 为 READY 待执行，无完成报告，不属于已实现待复审；TASK-043/044 为 DRAFT。TASK-041/042 已有通过记录，本轮没有重复宣称完成验收。

## 最新验证

- `node --test --test-timeout=120000 test/deepseek-settings.test.ts test/money-budget-runner.test.ts test/deepseek-credentials.test.ts`：PASS，21/21。
- 主仓 `npm run typecheck`：PASS，四工程。
- `npm run test:ui -- test/ui/deepseek-money.test.tsx test/ui/settings-cost.test.tsx`：仅主仓存在的 deepseek-money 运行，PASS 2/2；不能声称 settings-cost 测试通过。
- TASK-018 独立副本 `npm run typecheck`：FAIL，cost-budget.ts 56/69/71/80 行共 9 项 unknown 收窄错误；未动该副本。
- 临时 XAGENTS_HOME 复现：结算 1 元 → 零字节账本 → spent=0 → 新预留成功，FAIL；真实数据不受影响。
- TASK-033 attempt-02 planning 结构校验：PASS。
- TASK-033 历史直接实施的 Review Record 使用 legacy-task-spec-only。当前验证器 review 模式强制要求历史 Capsule，未支持该兼容指针，review 结构校验 FAIL。未追造旧 Capsule，也未冒称整个审查包机器验证通过；不输出自动派发信号。
- `git diff --check`：PASS。
- 全量 verify、build、桌面 e2e、真实中转站：NOT_RUN，不构成发布验收。

## 优先级复核

已复核，无调整，相关任务保持 P1。执行顺序建议先修 TASK-033 的坏账本放行，再补 TASK-031/032 的身份与能力边界，之后收口 TASK-034/035 的单任务收费验收；TASK-018 在自己的副本修原问题，不能整文件覆盖主仓。扩大无人看守之前先过收费安全门槛。

本轮只建立 TASK-033 的窄修复 Capsule，未启动任何任务；其他任务需要后续按上述缺口分别生成切片，不将未满足前置条件的任务自动激活。
