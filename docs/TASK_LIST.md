# 功能任务清单

这里登记经过架构拆分、可交给实现代理执行的功能任务。状态以各 Task Spec 为准；Codex 负责规划与评审，实现代理只执行当前 `READY` 或被要求修正的任务。

| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 |
|---|---|---|---|---|---|
| [TASK-001](tasks/TASK-001.md) | 原生文件夹选择与安全项目登记桥 | PASSED | P1 | High | 无 |
| [TASK-002](tasks/TASK-002.md) | 设置页可视化登记项目 | PASSED | P1 | Medium | TASK-001 PASSED |
| [TASK-003](tasks/TASK-003.md) | 已登记项目的管理与高级配置 | PASSED | P2 | Medium | TASK-002 PASSED |
| [TASK-004](tasks/TASK-004.md) | 负责人规则接入项目任务台账 | PASSED | P1 | Low | 无 |
| [TASK-005](tasks/TASK-005.md) | 安全识别 TASK_LIST 与 Task Spec | PASSED | P1 | High | TASK-004 PASSED |
| [TASK-006](tasks/TASK-006.md) | 工作台任务规划视图与受控派发 | PASSED_WITH_NOTES | P1 | High | TASK-005 PASSED |
| [TASK-007](tasks/TASK-007.md) | 项目群聊支持 Cursor 成员 | PASSED_WITH_NOTES | P1 | High | 无 |
| [TASK-008](tasks/TASK-008.md) | 执行预算、停滞判定与可靠收尾 | PASSED | P1 | High | 无 |
| [TASK-009](tasks/TASK-009.md) | 自治执行记录与确定性推进器 | PASSED | P1 | High | TASK-006、TASK-008 PASSED |
| [TASK-010](tasks/TASK-010.md) | 负责人 AI 诊断与有界恢复协议 | READY | P1 | High | TASK-009 PASSED |
| [TASK-011](tasks/TASK-011.md) | 安全细拆、专用副本与自动验收闭环 | DRAFT | P1 | High | TASK-010 PASSED |
| [TASK-012](tasks/TASK-012.md) | 无人看守控制台与恢复证据展示 | DRAFT | P2 | Medium | TASK-011、TASK-013 PASSED |
| [TASK-013](tasks/TASK-013.md) | 需要主人事件与飞书可靠投递底座 | DRAFT | P1 | High | TASK-010 PASSED |
| [TASK-014](tasks/TASK-014.md) | 设置页接入飞书机器人 | DRAFT | P2 | High | TASK-013 PASSED |

## 当前阶段

- 可执行：TASK-003 与 TASK-009 已通过并整合；下一项为 `P1 High TASK-010`。独立任务继续使用独立 Git 工作副本，禁止整文件覆盖其他任务的新改动。
- 项目登记链：先打通安全、可测试的后台登记能力；界面和后续管理不能绕过该能力直接操作路径或登记文件。
- 规划驱动链：先统一负责人对任务台账的理解，再实现解析，最后接入工作台界面和派发；Task Spec 的推荐执行者不约束工作台选手。
- 无人看守链：先让每次执行都能有界停止并留下证据，再建自治执行台账和推进器，然后接负责人 AI 诊断/恢复，最后开放细拆、审查、验收和界面；任何阶段都不得无限重试。
- 主人通知链：TASK-010 先产出稳定的 `needs_owner` 原因；TASK-013 再把原因变成不依赖 AI 的持久通知事件并可靠投递；TASK-014 提供安全连接和测试入口。负责人 AI 额度耗尽本身也必须触发通知，不能让通知依赖同一个 AI。
- 群聊能力：主人已按 ADR-002 接受 Cursor 续接轮使用共享锁目录的有限风险；权限已收窄到 macOS Cursor 群聊续接轮并通过复审，真实窗口冒烟仍作为通过注记保留。
