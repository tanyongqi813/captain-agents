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
| [TASK-010](tasks/TASK-010.md) | 负责人 AI 诊断与有界恢复协议 | PASSED | P1 | High | TASK-009 PASSED |
| [TASK-011](tasks/TASK-011.md) | 安全细拆、专用副本与自动验收闭环 | PASSED | P1 | High | TASK-010 PASSED |
| [TASK-012](tasks/TASK-012.md) | 无人看守控制台与恢复证据展示 | PASSED | P2 | Medium | TASK-011、TASK-013 PASSED |
| [TASK-013](tasks/TASK-013.md) | 需要主人事件与飞书可靠投递底座 | PASSED | P1 | High | TASK-010 PASSED |
| [TASK-014](tasks/TASK-014.md) | 设置页接入飞书机器人 | PASSED | P2 | High | TASK-013 PASSED |
| [TASK-015](tasks/TASK-015.md) | 按完成总成本生成派活参考 | READY | P2 | High | TASK-017 PASSED |
| [TASK-016](tasks/TASK-016.md) | 正常复审沉淀评分与难度证据 | READY | P2 | High | TASK-011、TASK-017 PASSED |
| [TASK-017](tasks/TASK-017.md) | 完成成本账本与中转站计价依据 | PASSED | P2 | High | 无 |
| [TASK-018](tasks/TASK-018.md) | 设置成本资料与额度未知时的预算 | READY | P2 | High | TASK-017 PASSED |
| [TASK-019](tasks/TASK-019.md) | Kimi 套餐查询与多窗口派发检查 | PASSED | P2 | High | 无 |

## 当前阶段

- 可执行：P1 TASK-010/011/013 与 P2 TASK-012/014/019 已完成。TASK-017 三轮复审通过，成本账本契约已可使用；TASK-015/016/018 前置满足并进入 READY，下一项先做 TASK-015（P2 / High）。本次不启动实现。保留已有独立副本，禁止整文件覆盖其他任务的新改动。
- 项目登记链：先打通安全、可测试的后台登记能力；界面和后续管理不能绕过该能力直接操作路径或登记文件。
- 规划驱动链：先统一负责人对任务台账的理解，再实现解析，最后接入工作台界面和派发；Task Spec 的推荐执行者不约束工作台选手。
- 无人看守链：先让每次执行都能有界停止并留下证据，再建自治执行台账和推进器，然后接负责人 AI 诊断/恢复，最后开放细拆、审查、验收和界面；任何阶段都不得无限重试。
- 主人通知链：TASK-010 先产出稳定的 `needs_owner` 原因；TASK-013 再把原因变成不依赖 AI 的持久通知事件并可靠投递；TASK-014 提供安全连接和测试入口。负责人 AI 额度耗尽本身也必须触发通知，不能让通知依赖同一个 AI。
- 成本与评价链：默认单家实现，负责人在正常复审后评分；以能达标为门槛，优先考虑完整任务成本，结合期限，最后检查剩余额度与预算。TASK-017 先提供失败/返工/复审/换人的成本依据，TASK-015 再给派活参考；TASK-018 接入价格、人工经验与额度未知时的本地预算；TASK-016 补齐难度/角色证据与幂等补评。不得为评分重复派题，不把轮换同池模型误当额度分流，也不把主人关于 DS 成本的经验写成固定供应商倍率。
- 群聊能力：主人已按 ADR-002 接受 Cursor 续接轮使用共享锁目录的有限风险；权限已收窄到 macOS Cursor 群聊续接轮并通过复审，真实窗口冒烟仍作为通过注记保留。
- Kimi 额度：TASK-019 已通过并整合；多窗口触顶、失败缓存、金额与统计口径已修正。集成补查修正了缺 Kimi 缓存时误刷新其他厂家停派依据的问题；账户来源未知单独落盘，其他家的有效事实保持不变。最终集成验收见 TASK-014 报告。
