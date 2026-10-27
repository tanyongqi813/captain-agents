# 功能任务清单

这里登记经过架构拆分、可交给实现代理执行的功能任务。状态以各 Task Spec 为准；Codex 负责规划与评审，实现代理只执行当前 `READY` 或被要求修正的任务。

| ID | 标题 | 状态 | 优先级 | 难度 | 前置任务 | 当前执行 |
|---|---|---|---|---|---|---|
| [TASK-001](tasks/TASK-001.md) | 原生文件夹选择与安全项目登记桥 | PASSED | P1 | High | none | none |
| [TASK-002](tasks/TASK-002.md) | 设置页可视化登记项目 | PASSED | P1 | Medium | TASK-001 | none |
| [TASK-003](tasks/TASK-003.md) | 已登记项目的管理与高级配置 | PASSED | P2 | Medium | TASK-002 | none |
| [TASK-004](tasks/TASK-004.md) | 负责人规则接入项目任务台账 | PASSED | P1 | Low | none | none |
| [TASK-005](tasks/TASK-005.md) | 安全识别 TASK_LIST 与 Task Spec | PASSED | P1 | High | TASK-004 | none |
| [TASK-006](tasks/TASK-006.md) | 工作台任务规划视图与受控派发 | PASSED_WITH_NOTES | P1 | High | TASK-005 | none |
| [TASK-007](tasks/TASK-007.md) | 项目群聊支持 Cursor 成员 | PASSED_WITH_NOTES | P1 | High | none | none |
| [TASK-008](tasks/TASK-008.md) | 执行预算、停滞判定与可靠收尾 | PASSED | P1 | High | none | none |
| [TASK-009](tasks/TASK-009.md) | 自治执行记录与确定性推进器 | PASSED | P1 | High | TASK-006, TASK-008 | none |
| [TASK-010](tasks/TASK-010.md) | 负责人 AI 诊断与有界恢复协议 | PASSED | P1 | High | TASK-009 | none |
| [TASK-011](tasks/TASK-011.md) | 安全细拆、专用副本与自动验收闭环 | PASSED | P1 | High | TASK-010 | none |
| [TASK-012](tasks/TASK-012.md) | 无人看守控制台与恢复证据展示 | PASSED | P2 | Medium | TASK-011, TASK-013 | none |
| [TASK-013](tasks/TASK-013.md) | 需要主人事件与飞书可靠投递底座 | PASSED | P1 | High | TASK-010 | none |
| [TASK-014](tasks/TASK-014.md) | 设置页接入飞书机器人 | PASSED | P2 | High | TASK-013 | none |
| [TASK-015](tasks/TASK-015.md) | 按完成总成本生成派活参考 | PASSED | P2 | High | TASK-017 | none |
| [TASK-016](tasks/TASK-016.md) | 正常复审沉淀评分与难度证据 | PASSED | P2 | High | TASK-011, TASK-017 | none |
| [TASK-017](tasks/TASK-017.md) | 完成成本账本与中转站计价依据 | PASSED | P2 | High | none | none |
| [TASK-018](tasks/TASK-018.md) | 设置成本资料与额度未知时的预算 | CHANGES_REQUESTED | P1 | High | TASK-017 | attempt-06 |
| [TASK-019](tasks/TASK-019.md) | Kimi 套餐查询与多窗口派发检查 | PASSED | P2 | High | none | none |
| [TASK-020](tasks/TASK-020.md) | Task Spec 执行边界进入派活题目 | PASSED | P1 | Medium | none | none |
| [TASK-021](tasks/TASK-021.md) | DeepSeek/Kimi 上下文节流适配 | PASSED | P1 | Medium | TASK-020 | none |
| [TASK-022](tasks/TASK-022.md) | 负责人提示词与执行胶囊解耦 | PASSED | P1 | Low | TASK-020, TASK-021 | none |
| [TASK-023](tasks/TASK-023.md) | 负责人切换与诊断角色澄清 | PASSED | P1 | Medium | TASK-022 | none |
| [TASK-024](tasks/TASK-024.md) | 规划共享契约与安全迁移校对 | PASSED | P1 | High | TASK-023 | none |
| [TASK-025](tasks/TASK-025.md) | 直接消费执行胶囊派活 | PASSED | P1 | High | TASK-024 | none |
| [TASK-026](tasks/TASK-026.md) | 项目内与跨项目授权并行队列 | DRAFT | P1 | High | TASK-025, TASK-027, TASK-028, TASK-029, TASK-030 | none |
| [TASK-027](tasks/TASK-027.md) | 单负责人复审与人工等价交接 | IN_PROGRESS | P1 | High | TASK-025, TASK-039, TASK-040 | attempt-02 |
| [TASK-028](tasks/TASK-028.md) | 主动停滞中断与负责人重规划 | DRAFT | P1 | High | TASK-027 | none |
| [TASK-029](tasks/TASK-029.md) | 有序写手回退与最终失败通知 | DRAFT | P1 | High | TASK-027, TASK-028 | none |
| [TASK-030](tasks/TASK-030.md) | 任务能力画像与初始执行者选择 | DRAFT | P2 | High | TASK-016, TASK-025 | none |
| [TASK-031](tasks/TASK-031.md) | 连接模型目录与实际运行身份同步 | IN_PROGRESS | P1 | High | TASK-025 | attempt-03 |
| [TASK-032](tasks/TASK-032.md) | 连接推理强度默认值与能力校验 | IN_PROGRESS | P1 | High | TASK-031 | none |
| [TASK-033](tasks/TASK-033.md) | 每日预估金额账本与双阈值 | IN_PROGRESS | P1 | High | TASK-031 | none |
| [TASK-034](tasks/TASK-034.md) | 金额看管与达到上限独立停机 | IN_PROGRESS | P1 | High | TASK-033 | none |
| [TASK-035](tasks/TASK-035.md) | 连接编辑中的每日费用配置与状态展示 | IN_PROGRESS | P1 | High | TASK-032, TASK-034 | none |
| [TASK-036](tasks/TASK-036.md) | 执行通道有界读取探测与阶段证据 | DRAFT | P1 | Medium | none | none |
| [TASK-037](tasks/TASK-037.md) | 执行进度与重复读取的确定性检测 | DRAFT | P1 | High | TASK-036 | none |
| [TASK-038](tasks/TASK-038.md) | 停滞看管接入与有界停机证据 | DRAFT | P1 | High | TASK-037 | none |
| [TASK-039](tasks/TASK-039.md) | 负责人有界证据包与五动作协议底座 | PASSED | P1 | High | TASK-025 | none |
| [TASK-040](tasks/TASK-040.md) | 增量执行胶囊编译与边界继承 | PASSED | P1 | High | TASK-039 | none |

