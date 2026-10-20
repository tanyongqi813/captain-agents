# TASK-025：直接消费执行胶囊派活

- 状态：`DRAFT`
- 优先级：`P1`
- 难度：`High`
- 前置任务：`TASK-024` 评审为 `PASSED` 或 `PASSED_WITH_NOTES`

## 业务结果

工作台以当前 `docs/execution/TASK-XXX/attempt-NN.md` 为下游 AI 的唯一执行合同，不再把整份 Task Spec 或机械摘要当作提示词；DeepSeek/Kimi 的节流适配在合同外层追加。

## 验收标准

1. READY 任务只有在当前 Capsule 存在、交叉引用一致且校验通过时可派。
2. 发给选手的正文来自 Capsule 的受限字段，不含完整 Task Spec、TASK_LIST 或历史评审。
3. DeepSeek/Kimi 继续追加模型适配，其他模型不受影响。
4. 旧项目没有 Capsule 时明确诊断并保持不可自动派发，允许负责人先迁移或生成 Capsule。

## 前置任务

等待 TASK-024 通过后形成精确执行胶囊。
