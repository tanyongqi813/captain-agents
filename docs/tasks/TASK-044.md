# TASK-044 — 已通过任务的旧无人看守记录归档

- handoff_contract: `1`
- status: `DRAFT`
- priority: `P2`
- difficulty: `Medium`
- dependencies: `TASK-042[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果
任务已是 PASSED/PASSED_WITH_NOTES 且旧运行已经停止时，它之前留下的 needs_owner/stopped 无人看守运行不再伪装成当前待办，而是标记为被任务终态取代并进入“已结束的无人看守”；原始原因、通知和证据仍可查。

## 非目标
- 不删除、改写或自动清理历史运行及证据。

## 架构设计
核心先核对运行是否仍活跃，再将运行自身结论与当前 Task Spec 状态分开投影：运行保留原状态，另增 `superseded_by_task_terminal` 归档事实。对应“需要主人处理”通知确定性标为已处理/被取代，当前待办计数同步扣除。若任务已通过但旧执行器仍活跃，先停止或进入一致性告警，不能只靠界面隐藏。

## 兼容要求
- 任务文档缺失、损坏或未达终态时不猜测已解决；旧 View 字段缺失按未归档处理。

## 验收标准
1. TASK-024 这类已通过任务的旧求助运行只出现在已结束分组，不占“需要主人处理”顺位。
2. 详情仍展示原停机原因、时间线、验收和补丁证据，并标注“后续任务已通过”。
3. 未通过任务的 needs_owner 运行排序和通知语义不变。
4. 任务已通过但运行仍活跃时不会静默归档；完成停机与登记协调后才进入已结束分组。
5. 当前待办数量、飞书/桌面通知状态与归档事实一致，重启后不重复提醒。

## 依赖与排序
- 与 TASK-043 技术上独立；按产品优先级排在自动派发闭环之后实施，不建立伪依赖。

## 主要接口
- `src/core/autopilot-view.ts` — 运行与当前任务终态的只读联合投影。
- `src/core/owner-event.ts` — 被任务终态取代的通知协调。
- `src/core/view-types.ts` — 归档展示事实。
- `app/renderer/components/Autopilot.tsx` — 当前/已结束分组及详情标识。

## 长期约束
- 文档终态只影响展示分组，不反向篡改运行登记或历史证据。

## 微批边界
- expected_primary_files: `4`
- exception_reason: `运行归档事实、通知协调和两个只读展示接口必须保持一致。`
