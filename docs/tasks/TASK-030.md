# TASK-030 — 任务能力画像与初始执行者选择

- handoff_contract: `1`
- status: `DRAFT`
- priority: `P2`
- difficulty: `High`
- dependencies: `TASK-016[PASSED|PASSED_WITH_NOTES], TASK-025[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果

新任务根据能力画像、可验证历史、完成总成本、期限和可用性推荐初始执行者，使每位执行者都能在适合的任务上被首选，而不只能等回退队列轮到。

## 非目标

- 不从单次失败推断永久能力。
- 不把人工标签当成硬证据或用来绕过闸门。
- 不在本任务启动自动队列或改变回退顺序。

## 架构设计

Task Spec 或 Capsule 提供有限任务特征：`iteration_heavy`、`large_data`、`audit_strict`、`latency_sensitive`、`state_recovery`、`bounded_validation`、`read_only_analysis`。特征是任务事实，不含供应商名称。选择器先应用开关、额度、登录、隔离、权限、预算和文件冲突硬门，再比较同特征下的验收、返工、用时和成本。样本不足时明确不确定。

## 兼容要求

- 旧 Task 没有特征时视为未知，仍可使用现有类型和成本参考。
- 外部原因样本不计入能力；未知特征不自由扩展。

## 验收标准

1. 有限特征可解析、校验、展示并安全投影进 Capsule。
2. 选择先做达标和安全门槛，再比较成本、期限和额度。
3. 只读分析或严格审计可直接首选匹配执行者，无需先等别人失败。
4. 迭代密集、延迟敏感或状态恢复可降低不匹配候选优先级，但不永久排除。
5. 推荐解释列出证据、样本数和不确定性，不把回退顺序当能力排名。

## 依赖与排序

- TASK-016 提供评价证据；TASK-025 提供 Capsule 契约。

## 主要接口

- `src/core/task-plan.ts` — 任务特征解析与投影。
- `src/core/dispatch-advice.ts` — 特征匹配和初始执行者建议。
- `src/core/profiles.ts` — 按任务特征分组的历史证据。

## 长期约束

- 能力参考是可解释软信号，不能越过主人开关或安全底线。
- 历史数据不得泄漏项目内容、提示词或日志原文。

## 微批边界

- expected_primary_files: `3`
- exception_reason: `none`