## 当前阶段

- 负责人闭环进度（2026-10-27）：TASK-039/040 底座已接入 TASK-027 attempt-02 的显式 CLI `--lead-review`。新模式绑定受信 Codex 负责人、当前 Capsule 和受审候选，原子保存五动作决定及整组增量制品，支持恢复；旧模式/UI 不自动切换。accept 后运行登记验收；correct/split 保存未提交制品并求助，不绕过起点检查，不自动提交或启动下一轮。TASK-027 保持 IN_PROGRESS，下一切片为 UI 显式入口及授权后的安全续跑。

- 直接实施检查点（2026-10-26）：主人授权负责人直接开发。TASK-031 的 F-03 已修正并补双进程测试，手动目录查询已接持久缓存，界面与实际任务使用保存模型 ID；任务冻结模型与连接。TASK-032 已加默认推理强度；TASK-033～035 已实现共享人民币账本、原子预留、软/上限与无用量停止、编辑界面。均先标 IN_PROGRESS，不能等同发布验收通过；之前全量旧自治回归问题已修正，历史基线通过，最新模块定向验收和剩余事项见 implementation/2026-10-26-first-usable.md。未启动真实收费任务，未发布安装包。

- 执行通道稳定性（2026-10-22）：TASK-036 有界诊断 → TASK-037 有效进展与重复读取检测 → TASK-038 独立看管停止；安排在费用配置可用后、无人看守开放前。若优先使用 Cursor 通道，则在该通道试用前前移。真实探测不自动执行，不重启 IDE；样本不足不声称经常卡顿。该链与 TASK-028 的负责人重规划职责分开。

