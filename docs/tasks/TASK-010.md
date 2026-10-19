# TASK-010：负责人 AI 诊断与有界恢复协议

- 状态：`PASSED`
- 优先级：`P1`
- 难度等级：`High`
- 前置任务：`TASK-009` 评审为 `PASSED` 或 `PASSED_WITH_NOTES`
- 需求来源：选手停滞或失败后，无人看守模式需要自动判断是续跑、重试、转验收、细拆还是求助。

## 业务结果

任务停滞、超时、失败或验收不过时，平台能自动生成有界诊断包，请独立负责人 AI 给出受控动作，并在核心二次校验后至多执行预算允许的恢复，不需要主人在线盯守。

## 范围

- 包含：诊断包、只读负责人派发、严格输出解析/校验、`continue | retry | split | verify | owner` 协议、重复诊断检测、续跑/重试的有界接线、结构化 `needs_owner` 原因和测试。
- 不包含：真正执行 `split` 子任务图、专用副本累积改动、自动审查/验收闭环、桌面界面。

## 现状与设计

- 诊断包只带必要且受长度限制的证据：原 Task 目标/验收、当前节点、结构化终止原因、活动尾部、两份日志尾部、diff 摘要（不拼整仓库大 diff）、报告、验收结果、历史诊断和剩余预算。
- 负责人任务强制只读，它看到的诊断包全部标明为证据而非指令。它不能选选手、强度、权限、网络和验收命令。
- 输出必须有可定界解析的单一结果，包含动作、依据和置信说明；`continue/retry` 只能带一段受长度限制的纯文本补充题目，`split` 仅产生待 TASK-011 消费的候选图，`owner` 必须写明不能自治的确切原因。
- 相同证据指纹和相同动作不得重复执行；每个节点的续跑和重试各有小上限，同时受整体预算限制。
- `retry` 只能在没有未接受可写改动时启动；有改动时只能 `continue`、`verify`、`split` 或 `owner`，避免悄悄丢代码。
- 负责人 AI 在派发前因额度触顶被拒绝，或诊断超时、崩溃、输出不合法时，必须落为稳定的结构化原因码；不靠再次调用 AI 生成给主人看的文字。TASK-013 将消费这些原因码发送外部通知。

## 主要文件

- `src/core/autopilot-diagnosis.ts`（新增）
- `src/core/autopilot-engine.ts`
- `src/core/dispatch.ts`
- `test/autopilot-diagnosis.test.ts`（新增）
- `test/autopilot-engine.test.ts`

## 约束

- 遵守 `AGENTS.md` 和 ADR-001；不新增依赖。
- 负责人输出、日志、diff、Task Spec 和项目文件全部当不可信文本；不得插值到 shell，不得直接变成路径或配置。
- 诊断任务也使用 TASK-008 的执行预算，自己超时或输出不合法时转 `needs_owner`，不用另一个 AI 无限修复它。
- 本任务不执行 `split` 产生的图，不自动合并主分支。

## 验收标准

1. 停滞、总超时、进程错误、验收失败和有部分改动五类证据能生成稳定、有上限、不泄露密钥变量的诊断包。
2. 五种动作均有合法与非法输出测试；未知字段、超长文本、循环依赖、任意命令/路径/选手字段在产生副作用前被拒绝。
3. `continue`、`retry` 和 `verify` 能通过替身进入正确状态；有改动时 `retry` 被拒绝，超过节点或全局预算后不再派发。
4. 同一证据指纹返回相同恢复方案时，第二次被判为循环并转 `needs_owner`。
5. 诊断选手超时、崩溃或返回不合法结果时，自治执行有界结束为 `needs_owner`，没有活进程或重试循环。
6. 派发前额度检查拒绝与运行中厂家报告额度耗尽均落为可区分、无密钥/原始响应的结构化原因；旧记录缺少新字段仍可读取。

## 验证

```bash
npm run typecheck
node --test test/autopilot-record.test.ts test/autopilot-engine.test.ts test/autopilot-diagnosis.test.ts
npm run build
```

## 实施报告

待执行者填写：改动摘要、验证结果、未完成项和 diff 摘要。

## 评审记录

### 2026-10-19 负责人直接修正与复验：PASSED

