# TASK-025 — 直接消费执行胶囊派活

- handoff_contract: `1`
- status: `PASSED`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-024[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果

工作台以当前 `docs/execution/TASK-XXX/attempt-NN.md` 为下游 AI 的唯一执行合同，不再把整份 Task Spec 或机械摘要当作提示词；DeepSeek/Kimi 的节流适配在合同外层追加。

复刻主人已经验证过的人工流程：负责人先从 Task Spec 生成本轮 Capsule；工作台只负责把 Capsule 交给执行者并等待；执行者的精简 Implementation Report 和实际 diff 回到负责人；负责人复审后通过，或只生成一次增量修正 Capsule。自由群聊中的“完成 TASK-XXX”不是机器派活入口。

## 验收标准

1. READY 任务只有在当前 Capsule 存在、交叉引用一致且校验通过时可派。
2. 发给选手的正文来自 Capsule 的受限字段，不含完整 Task Spec、TASK_LIST 或历史评审。
3. DeepSeek/Kimi 继续追加模型适配，其他模型不受影响。
4. 旧项目没有 Capsule 时明确诊断并保持不可自动派发，允许负责人先迁移或生成 Capsule。
5. 派活副本的起点必须包含当前 Capsule 与其源码锚点；若登记项目默认分支落后于规划分支，派发前拒绝并指出两个提交号，不让执行者自行跨副本找任务。
6. 执行结束后只把 Implementation Report、diff、验证证据交回负责人复审；负责人未给出通过结论前，不领取下一任务。
7. 自动修正最多一次，且只发送新的 delta Capsule；不得续接无界群聊历史或重发整份 Task Spec。

## 前置任务

等待 TASK-024 通过后形成精确执行胶囊。

## 非目标

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 架构设计

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 兼容要求

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 依赖与排序

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 主要接口

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 长期约束

待确认（旧文档未提供独立字段；迁移器未推断内容）。

## 微批边界

待确认（旧文档未提供独立字段；迁移器未推断内容）。
