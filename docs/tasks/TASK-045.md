# TASK-045 — 修复胶囊自动续跑与执行器回退

- handoff_contract: `1`
- status: `DRAFT`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-028[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果
负责人给出明确 `correct` 决定后，平台使用已事务发布并领取的新 Capsule 自动继续；原会话不可恢复时，自动启动新的合格执行器接棒，纯运行故障不要求主人点击。

## 非目标
- 不实现一个任务拆成多个并行子任务。
- 不开放任意自由提示词续跑，不绕过 Capsule、补丁、权限、预算或 Git 起点校验。

## 架构设计
负责人决定先绑定候选补丁、当前 Capsule、证据包和稳定指纹，再交 TASK-028 的事务入口发布并领取。优先恢复原执行会话；会话缺失、损坏或超出恢复时限时，从同一新 Capsule 启动新执行器，并在启动前恢复可核对的候选补丁。暂时限流、进程退出和启动失败使用有上限的退避/换人策略；需求含糊、权限/凭据、不可逆副作用、预算耗尽或状态损坏才转 `needs_owner`。

## 兼容要求
- 保留现有负责人五动作协议；旧运行缺少恢复证据时安全求助，不猜测。
- `stalled`、`timed_out`、手动停止和外部取消继续保持可区分。

## 验收标准
1. 已保存 session 可用时，新 Capsule 正文替代继续标记并自动送达原执行器。
2. session 丢失但候选补丁与起点可核对时，自动启动新执行器并只执行新 Capsule。
3. 同一决定崩溃重放不重复启动；只有租约持有者可以续跑。
4. 限流或执行器异常先有界重试/回退；只有明确硬停止条件才通知主人。
5. 测试证明执行器实际收到新 Capsule，且旧 Capsule、任意 prompt 或过期补丁不能续跑。

## 依赖与排序
- TASK-028 先提供完整规划事务、审计链、执行基准和领取租约；本任务完成后再做 split。

## 主要接口
- `src/core/autopilot-flow.ts` — correct 决定后的确定性状态转移。
- `src/core/autopilot-engine.ts` — 原会话恢复和新执行器回退。
- `src/core/autopilot.ts` — 续跑次数、租约与幂等启动登记。

## 长期约束
- 自动续跑有明确轮次、时间和调用上限；运行故障不等于需求不明确。
- 新执行器不得继承未核对的外部副作用或超出 Capsule 的上下文。

## 微批边界
- expected_primary_files: `3`
- exception_reason: `none`