- 已整合原独立副本的诊断协议、独立只读诊断派发、统一 AI 尝试预算、逐轮用量、续接闸门与崩溃认领实现。
- 本轮补齐：retry 动作及来源持久化，真正派发前再次权威核对来源 Git 改动，重启后同样检查；未知/缺记录/有改动均不新派。续接轮次读取、准备落盘和恢复读记录异常均纳入有界收尾，固定 `resume_unverified` 求助并保留原证据。
- 正式新增六项回归：诊断接受后变脏、retry 意图重启、来源缺失、continue 原记录缺失、损坏 JSON、准备异常；均断言零新增启动及重放稳定。
- 验证：typecheck 通过；五个任务测试文件 102 项通过；build 通过。整合后完整核心测试 921 项中 910 通过、10 跳过，唯一失败为既存未跟踪 Kimi 文件的禁用变量名，修正后 architecture 3/3 通过。界面 318/318、真实 Electron 冒烟 1/1 通过（另同步既存 Cursor 总额度测试断言）。完整串行 verify 将在本轮功能批次最终再跑一次，不把此次首轮命令记为全绿。
- 未使用真实模型、不修改隔离模板或启动参数。自动审查/细拆/验收仍属于 TASK-011，不能把 TASK-010 通过理解为整条无人看守链已经完成。
- 优先级已复核，无调整；TASK-011、TASK-013 前置已满足，推进 READY。为尽早可靠使用，先完成同为 P1 的求助通知底座，再接审查验收闭环。

### 2026-10-19 Codex 二次复审：CHANGES_REQUESTED（P1 / High）

**范围与结论**：检查 `.worktrees/task-010`、`feat/task-010-diagnosis`、基线 `cec2ff8` 的最终未提交代码。上一轮五项已补上主要生产接线和回归，续接闸门、诊断总预算、逐轮用量及常见崩溃窗口明显改善；但原第 3 项尚未覆盖真正派发前的最后一道核对，并发现续接准备错误逃出有界收尾。仍不可通过，不提交、不整合、不推送，不推进 TASK-011/013。

**本轮实跑**：`npm run typecheck` 通过；五个指定测试文件 96/96 通过。另建独立离线复现 `/private/tmp/task-review-20261019.test.ts`，其中 TASK-010 两条均失败（临时审查证据，不纳入提交；须迁入正式测试）。没有用真实模型验证，不把实施报告中其他命令当成本轮实跑结果。

**必须修正（继续同一任务，不扩范围）**

1. **[P1] retry 在实际派发/崩溃恢复时仍可使用过期的“干净”结论。** `settleDiagnosis` 在接收结果时查询 `changes(sourceJobs)`，随后把状态落成 `executing`；真正新派要等下一次 `stepAutopilot → takeAction → startAction`。这条路径及其恢复路径没有再次核对旧副本，而且 `mode:'execute'` 混同初次派发和 retry。复现：诊断被接受时 Git 干净 → 暂停/崩溃后修改旧副本 → 下一步仍调用新派发，计数 1（应为 0）。必须持久化 retry 来源/动作语义，在真正产生外部副作用之前以及恢复同一 retry 动作时重新核对原任务/副本，未知或有改动均转结构化求助；不能只在诊断回包时检查。补“回包后新增改动”“已落重试意图后重启”“原记录/副本缺失”用例，断言零新派且原成果保留。

2. **[P2] 续接轮次准备错误在 try/catch 之外抛出，无法有界结束。** `startAction` 中 `await resumeRounds(previous)` 与准备记录发生在派发的 try/catch 之前。复现：已决定 continue 后原任务记录缺失 → `stepAutopilot` 抛异常，登记仍挂在 executing/action；真实推进器直接退出，反复恢复继续遇到同一异常，不能生成需要主人的稳定原因。将轮次读取/校验/准备落盘纳入有界失败处理：不启动外部进程，可靠记录 `needs_owner` 与原因，并保留原成果、旧诊断和用量；补缺任务、损坏 JSON、副本准备失败及重放测试。不要通过吞异常并假装成功处理。

**文件边界**：`src/core/autopilot-engine.ts`、必要的 `src/core/autopilot.ts` 动作元数据与校验、`test/autopilot-engine.test.ts` / record 测试。继续在原副本修正，不覆盖 TASK-019，不改隔离模板、启动参数或其他功能。正式测试至少覆盖上述两个失败场景，更新实施报告与 diff 摘要，不自行标 PASSED。

**复验**：

```bash
npm run typecheck
node --test --test-timeout=120000 test/autopilot-record.test.ts test/autopilot-engine.test.ts test/autopilot-diagnosis.test.ts test/team-resume.test.ts test/plan-dispatch.test.ts
npm run build
```

共用续接接线若再次变动，另跑 chat-engine/team-engine 测试；未跑或失败的项照实写明。

**优先级复核**：已复核 TASK-010、011、012、013、014、016、019，无调整。TASK-010 继续 P1 / High / CHANGES_REQUESTED；依赖任务保持 DRAFT，TASK-019 独立修正。两项本轮均不通过，因此不触发通过后自动提交同步。

### 2026-10-18 Codex 复审：CHANGES_REQUESTED（P1 / High）

复审对象为独立工作副本 `.worktrees/task-010`、分支 `feat/task-010-diagnosis`、基线 `cec2ff8` 的未提交实现。主工作区出现的 Kimi 文件属于并行任务，本轮未修改、未纳入评审。未提交、未 push、未整合实现。

