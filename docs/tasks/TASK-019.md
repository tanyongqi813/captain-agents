# TASK-019 — Kimi 套餐查询与多窗口派发检查

- handoff_contract: `1`
- status: `PASSED`
- priority: `P2`
- difficulty: `High`
- dependencies: `none`
- current_attempt: `none`

## 业务结果

负责人能获取 Kimi 官方套餐的实际窗口、用量和重置信息，并在派发前识别额度不足；会话 token、上下文占用和加油包余额不混成套餐百分比，也不会因为检测到付费余额而自动放行额外消费。

## 范围

- 包含：受控只读探针、Kimi 查询与解析、失败保留缓存、多窗口检查、脱敏 Extra Usage 数据、现有额度展示兼容及离线替身测试。
- 不包含：购买/开启加油包、修改账号配置、读取密钥、伪造余额接口、查询中转站余额、改选手启动或隔离模板、自动付费兜底。

## 现状与设计

- 历史调研见 `docs/research/kimi-usage-2026-10-18.md`（原调研为 2.1.1）；本任务执行者的后续真实探针为 2.2.0，证据和版本差异见下面实施报告。本次负责人仅重做离线回归，未重新查询真实账号。原实现排除 Kimi，不得简单删除过滤后落入 Cursor 分支。
- 第一实施步验证不会发起模型推理的查询路径：优先已证实且受支持的结构化入口；否则复用现有有界终端执行器发送交互 `/usage`。不能假定 `-p /usage` 等价，不把未知斜杠命令送成模型提示。
- 探针使用专用临时工作目录，禁用或隔离会自动执行的项目/用户扩展。登录只由 CLI 自行使用，平台不读其凭据；不得改主人原配置或复用活跃会话，不开 Web/本机服务。记录 CLI 版本、去敏输出、实际副作用与收尾证据。无法满足条件时保留未知并报告限制，不悄悄换不受控方式。
- 查询沿用既有缓存有效期和执行器时长/输出上限，完整结果后可靠收尾；失败保留上次成功数据及其原时间，显示本次失败，不以新查询时间冒充新数据。
- 解析区分：会话 token 与上下文属于会话资源；Plan usage 才是账户窗口；Extra Usage 的消耗、月上限、余额、启用状态为独立付费元数据。所有缺失/未启用/无限/零值都有不同语义，不能混成 0%。
- 五小时、周或其他服务端窗口按实际返回保留，不能假定必有周额度。倒计时以固定采集时间转为绝对重置时间；日期/时区/单位无法确认则保持未知。页面提及但输出未返回的月度总量不补造为无限。
- 自定义接口和中转站按实际付款来源处理，不能因为模型名为 Kimi 就查询或展示官方套餐；版本不支持、未登录及未知输出均回退为未知，不消耗 AI 生成猜测。
- 派发检查覆盖全部已知约束窗口，不只看单一 `quotaBar`；既有百分比停派和显式 `--force` 语义保持原样，不能擅自新增无条件绕过。Extra Usage 不并入“可用订阅额度”，不因存在余额、上限或服务端已启用就推断主人授权工作台使用它；未有工作台明确授权时套餐触顶仍按既有检查拒绝。
- 服务端可能在执行期间切到加油包，工作台无法凭启动快照保证零付费；若服务端已启用，则提示这一事实，不擅自改开关或声称本地预算是账单硬上限。
- 复用现有 bars 展示窗口，额外付费元数据在共享 View 中显式区分，改 UI 前先更新规范；不把货币余额画成额度百分比。不使用套餐快照差值伪造单任务费用；TASK-017 可消费有来源时间的事实。

## 主要文件

- `src/core/kimi-quota.ts`（新增；探针确认的查询和解析）
- `src/core/quota.ts`（接入、缓存和多窗口检查）
- `app/renderer/components/Pages.tsx`（付费元数据展示，按需）
- 必要共享类型/规范：`src/core/view-types.ts`、`docs/ui-spec.md`；测试：`test/kimi-quota.test.ts`、`test/quota.test.ts` 和现有额度 UI 测试；脱敏夹具放 `test/fixtures/quota/`

## 约束