- 最早可用路线（2026-10-22）：先安全整合已通过的 TASK-024/025；随后 TASK-031 → TASK-032 → TASK-033 → TASK-034 → TASK-035，完成单任务受控派发与金额保护，再进行一次完整集成验收和小额真人冒烟。TASK-027 暂缓（保留未执行 Capsule）；TASK-028/029/030/026 属于后续无人看守阶段。派活流程日志请求数与未知值两项复审问题须在成本试用前修正。自动目录定时刷新可后置，首版必须先保证手动刷新、真实 ID 和默认强度正确。

- 可执行：P1 TASK-020/021/022/023 已完成，规划派发生成短执行胶囊，DeepSeek/Kimi 按 job 获得上下文节流规则，负责人接入、切换、选手执行合同与自动故障诊断已明确分层。TASK-015/016 本轮遗留修正已通过，状态 PASSED / P2，尚待安全整合与完整集成验收；TASK-018 复审为 CHANGES_REQUESTED / P1，F-01/F-03/F-04/F-06 已解决，下一轮修复 F-08/F-09，见 `execution/TASK-018/attempt-06.md`。保留已有独立副本，禁止整文件覆盖其他任务的新改动。
- 项目登记链：先打通安全、可测试的后台登记能力；界面和后续管理不能绕过该能力直接操作路径或登记文件。
- 规划驱动链：先统一负责人对任务台账的理解，再实现解析，最后接入工作台界面和派发；Task Spec 的推荐执行者不约束工作台选手。
- 无人看守链：先让每次执行都能有界停止并留下证据，再建自治执行台账和推进器，然后接负责人 AI 诊断/恢复，最后开放细拆、审查、验收和界面；任何阶段都不得无限重试。
- 主人通知链：TASK-010 先产出稳定的 `needs_owner` 原因；TASK-013 再把原因变成不依赖 AI 的持久通知事件并可靠投递；TASK-014 提供安全连接和测试入口。负责人 AI 额度耗尽本身也必须触发通知，不能让通知依赖同一个 AI。
- 成本与评价链：默认单家实现，负责人在正常复审后评分；以能达标为门槛，优先考虑完整任务成本，结合期限，最后检查剩余额度与预算。TASK-017 先提供失败/返工/复审/换人的成本依据，TASK-015 再给派活参考；TASK-018 接入价格、人工经验与额度未知时的本地预算；TASK-016 补齐难度/角色证据与幂等补评。不得为评分重复派题，不把轮换同池模型误当额度分流，也不把主人关于 DS 成本的经验写成固定供应商倍率。
- 群聊能力：主人已按 ADR-002 接受 Cursor 续接轮使用共享锁目录的有限风险；权限已收窄到 macOS Cursor 群聊续接轮并通过复审，真实窗口冒烟仍作为通过注记保留。
- Kimi 额度：TASK-019 已通过并整合；多窗口触顶、失败缓存、金额与统计口径已修正。集成补查修正了缺 Kimi 缓存时误刷新其他厂家停派依据的问题；账户来源未知单独落盘，其他家的有效事实保持不变。最终集成验收见 TASK-014 报告。
- 执行节流链：TASK-020 把精确锚点、可修改文件、修改上限、执行者验证和已知基线从 Task Spec 受限提取为短执行胶囊；TASK-021 按 roster 的 vendor 事实为 DeepSeek/Kimi 附加上下文节流提示；TASK-022 把负责人长期规划提示与选手本轮合同明确解耦。执行者只做定向验证，负责人在整合后做一次全量验收；平台不执行 Task Spec 里的命令。
- 自动领取链：TASK-024 先与 Architect PM Handoff 统一版本化契约并提供只读诊断、dry-run、原子迁移和语义对账；TASK-025 再让派活正文直接读取当前 Execution Capsule，模型适配保持为平台外层；TASK-026 最后增加主人显式授权、有限并发、跨项目的 READY 队列领取，不因打开应用擅自启动 backlog。
- 负责人与并行链：ADR-003 固定 Codex 单负责人。TASK-027 建立报告/证据回交，TASK-028 接入主动中断与重规划，TASK-029 实现单任务串行换人和最终通知，TASK-030 用能力画像选新任务的初始执行者；修订后的 TASK-026 最后开放项目内无写集冲突的多任务并行和跨项目公平领取。