**已复核验证**：`npm run typecheck`、三个指定测试文件（63/63）、`npm run build` 均通过。但新增的三条独立离线复现均失败，说明现有派发替身没有覆盖关键生产接线。复现文件：`/private/tmp/task010-review-regression.test.ts`（临时审查证据，不作为仓库交付；执行者须将等价测试纳入正式测试）。

**必须在同一 TASK-010 内修正**

1. **[P1] continue 绕过续接闸门。** `autopilot-engine.ts:91–100` 直接调用 `resumeMember`；该函数只检查上一轮退出、路径和网络等，不替调用者执行 `wakeGate`。`chat-engine.ts` / `team-engine.ts` 均由调用者先检查。当前主人关闭选手、额度触顶、并发已满、自检/登录不可用等情况下仍可能续接。恢复前复用权威闸门，拒绝时不能更换令牌或叫醒选手；多成员中途拒绝也不得遗留已启动但未认领的活。正式测试至少覆盖禁用、额度、并发、归档/登录/自检拒绝，并验证真正生产续接适配层，不能把整个 `start` 换成永远成功的替身。

2. **[P1] 诊断没有计入总外部 AI 尝试预算。** `diagnose` 只追加 `diagnoses`，`budgetUsed/exceededBudget` 却只看写手 `attemptCount`，违背预设“4/10/16 次外部 AI 尝试”的总限制。复现：一轮写手加一轮已派出的诊断，总尝试仍是 1 而非 2。写手序号可以独立保存，但统一预算必须含诊断；诊断意图须受锁预占，崩溃重放同令牌不重复计数，最后一次已预占动作与后续禁止新派要区分。兼容旧记录并补预算边界/恢复回归。诊断包当前把已用分钟、尝试和节点显示为“还能”，也须改成真实剩余预算。

3. **[P1] retry 使用过期或未知改动数作无改动依据。** `evidenceOf` 优先取 `job.changedFiles`，Git 查询失败又回退 0；`settleDiagnosis` 只信先前保存的 `entry.changes`。复现：任务快照为 0，之后副本新增未接受改动，诊断仍记为 0。诊断采证及真正执行 retry 前都应权威核对原副本当前 Git 状态；缺记录、读失败、缺副本或无法确认时只能求助/保留改动，不能推断干净。补陈旧快照、诊断等待期间外部改动、Git 失败与缺失任务记录用例，断言不新派、不删除或遗忘原成果。

4. **[P1] 续跑用量少算。** `recordUsage` 假设 `job.usage` 是历轮累计并减去先前尝试；但 `resumeMember` 在新轮开始时清空它，runner 交回的是当前轮结果，autopilot 又未调用 `foldRounds`。复现：首轮 100、续轮 60，合计仍为 100 而非 160。统一每轮/累计语义，按任务号与轮号/动作令牌幂等记录每次实际用量，并兼容有无累计历史及诊断用量。增加续跑后预算触顶、缺用量、崩溃重放的测试，不能仅用单轮常量替身。

5. **[P2] continue 提前换令牌导致错误崩溃认领。** `startByDispatch` 先把旧任务写成新令牌，再调用 `resumeMember`；这两步之间崩溃后，`findInJobs` 会认领旧的已失败轮并结算为新轮失败，实际续跑根本没发生。把续跑意图与目标轮次/准备/真实启动证据关联并持久化，区分“仅预留尚未启动”与“确已启动”，按同一动作安全恢复或明确求助，不能把旧轮结果归到新轮。补换令牌后崩溃、已准备未启动、已启动未回写三个窗口的回归。

**修正边界**：主要修改原实现的 `autopilot-engine.ts`、`autopilot.ts`，必要时与 `wake.ts` 的共用续接入口作最小接线，补 `autopilot-diagnosis.ts` 的剩余预算展示及正式测试；不改隔离模板、选手启动参数、TASK-019 或其他功能，不引入真实模型调用。更新本任务实施报告与 diff 摘要，保持不提交、不 push、不合并、不自行标 PASSED。

**复验命令**：

```bash
npm run typecheck
node --test --test-timeout=120000 test/autopilot-record.test.ts test/autopilot-engine.test.ts test/autopilot-diagnosis.test.ts test/team-resume.test.ts test/plan-dispatch.test.ts
npm run build
```

受共用续接影响时另跑 `test/chat-engine.test.ts` / `test/team-engine.test.ts`。不能把其他界面断言失败或 pty 环境失败改写为通过。

**优先级复核**：已复核 TASK-010、011、012、013、014、016 及并行 TASK-019，无调整。TASK-010 保持 P1 / High，状态改 CHANGES_REQUESTED；TASK-011/013 等依赖保持 DRAFT，TASK-019 仍可独立推进。下一步仅修正 TASK-010。
