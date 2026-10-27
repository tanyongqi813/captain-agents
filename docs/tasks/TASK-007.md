# TASK-007 — 项目群聊支持 Cursor 成员

- handoff_contract: `1`
- status: `PASSED_WITH_NOTES`
- priority: `P1`
- difficulty: `High`
- dependencies: `none`
- current_attempt: `none`

## 业务结果

本机 Cursor 通道可用且主人已启用相应选手时，新建群聊会列出 Cursor 模型；主人可以选择强度、快速版能力允许时使用快速版、设置只读，并在群内通过 `@` 正常派活和续接。Cursor 不可用、被关闭或当前平台不支持时，仍不能被绕过加入群聊。

## 范围

- 包含：Cursor 群成员的核心准入、桌面候选列表、首轮执行、同一群聊续接、成员交接、只读模式、停止与重新派活、错误提示及自动化测试。
- 包含：在真实本机 `cursor-agent` 上完成最小续接探针，记录命令、版本、观察结果和残留清理；据此确认现有 Cursor 状态目录与会话恢复方式足以支持群聊。
- 不包含：改变 Cursor 模型发现规则、修改额度算法、增加新的 Cursor 模型、绕过主人设置/登录/额度/平台限制、自动创建群聊。

## 现状与设计

- `app/renderer/components/Chat.tsx` 的新建群聊候选列表显式过滤所有 `who` 以 `cursor` 开头的选手。
- `src/core/chat.ts#chatMember` 即使收到 CLI 或 IPC 参数也会拒绝 `vendorOf(who) === 'cursor'`，现有提示为“Cursor 还没有实测续接”。因此只改界面无效，也不安全。
- 先使用仓库既有探针方式验证：Cursor 成员完成首轮后，同一群聊再次 `@` 能延续必要上下文并使用同一群聊工作副本；验证普通成员与只读成员，且登录凭据、全局配置和群外路径权限不因续接放宽。探针记录放入 `docs/research/`，不得记录令牌、提示词中的秘密或用户私人内容。
- 探针通过后，删除核心的供应商特判和界面的前缀过滤；候选列表继续只来源于 `view.roster`、主人启用设置及现有平台可用性，不能另建一份 Cursor 名单。
- 群聊仍通过 `chatMember`、`checkChoice` 和现有派活生命周期统一校验强度、快速版、只读、登录、额度、隔离与平台支持；不得为 Cursor 增加绕过分支。
- 主人已接受 `docs/decisions/ADR-002-cursor-shared-resume-lock.md`：只允许 macOS Cursor 群聊续接轮写固定的共享持久锁目录。普通派活、非群聊、首轮、Windows 与其他选手不得获得该例外。
- 若探针证明现有续接机制无法安全复用 Cursor 会话，本任务应停止并回报 `[BLOCKED]`，记录事实和所需架构决定，不得用无上下文的新进程伪装成续接。

## 主要文件

- `src/core/chat.ts`
- `app/renderer/components/Chat.tsx`
- `docs/ui-spec.md`

附加验证文件包括对应的 `test/chat*.test.ts`、`test/ui/chat.test.tsx`、生命周期测试和一份 `docs/research/` 探针记录。

## 约束

- 遵守 `AGENTS.md`；不新增依赖，不做无关重构。
- 选手名单和模型只从 `src/core/roster.ts` 及 View 派生，不按字符串前缀另造名单。
- Windows 仍遵守当前只开放 Codex 隔离的底线；不得因群聊支持 Cursor 而在 Windows 放开 Cursor。
- 不降低 Cursor 现有隔离、登录、额度、设置开关或状态目录安全要求。
- UI 改动先更新 `docs/ui-spec.md`，并覆盖浅色、深色、窄窗口和新建群聊弹窗检查。

## 验收标准

1. 支持 Cursor 的平台上，本机通道可用、选手启用时，新建群聊候选列表展示所有符合现有 roster/policy 的 Cursor 选手；关闭或不可用的选手不展示。
2. 桌面与 CLI 都能创建包含 Cursor 的群聊，不能通过 IPC/CLI 绕过主人设置、模型能力、登录、额度或平台限制。
3. Cursor 可完成群聊首轮和至少一次同成员续接；上下文、同一工作副本和成员身份保持正确，并有真实探针记录支持。
4. Cursor 普通成员可以修改群聊副本；只读成员不能修改文件。两种模式都不能写群外或全局配置。
5. Cursor 与其他成员互相 `@` 交接、排队、停止后重新派活的状态与既有成员一致，不产生重复并发或丢失消息。
6. 原有 Codex、Kimi、Grok、DeepSeek 群聊行为和旧群聊读取保持兼容；Windows 不出现 Cursor 候选项。
7. 界面说明不再声称 Cursor 暂不支持，错误信息使用实际失败原因。

## 验证

