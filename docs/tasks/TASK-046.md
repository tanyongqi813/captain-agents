# TASK-046 — 拆分子任务模型与自动汇合

- handoff_contract: `1`
- status: `DRAFT`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-045[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果
负责人给出明确 `split` 决定后，平台创建有独立 Task Spec、Capsule、状态和审计链的子任务，按依赖安全执行并汇合；父任务不再用多个“当前 Capsule”表达并行工作。

## 非目标
- 不在同一 Task Spec 上同时设置多个 `current_attempt`。
- 不实现跨项目队列，也不自动合并无法证明兼容的候选补丁。

## 架构设计
split 事务为每个节点分配稳定子任务 ID，生成独立 Task Spec 和首轮 Capsule，并在父任务保存只读子任务关系与汇合条件。子任务依赖形成无环图；只有依赖满足、写集不冲突且持有租约的节点可执行。全部子任务通过后，负责人对汇合结果做一次独立验收，再关闭父任务；任何子任务返工只推进自身 attempt。

## 兼容要求
- handoff_contract 1 的单任务单 `current_attempt` 语义不变。
- 旧的单节点运行继续按原数据读取，不要求迁移成父子任务。

## 验收标准
1. split 产生多个独立任务和 Capsule，父子引用、依赖与 Review Record 可追溯。
2. 子任务 DAG 有环、ID 冲突、写集冲突或边界不完整时整组拒绝，不留下半套文件。
3. 并行节点分别领取，失败/返工不覆盖兄弟节点的状态或已接受成果。
4. 所有子任务通过且汇合验收通过后父任务才进入终态；重启不重复创建子任务。

## 依赖与排序
- TASK-045 先证明单 Capsule 自动返工稳定；split 复用 TASK-028 事务，不另造发布入口。

## 主要接口
- `src/core/lead-capsule.ts` — split 提案到子任务制品的事务编译。
- `src/core/task-plan.ts` — 父子任务与依赖 DAG 校验。
- `src/core/autopilot-flow.ts` — 子任务调度和父任务汇合状态。

## 长期约束
- 一个 Task 始终只有一个当前 attempt；并行单位必须是独立 Task。
- 子任务创建不扩大项目级授权、文件写集或预算总额。

## 微批边界
- expected_primary_files: `3`
- exception_reason: `none`
