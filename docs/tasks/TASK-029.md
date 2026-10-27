# TASK-029 — 有序写手回退与最终失败通知

- handoff_contract: `1`
- status: `DRAFT`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-027[PASSED|PASSED_WITH_NOTES], TASK-028[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果

当前写手因额度、登录、启动、并发名额或无改动失败无法继续时，负责人在主人允许的有序候选中安全切换。只有候选用尽或换人不安全时才通知主人。

## 非目标

- 不同时启动多位写手竞赛同一任务。
- 不在改动、外部副作用或会话状态未明时换人。
- 不把回退顺序当成新任务的能力排名。

## 架构设计

登记保存有序候选、当前下标和每位候选的结果。每次切换前由负责人决定 `handoff`，核心再校验失败类型、未接受改动、外部副作用、候选开关、额度、登录、隔离和并发。切换只记进度事件，不创建 `ownerEvent`；只有最终 `needs_owner` 才入通知账本。

## 兼容要求

- 旧记录的单写手视为长度 1 的候选队列。
- 保留 owner notice 幂等、TTL、退避和已处理语义。
- 禁用执行者不进候选；未知额度不伪装成充足。

## 验收标准

1. 候选顺序、当前下标、拒绝原因和尝试令牌持久化，重启不重派。
2. 可换人失败且无改动时能切到下一候选，任务目标和 Capsule 不变。
3. 已有改动、副作用不明、证据缺失或任务本身失败不会被误分类。
4. 前面候选失败而后面启动成功时不通知；候选用尽时只投递一条汇总通知。
5. 预算、并发和崩溃窗口中仍保证同时只有一位写手。

## 依赖与排序

- TASK-027 提供 `handoff` 决策；TASK-028 提供中断后安全现场证据。

## 主要接口

- `src/core/autopilot.ts` — 候选队列、当前写手与尝试登记。
- `src/core/autopilot-engine.ts` — 失败分类、顺序切换和单写手状态机。
- `src/core/owner-notifications.ts` — 仅最终求助入账。

## 长期约束

- 候选顺序不得被执行者回包改写。
- 换人不能绕过额度、成本、隔离、网络或项目授权，且计入总预算。

## 微批边界

- expected_primary_files: `3`
- exception_reason: `none`
