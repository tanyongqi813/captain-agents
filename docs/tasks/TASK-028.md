# TASK-028 — 规划事务、审计链与认领租约

- handoff_contract: `1`
- status: `IN_PROGRESS`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-027[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `03`

## 业务结果

负责人生成的新规划能以可恢复、可重放的事务发布；Task Spec、TASK_LIST、Execution Capsule、Review Record 和领取租约始终指向同一轮次，不会因崩溃或多工作台并发留下半套规划或重复派发。

## 非目标

- 不决定 `correct` 如何选择或恢复执行器，由 TASK-045 负责。
- 不在同一任务下发布多个并行当前 Capsule，由 TASK-046 负责拆分模型。
- 不实现 DRAFT 自动规划、队列选择或历史界面归档。

## 架构设计

建立唯一的规划事务入口。事务先以稳定 transaction id、候选指纹和预期文件摘要登记意图，再在同一项目锁内以内容哈希 CAS 重读并校验，写入暂存制品，最后通过提交标记或单一权威指针一次切换可见状态。启动时检测未完成事务并确定性完成或回滚；同一指纹重放应接管既有结果，不创建新 attempt。

修正发布必须同时追加上一轮 Review Record、关闭旧 Capsule、发布新 Capsule，并更新 Task Spec/TASK_LIST。若新执行将立即由当前无人看守领取，事务直接把新 Capsule 置为 `CLAIMED` 并保存唯一租约，不经过可被其他调度器领取的公开 `READY` 窗口。Git 执行基准另以 ADR 明确采用“项目一次性授权的任务范围自动提交”或独立不可变规划 ref；没有授权时不得宣称可跨重启派发。

## 兼容要求

- 保持 handoff_contract 1 的公开字段和值；历史 Capsule 与 Review Record 不覆写。
- 未采用自动 Git 发布的旧项目保持现有手动同步行为，不能静默提交。

## 验收标准

1. 在事务的每个落盘边界模拟进程退出，恢复后都只出现完整的旧轮次或完整的新轮次。
2. 相同 transaction id/候选指纹重复执行只返回已发布结果；不同内容占用同一 attempt 时拒绝并保留证据。
3. Review Record、旧 Capsule 关闭、新 Capsule、Task Spec、TASK_LIST 和租约成组一致，结构校验通过。
4. 两个工作台并发领取时只有一个持有有效租约；租约过期与接管有确定规则，不重复启动执行器。
5. 规划文件发生并发人工修改时 CAS 拒绝覆盖；错误和恢复记录不包含凭据或原始模型文本。
6. 新规划在所选 Git/规划基准中可跨进程重启读取；未获项目级授权时停止在安全状态。

## 依赖与排序

- TASK-027 已建立唯一负责人复审环；本任务是 TASK-045、TASK-046 和 TASK-043 的一致性底座，在当前 P1 自动化链中最先处理。

## 主要接口

- `src/core/lead-capsule.ts` — 规划事务、CAS、幂等恢复与完整制品集合。
- `src/core/autopilot.ts` — 领取租约和跨重启恢复登记。
- `src/core/dispatch.ts` — 执行基准与 Capsule 起点校验。
- `docs/decisions/` — 自动规划发布的 Git/不可变基准 ADR。

## 长期约束

- 锁不是事务；不得用“持锁后依次改名”宣称多文件原子发布。
- 不覆盖用户未提交的规划修改，不自动扩大 Git 提交范围，不让租约替代权限与预算校验。

## 微批边界

- expected_primary_files: `3–4`
- exception_reason: `事务存储、领取租约与起点基准必须作为一个不可分割的一致性切片验证；ADR 为同一决策的必要制品。`