- 遵守 `AGENTS.md`，不新增依赖；不改变选手隔离、启动参数和 Windows 开放范围。
- 自动测试完全离线，用临时 `XAGENTS_HOME`、替身 CLI/执行器和固定时钟；真实查询探针与替身测试结论分开记录。
- 原始输出可能含身份或付款信息，只持久化白名单字段，错误与夹具必须脱敏。

## 验收标准

1. 新旧窗口组合、仅五小时窗口、周窗口缺失、未知月总量、倒计时重置均可解析且不捏造额度；会话上下文不影响账户停派判断。
2. 有效查询只走控制命令，不启动 AI 推理、不改主人配置；成功、超时、异常退出和输出超限都不残留查询进程。真实探针记录版本与副作用证据。
3. 套餐零剩余、百分比阈值、重置、服务端触顶、付费余额存在及自定义接口各有用例；不能因周额度宽裕忽略五小时窗口触顶，不能以加油包余额自动放行。
4. Extra Usage 的零余额、未启用、未知上限与不同币种不混淆；旧缓存缺新字段不崩溃，失败不覆盖成功数据时间或泄露凭据。
5. CLI/手册与桌面额度显示同一事实，所有新鲜度和未知提示一致；套餐窗口成功接入后不再把 Kimi 一概标成“无法查询”。

## 验证

```bash
npm run typecheck
node --test --test-timeout=120000 test/kimi-quota.test.ts test/quota.test.ts test/guide.test.ts test/stats.test.ts
npm run test:ui
npm run build
```

负责人最终运行 `npm run verify`；涉及 UI 时检查浅色、深色和窄窗口截图。真实 `/usage` 探针须单独列出，不得将公开文档核实称为已实测余额查询。

## 实施报告

2026-10-18 由实现 AI 填写，未自标 PASSED，等 Codex 复审。

### 工作副本与基线

- 工作副本：`.worktrees/task-019`（主工作区未动；`src/core/kimi-quota.ts` 起草稿从主工作区复制进副本后修订，主工作区原文件未改）。
- 分支：`feat/task-019-kimi-quota`；基线提交：`cec2ff8`（codex/custom-requirements 最新提交）。
- 副本内 `node_modules` 是指向主工作区依赖的符号链接（仅为跑测试，不提交）。

### CLI 版本、实际查询方式与副作用检查（真实查询，与文档核实、替身测试分开）

- **官方文档核实**：本机 CLI 实测版本 **2.2.0**（旧调研文档写的 2.1.1 已过时）。`kimi --help` 为新版（`-p/--prompt`、`provider`、`session`、`web` 子命令）。受支持的非交互入口 `kimi provider list --json` 存在，帮助原文 “--json  Emit the raw providers/models config as JSON”。`kimi -p /usage` **未被文档保证是控制命令**（文档只保证 prompt 模式处理 `/goal`），禁用；查询走交互 TUI 的 `/usage`（pty 桥有界终端查询），不会变成模型推理请求。
- **真实查询探针**（专用临时目录 `mktemp -d`，独立 `KIMI_CODE_HOME`，不复用已有会话；证据留存 `/tmp/kimi-usage-probe-evidence.txt`）：
  - `provider list --json` 真实输出结构：`providers`（含 `kimi-code` 与 `managed:kimi-code`）+ `models`（含 `kimi-code/kimi-for-coding`，与 roster 一致）；只打印结构键与脱敏值，未打印任何 key。
  - `/usage` 面板（脱敏白名单字段）：分节 Session usage（“No token usage recorded yet.”）/ Context window（`0% (0/1M)`）/ Plan usage（本账号实测 `5h limit 100% used resets in 4h 12m` + `Monthly limit 5% used resets in 30d 23h 12m`，倒计时支持 Nd Nh Nm 混合；分类小字 `kimi 1% · code 4%` 不是窗口行；无周窗口；无 Extra Usage 段落）。
  - 新发现（已处理）：全新临时状态目录首启会依次弹“信任目录”和“kimi-cli 迁移向导”两个交互对话框，盲发 `/usage` 会被挡死；writes 序列先盲答这两组对话框（无对话框时空提交无害）再发 `/usage`。
  - **副作用检查**：探针前后 `~/.kimi-code` 全部关键文件 mtime 不变（config.toml、credentials、sessions、session_index.jsonl、workspaces.json 逐一比对）；探针后无残留 `kimi` 进程（`pgrep` 为空）；临时状态目录自包含、用完已删。