```bash
npm run typecheck
node --test test/chat.test.ts test/chat-engine.test.ts test/models-discovery.test.ts
npm run test:ui -- test/ui/chat.test.tsx
npm run build
```

负责人最终运行 `npm run verify`，并检查浅色、深色、窄窗口及新建群聊弹窗。真实 Cursor 续接探针必须单独记录版本、步骤、结果与清理情况；自动化测试继续使用替身，不依赖联网或真实登录。

## 实施报告

2026-10-18 更新。真实探针见 `docs/research/cursor-chat-resume-2026-10-18.md`（前一次失败见 `docs/research/cursor-chat-resume-2026-10-17.md`）。安全例外见 `docs/decisions/ADR-002-cursor-shared-resume-lock.md`。

`cursor-agent` 2026.10.14-0f9edde。可写续接退出码 0，同一会话，删掉第一轮文件后仍写出「暮潮拾贝」（26 秒、40 秒）。只读续接 `--mode ask`，工作区不可写，同一会话回忆「霜桥夜读」，`keep.txt` 未改（19 秒、25 秒）。`~/.cursor` 核对过的文件没变，`/tmp`、家目录和 `~/.cursor` 里的越界探针文件都没有出现。网络仍只放行 Cursor 自家域名。只读第一轮曾有一次加密连接中断，重跑后通过。没有记下令牌。

实现：群聊核心和新建群聊不再按 Cursor 名字拒绝。候选仍来自当前名单和主人设置；Windows 不派 Cursor，由平台准入保证，不靠群聊特判。续接在新提示词前加 `--resume` 和 `session_id`。共享锁目录不在 `sandbox/cursor.json` 里。只有 macOS、带群标记的 Cursor 续接轮，由 `prepareRun` 在通用沙箱之外加上 `/tmp/cursor-agent-persist-<uid>` 及其真实路径。目录必须是本人的、`0700`、非符号链接；真实路径不对就拒绝。`/tmp` 本身不放开。`noWeaker` 只容许这一组已经校验过的路径比上一轮多，其他新增可写位置仍然拒绝。首轮、普通派活和非群聊任务拿不到这个目录。不删除共享根目录。小队搭档仍拒绝 Cursor。设置、登录、额度、隔离和平台检查仍走原路径。

桌面桥：`cursor-grok:high:fast` 与 `cursor-opus:high:ro` 能通过参数检查并交给核心。空成员、错误字段、过高强度、没有快速版的写法、重复成员仍然拒绝。

验证（2026-10-18，本机已跑完）：

- `npm run typecheck`：通过。
- `node --test --test-timeout=120000 test/chat.test.ts test/chat-engine.test.ts test/models-discovery.test.ts test/workers.test.ts test/network-wire.test.ts test/team-resume.test.ts test/desktop.test.ts`：通过。另加跑了 `test/run-package.test.ts`，合计 134 项通过、0 失败。
- `npm run test:ui`：34 个文件、312 项通过。
- `npm run build`：通过。

没有跑真实窗口冒烟测试，没有提交。

残留风险：续接轮仍可能改同一用户其他 Cursor 会话的锁。这是 ADR-002 里主人接受的范围。Cursor 版本或目录结构变化时要停掉续接并重新探针，不能自动加路径。

## 评审记录

### 2026-10-18 Codex 二轮复审：`PASSED_WITH_NOTES`

- 已确认权限例外已从 `sandbox/cursor.json` 的通用模板移出，只在 macOS、Cursor、项目群聊、且存在续接会话号的轮次动态加入；首轮、普通派活、非群聊、Windows 与其他选手均拿不到该目录。`noWeaker` 只允许这组经所有者、权限、非链接和真实路径校验的固定目录成为新增可写项。
- 桌面桥契约已同步为允许合法 Cursor 成员，仍覆盖非法字段、强度、快速版与重复成员。真实探针、ADR 和实施报告齐全；主人已接受同一用户 Cursor 会话可能互相干扰的残余风险。
- 本轮复跑：类型检查通过；相关核心测试 **134/134 通过**；全量 UI 首跑为 **311/312**，唯一失败是与本任务无关的更新提示异步用例，单独复跑 **6/6 通过**；构建通过。因此记为带注通过，注记仅是尚未执行真实窗口的浅色、深色、窄窗口冒烟，以及 ADR-002 已接受的共享锁风险。
- 合并说明：当前成果仍是主工作区未提交改动，并非可供 `git merge` 的分支提交；不得用另一个 worktree 的整文件覆盖本实现。
- 优先级复核：功能与安全修正均已完成，状态改为 `PASSED_WITH_NOTES`；其他任务优先级不变。已复核，无调整。

### 2026-10-18 主人确认安全例外