- **替身测试**：全部离线，见 `test/kimi-quota.test.ts` 与更新后的 `test/quota.test.ts`，夹具 `kimi-usage.txt`/`kimi-providers.json` 均脱敏（假 key 标注 fixture）。

### 改动摘要

- 新增 `src/core/kimi-quota.ts`：官方/自定义分辨（`classifyKimiProvider`，managed:/oauth + 官方主机且不带 apiKey 才算官方，否则抛 `KimiCustomProvider`）；`/usage` 面板解析（只把 Plan usage 行算作账户窗口；5h/周/月度/未知窗口按实际返回保留，缺哪种都不补造；倒计时换算绝对重置；半屏/变版拒绝）；Extra Usage 容错解析（enabled/spent/monthlyLimit/balance/currency，null=未知，0=零）；`queryKimiQuota` 两步查询（先 `provider list --json` 内存解析不落盘，再临时 state+work 目录走 pty 桥发交互 `/usage`，有界收尾、用完即删；替身测试不复制真实登录文件）。
- `src/core/quota.ts`：Kimi 接入 `queryQuota`/`ensureQuota`（去掉两处 kimi 排除）；失败保留上次成功数据及原时间（通用 keepPrevious）；`checkQuota` 对 Kimi 按账户窗口**逐个**检查（5 小时/月度任一到线即拒，错误文案带窗口名；force 语义不变；其他家口径不变）；`quotaBar` 支持 Kimi（消耗统计取 5 小时窗口，缺失退回第一个有数据窗口）；`boardQuota` 兜底四家并透出 `extraUsage`；缓存校验容忍旧数据缺新字段、拒绝畸形 extraUsage。
- `src/core/stats.ts`：`quotaUsed` 支持 Kimi（与 quotaBar 同口径），此前恒返回 null 的注释移除。
- UI（先改 `docs/ui-spec.md`）：额度卡与悬停提示显式区分加油包——只作文字行，不画百分比、不进额度环、不影响派发；顶栏 Kimi 有套餐数据时画环、查不到时仍只画“已接入”图标；设置组头“月度额度 → 本月”。Cursor 顶栏“总额度”修正未动。
- 测试：新增 `test/kimi-quota.test.ts`（9 个用例：解析/窗口组合/半屏拒绝/Extra Usage 零余额 vs 未启用 vs 未知/官方与自定义分辨/命令形状与临时目录清理/stateSource 复制/多窗口派发检查含加油包不放行/失败保留旧数据）；`test/quota.test.ts`、`test/listed.test.ts`、`test/limits.test.ts`、`test/lifecycle.test.ts`、`test/stats.test.ts` 按“第四家接入”更新；CLI 替身 `test/fixtures/quota/query.ts` 服务 Kimi 两段查询。

### 验证结果（2026-10-18，本机）

- `npm run typecheck`：通过。
- `node --test --test-timeout=120000 test/kimi-quota.test.ts test/quota.test.ts test/guide.test.ts test/stats.test.ts`：42 个测试，37 过；4 个失败均为**基线已存在**的本机环境问题（`process.execPath` 不是真 Node，pty 桥/执行器用例必然失败，已在干净基线 `cec2ff8` 副本上复现同一批失败），与本次无关；另 1 个初发失败（`mkdir state/skills` 少 recursive、classify 测试期望写错、变量名 `any` 撞架构检查、limits 夹具缺 Kimi 条目）已修。
- `node --test --test-timeout=120000 test/listed.test.ts test/lifecycle.test.ts test/desktop.test.ts test/limits.test.ts test/architecture.test.ts`：通过（lifecycle 有 1 个失败同基线复现，既有环境问题）。
- `npm run test:ui`：318 个测试，316 过；2 个失败（board/data-truth 的 Cursor 环口径）在干净基线上同样失败，既有问题，与本次无关。
- `npm run build`：通过。
- 全量 `npm test` 与基线逐条对比：失败集合一致（同名同因），无本次新增失败。
- 未执行：`npm run test:e2e`（真实窗口冒烟需在隔离外由负责人验收）与浅色/深色/窄窗口截图检查，交负责人。

### 边界与未完成项

- 未新增依赖；未提交、未 push、未合并；未自行标记 PASSED。
- 自定义接口（中转/自带 key）不查官方套餐，写明原因，失败时保留上次数据；Extra Usage 余额不参与任何放行判断。
- Extra Usage 段落本账号真实面板未出现，其解析按主人描述容错实现、未经真实输出验证（代码与报告均已注明）。
- 盲按键应答迁移向导依赖 CLI 2.2.0 实测对话框顺序；未来 CLI 改版若 `/usage` 面板结构变化，解析会拒绝（“界面可能改了”）并保留上次数据。
- `node_modules` 符号链接为测试便利，提交前由负责人决定是否需要真正的 install。

### diff 摘要

```
 app/renderer/components/Pages.tsx         |  4 ++--
 app/renderer/components/TopBar.tsx        |  3 ++-
 app/renderer/components/WorkerSettings.tsx |  2 +-
 app/renderer/lib/quota.ts                 | 12 ++++++++++--
 docs/ui-spec.md                            |  3 ++-
 src/core/quota.ts                          | 31 ++++++++++++++++++++++--------
 src/core/stats.ts                          |  8 +++++++-
 src/core/view-types.ts                    |  3 ++-
 test/fixtures/quota/query.ts              |  4 +++-
 test/lifecycle.test.ts                    |  2 +-
 test/limits.test.ts                       |  1 +
 test/listed.test.ts                       |  4 ++--
 test/quota.test.ts                        | 19 ++++++++++--------
 test/stats.test.ts                        | 11 +++++++++++
 14 files changed, 78 insertions(+), 29 deletions(-letions 省略)
 新增：src/core/kimi-quota.ts、test/kimi-quota.test.ts、
      test/fixtures/quota/kimi-usage.txt、test/fixtures/quota/kimi-providers.json
```

关键 diff：`quota.ts` 去掉两处 `p.icon !== 'kimi'` 过滤并新增 Kimi 分支；`checkQuota` 对 Kimi 改为遍历全部账户窗口（其余家单条口径不变）；`kimi-quota.ts` 为全新文件（查询、解析、缓存元数据）。

## 评审记录

### 2026-10-19 集成回归补充

主线全量回归发现：旧缓存缺 Kimi 且来源查询失败时，ensureQuota 会因缺项重查所有厂家，覆盖仍有效的 Codex 停派依据。已改为只追加 Kimi 未知项、保留其他厂家的有效缓存，不能把查询失败作为绕过已有停派证据的机会。新增最小回归并重跑续接前额度闸门；不改未知额度策略，不放宽任何生产检查。优先级复核：已复核，无调整，仍 P2 / PASSED；最终集成验收记录另随主线运行结果维护。

### 2026-10-19 负责人修正与复验：PASSED

- 修正四条阻断：不设百分比线也拒绝任意已确认触顶窗口（显式 force 保留旧语义）；error 数据只作历史展示不判断本次额度；中转/账号切换隔离旧官方数字；金额逐字段、明确币种解析，未知/无限/混合币种不借数；stats 直接消费 queryQuota 的规范快照，窗口、重置或来源不同不计差值。
- 来源指纹仅为内存中配置的 SHA-256 摘要，不保存账号或原始 provider 输出。每次使用缓存前本地只读复核来源，必要时只刷新 Kimi，不覆盖其他家的有效缓存；所有 Kimi 查询错误都转固定脱敏提示。
- 保留原执行者 CLI 2.2.0 探针与有界交互方案；本轮未重跑真实账号查询、未发模型推理、不改服务方付费设置。Extra Usage 未经真实输出验证，未知字段保持 null；开启时界面明确提示运行中可能额外计费。
- 实跑 typecheck、四个核心测试文件 46/46、五个集成文件 83/83、界面 319/319、build、Electron 真窗口冒烟 1/1 均通过。完整 Kimi 额度卡已补拍浅/深/窄截图并人工检查，内容换行正常，余额不进入百分比环。最终整合批次再跑整库 verify。
- 优先级已复核，无调整。通过后独立分支提交并由负责人合入开发分支，保留其他任务和原型备份；此前 GitHub DNS 失败，不自动重试推送。

### 2026-10-19 Codex 复审：CHANGES_REQUESTED（P2 / High）

**范围**：`.worktrees/task-019`、`feat/task-019-kimi-quota`、基线 `cec2ff8` 的未提交实现。保留执行者探针和实施报告，但本轮未重做真实账号查询或用真实模型验证。主工作区未跟踪的同名 Kimi 文件未被覆盖或纳入提交。