- 主人明确接受：macOS Cursor 群聊续接轮可写当前用户共享的持久锁目录，并知悉同一用户其他 Cursor 会话可能被干扰或拒绝服务。
- 决定已记录在 `docs/decisions/ADR-002-cursor-shared-resume-lock.md`。原先的架构阻塞解除；实现仍须完成本次复审要求：把权限从所有 Cursor 任务收窄到群聊续接轮、同步桌面桥契约测试、更新实施报告并跑完整指定验证。
- 回退条件：Cursor 版本或目录结构变化、目录校验异常、真实出现跨会话干扰且不可接受时，撤销例外并恢复 Cursor 群聊禁用，不自动扩大路径。
- 优先级复核：`TASK-007` 保持 `P1 High CHANGES_REQUESTED`；其他任务优先级不变。已复核，无调整。

### 2026-10-18 Codex 实现复审

- 结论：`CHANGES_REQUESTED`。
- 已确认：2026-10-18 真实探针完整记录了 Cursor 版本、可写/只读首轮与续接、同一会话号、越界写、网络边界和清理；自动化群聊测试覆盖首轮、同成员续接、只读交接、FIFO、停止后再派。本机复跑 TASK-007 相关核心测试 **85/85 通过**，UI **34 个文件、312 项通过**，类型检查和构建通过。Windows 仍由平台隔离名单排除 Cursor，小队搭档仍未开放。
- 阻断问题 1（权限例外范围过宽）：`sandbox/cursor.json` 静态加入 `__CURSOR_PERSIST__`，导致所有 macOS Cursor 任务——包括普通派活、非群聊任务和不需要续接的首轮——都能写本用户所有 Cursor 会话共用的持久锁根目录。TASK-007 只批准群聊续接，且原架构底线只允许每件活自己的状态/临时目录；应把例外从通用模板移出，至少只在 Cursor 群聊成员需要续接的运行包中加入。若生成新一轮策略需要相对首轮增加这一个路径，应在 `run-package.ts` 对这个经过严格解析的单一例外做专门验证，不能放宽通用 `noWeaker`。
- 阻断问题 2（安全决定尚未落档）：即使收窄到续接轮，选手仍可改同一用户其他 Cursor 会话的锁，存在跨会话干扰/拒绝服务风险。这正是上轮 `BLOCKED` 要求主人决定的事项。通过前需主人明确接受该残余风险，并新增或更新 ADR，写清只限 macOS Cursor 群聊续接、目录所有者/0700/非链接校验、不会删除共享根目录、无法阻止同用户会话锁互相修改、关闭功能的回退方式；若主人不接受，应恢复核心/UI 禁用并继续 `BLOCKED`。
- 阻断问题 3（已知回归未同步）：`test/desktop.test.ts` 的群聊桥契约仍把 `cursor-grok:high` 放在非法参数列表，联合验收因此 **84 项中 83 通过、1 失败**。这条失败由 TASK-007 改变 Cursor 核心准入直接造成，不属于 TASK-008。应改为验证 Cursor 参数能通过桥并交给核心，同时保留非法供应商/强度/字段的拒绝覆盖；Windows 禁用应在平台准入层测试，不再靠 `chatMember` 的旧供应商特判。
- 文档要求：当前 Task Spec 的“实施报告”仍是 10 月 17 日未开放的旧结论。应以用户本轮报告和 `cursor-chat-resume-2026-10-18.md` 为依据补全真实改动、验证、未完成风险和 diff 摘要，并让 `docs/ui-spec.md` 只包含 TASK-007 相关变更，不把其他任务的规范改动归入本任务说明。
- 修正后验证：`npm run typecheck`；`node --test --test-timeout=120000 test/chat.test.ts test/chat-engine.test.ts test/models-discovery.test.ts test/workers.test.ts test/network-wire.test.ts test/team-resume.test.ts test/desktop.test.ts`；`npm run test:ui`；`npm run build`。完成后再次等待复审。
- 优先级复核：`TASK-007` 保持 `P1 High`，因为这是安全边界变更且仍有已知回归；其他未通过任务优先级不变。已复核，无调整。

### 2026-10-17：[BLOCKED]

- 探针记录包含版本、命令形状、可写/只读首轮与续接结果、隔离观察和清理情况，结论可信。
- 当前 `cursor-agent` 2026.10.14 的持久会话锁目录写死在所有 Cursor 会话共享的 `/tmp/cursor-agent-persist-<uid>`，不服从 `TMPDIR`、`CURSOR_CONFIG_DIR` 或 `CURSOR_DATA_DIR`。放开该目录会突破“每件活只写自己的临时目录”的安全底线。
- 因续接未成功，不能满足首轮加至少一次续接、续接后隔离、只读续接和交接验收标准；保持核心拒绝和界面过滤是正确行为。
- 需要主人/架构决定：接受对共享持久目录做经过新探针验证的最小授权，或等待 Cursor 提供可迁移持久目录。作出决定前实现代理应停止。
- 优先级复核：`P1` 保持不变，因为功能仍是已接受需求；阻塞原因是外部工具与安全边界冲突，不应降级。难度 `High` 保持不变。

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