**本轮实跑**：`npm run typecheck` 通过；`test/kimi-quota.test.ts test/quota.test.ts test/guide.test.ts test/stats.test.ts` 共 42/42 通过（本轮未出现报告中的 pty 失败）。独立离线复现 `/private/tmp/task-review-20261019.test.ts` 中 TASK-019 的四条全部失败；需迁入正式测试，而不是继续把执行器整体替身的通过当成边界验证。

**必须修正**

1. **[P1] 不设百分比停派线时放行已耗尽的 Kimi 套餐。** `quota.ts:292` 在 `quotaStop === null` 时完全跳过所有 Kimi 窗口，且 `reached` 只检查 Codex。实际 5 小时窗口 100%、`force=false` 仍能派发；若服务端已开 Extra Usage，可能进入额外消费。按既有语义区分“百分比预警停派”和“服务端额度触顶”，已确认套餐耗尽不能因关闭百分比线或有加油包余额而放行，显式 force 仍沿用既有语义。补 99%/100%、null 阈值、各窗口、force 与加油包组合测试。

2. **[P1] Kimi 检查绕过 error 标志，导致失败缓存/中转切换被旧官方数据拦截。** 新分支直接读取 entry.bars，不像 `quotaBar` 会拒绝 error 数据。复现：保留旧 100% 且 `error='接的是自定义接口，不查官方套餐'`，仍被旧套餐拒绝。暂时网络失败按现有规则保留旧数据与原时间作展示，但不能据此判本次服务端额度；切换自定义接口/账号应失效或隔离旧账户官方数据，不能把旧套餐冒充新付款来源。补旧缓存高/低值、失败、官方切中转及来源变更测试；不得通过 force 规避。

3. **[P2] Extra Usage 正则跨字段借数，未知余额被伪造为月上限。** `parseExtraUsage` 使用 `[^\\d]*` 可越过字段名称：输入 `Enabled Balance unknown Monthly limit $100 Spent $3` 返回 balance=100（应为 null）。月上限未知时同样可能读到后面的消费金额。按明确字段边界和验证过的单位/格式解析，未知/无限/缺失/未启用保持相应语义，不猜测未实测的金额。加缺值、乱序、相邻字段、零、无限和混合单位用例。

4. **[P2] stats 的 Kimi 分支读取了生产者不会生成的数据形状。** 当前读取 `snapshot.kimi.bars`，但 `queryQuota` 和写入 job.quota_before/after 的真实结构是 `{queriedAt, providers:[{icon:'kimi',bars:...}]}`。复现：真实形状的 49% 输入返回 null，新增测试却用手造的根级 kimi 字段掩盖了问题。复用权威快照读取口径并保证前后是同一窗口/单位，窗口缺失或切换不能拼成错误差值。补 queryQuota/派发快照流入 stats 的集成证据，不止手写另一种结构。

**修正边界**：主要是 `src/core/quota.ts`、`src/core/kimi-quota.ts`、`src/core/stats.ts` 及对应测试，必要的来源失效元数据可补类型；不修改 TASK-010 或恢复协议，不新增依赖、网络接口、真实模型调用、付费开关或隔离变更。保留 Cursor 顶栏总额度修正。不提交、不 push、不合并、不自行标 PASSED。

**复验**：

```bash
npm run typecheck
node --test --test-timeout=120000 test/kimi-quota.test.ts test/quota.test.ts test/guide.test.ts test/stats.test.ts
node --test --test-timeout=120000 test/listed.test.ts test/lifecycle.test.ts test/desktop.test.ts test/limits.test.ts test/architecture.test.ts
npm run test:ui
npm run build
```

更新实施报告，说明新增用例、实际结果与差异；UI 既有失败与本题新增失败分开记录，真实探针与替身测试分开，浅/深/窄截图和真实窗口未验收不得写通过。当前重复的“评审记录”标题归为一处，探针记录中 2.1.1/2.2.0 的日期与实测版本需对齐，不能把文档核实当作实际采集。

**优先级复核**：已复核 TASK-019 及 TASK-015/017/018，无调整。TASK-019 保持 P2 / High，改 CHANGES_REQUESTED；本轮与 TASK-010 均未通过，不提交同步，不推进其依赖。两项可在各自副本继续独立修正。

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
