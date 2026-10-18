# TASK-008：执行预算、停滞判定与可靠收尾

- 状态：`PASSED`
- 优先级：`P1`
- 难度等级：`High`
- 前置任务：无
- 需求来源：真实执行 TASK-006 时，两个选手均长时间运行而没有自动收敛；产品定位是无人看守执行。

## 业务结果

任何选手或测试都不能无限占用一件派活。平台能区分手动停止、停滞和单次超时，在有界收尾后保留足够证据供自动诊断或人工复核。

## 范围

- 包含：普通任务的停滞/总时限预算，执行快照和结构化终止原因，进程树收尾，项目设置默认与兼容读取，核心/UI 测试的单用例超时。
- 不包含：自动重试、负责人 AI 诊断、自动细拆、新界面、自动合并。

## 现状与设计

- `runWorker` 的 `watch` 每 2 秒采集活动和停止请求，但主流程只等选手进程退出，没有执行预算。
- 停滞不得只看 `lastActivityAt`。至少同时记录结构化活动时间、`run.log`/`stderr.log` 大小及最后变化时间，并扣除电脑休眠时间。达到停滞门槛后写一次预警快照，给固定宽限期；有任意新活动或日志增长则解除预警。宽限期结束仍无变化才停止。
- 单次总时限是硬上限；休眠时间不计入。缺省为停滞 20 分钟、宽限 5 分钟、单次硬上限 120 分钟；停滞只允许 10–60 分钟，单次上限只允许 30–240 分钟且必须大于停滞加宽限。预算只能由已登记项目设置/主人策略设定，题目、选手报告和环境变量不得放宽。
- `Job` 新字段必须可选，旧记录继续读。结束状态可保持兼容，但必须有结构化 `termination` 区分 `manual | stalled | timed_out | process_error`。
- 测试入口给 `node:test` 和 Vitest 设有限的单用例超时；不用缩短整套验收的方式掩盖真实慢测试。

## 主要文件

- `src/core/runner.ts`
- `src/core/job.ts`
- `src/core/project.ts`
- `package.json`
- `test/lifecycle.test.ts`
- `test/desktop.test.ts`
- `test/ui/`

## 约束

- 遵守 `AGENTS.md` 和 `docs/decisions/ADR-001-bounded-autonomy.md`。
- 不新增依赖，不改选手隔离。
- 超时收尾必须复用现有进程树终止和宽限后强停逻辑，Windows 与 macOS 都要测。
- 读日志元数据失败不能让看管进程崩溃；取不到时仍由总时限兜底。
- 不得把长时间工具调用的“开始事件”当成永久活跃；最终仍受硬上限限制。

## 验收标准

1. 替身选手永不退出时，测试时钟可快进到停滞或总时限；选手进程树被停掉，任务结束且留下正确 `termination`。
2. 活动或日志在宽限期内恢复增长时取消停滞候选，不误停正常任务；超过硬上限仍必须停止。
3. 手动停止、停滞、总超时和看管异常在记录和公开 View 中可区分，旧记录仍可展示。
4. 不论何种终止原因，都收集已有报告、diff、最后活动、用量和日志摘要，且不留存活选手子进程。
5. 一条永不结束的核心或 UI 测试在单用例上限内明确失败并打印用例名，不再让整轮命令无限等待。
6. 旧项目设置缺少新字段时正常读取为 20/5/120 分钟；非法范围或“总上限不大于停滞+宽限”在派活前拒绝。

## 验证

```bash
npm run typecheck
node --test --test-timeout=120000 test/lifecycle.test.ts test/desktop.test.ts
npm run test:ui
npm run build
```

负责人最终运行 `npm run verify`，并真派一件会卡住的替身活，核对进程树和结构化终止证据。

## 实施报告

### 改动摘要

- 新增 `src/core/budget.ts`：执行预算的纯逻辑。`checkBudget` 校验停滞 10–60 分钟、宽限 1–60 分钟、单次总上限 30–240 分钟且必须大于停滞加宽限（缺省 20/5/120）；`budgetTick` 是停滞判定状态机——同时看结构化活动时间与 `run.log`/`stderr.log` 的大小和修改时间变化（取最新的一个信号），扣除记录的休眠；达到停滞门槛给一次预警事件，固定宽限内有新信号就解除，宽限结束仍无信号才判停滞；单次总时限是硬上限，不依赖信号，任何时候先到都直接超时。时钟和观测全部注入，测试可快进。`parseBudget` 提供命令行 `--budget 停滞,宽限,总上限` 写法。
- `src/core/runner.ts`：看管循环每 2 秒采集之外，加预算判定。日志元数据单个文件读失败只跳过该文件，看管进程不崩，由总时限兜底。达到停滞门槛写一次预警快照（`job.stallWarning`：停滞时刻、最后信号时刻、日志字节数），宽限内恢复就删除；停滞/超时命中先记结构化终止原因，再走和手动停止相同的进程树收尾（SIGTERM、宽限后 SIGKILL 强停，Windows/macOS 共用现有逻辑）。`runWorker` 增加可选 `now` 注入（生产用真实时钟）；预算从已登记项目设置读取，读不到按缺省，不能放宽。长时间工具调用的“开始事件”不算新信号（只看活动时间与日志增长），且最终受硬上限限制。
- `src/core/job.ts`：新增可选字段 `termination`（`manual | stalled | timed_out | process_error`）与 `stallWarning`，旧记录没有也能读。看管异常、手动停止、停滞、超时在收尾时分别落对应的 `termination`。
- `src/core/project.ts`：`Project` 增加可选 `budget`；`addProject` 登记时校验；新增 `projectBudget`：旧登记缺字段读成 20/5/120，登记被改坏时在派活前抛中文错误拒绝，不悄悄按缺省放行。
- `src/core/dispatch.ts`：派活前调用 `projectBudget` 把关。
- `src/cli/cli.ts`：`project add --budget 停滞,宽限,总上限`（分钟），帮助文案同步。
- `src/core/view-types.ts`、`src/core/view.ts`：公开 View 增加 `termination`（旧记录为 `null`），界面可区分手动停止、停滞、总超时、看管异常与老记录。未做新界面。
- `package.json`、`vitest.config.ts`：`node --test --test-timeout=120000` 与 Vitest `testTimeout: 120000`，单用例超时内明确失败并打印用例名。

### 测试结果

- `npm run typecheck`：通过。
- `node --test --test-timeout=120000 test/lifecycle.test.ts test/desktop.test.ts`：61 条过 60；唯一失败「派发进程准备期间被杀后登记不永远排队，可停止残留准备进程」与本次改动无关——本机经 Kimi 运行时跑测试时 `process.execPath` 是 Kimi Helper 而非纯 Node，setup 进程经 `externalEnvironment()`（既有逻辑，有意删除 `ELECTRON_RUN_AS_NODE`）启动后不会执行 `-e` 脚本，等待的标记文件永远不会出现。在开发机/流水线（execPath 是真 Node）上该用例不受影响。已用最小复现确认机制，未改动平台 env 过滤规则。
- 新增用例全部通过：预算判定单元测试（停滞门槛、一次预警、宽限解除、硬上限优先、休眠扣除、范围校验）；「替身永不退出，快进时钟到停滞，进程树被停、留下 stalled 证据」（约 29 秒，25 倍单调时钟）；「宽限期内日志恢复增长解除停滞候选，超过硬上限仍停止」（约 73 秒）；desktop 预算校验用例（旧登记缺省 20/5/120、登记时校验范围、手改坏后派活前拒绝、命令行写法）；既有 stop 用例补 `termination: manual` 断言、runner-fatal 用例补 `process_error` 断言。
- `npm run test:ui`：34 个文件 311 条全部通过。
- `npm run build`：通过。
- Windows 收尾路径：与 macOS 共用现有 `killTree` 逻辑（本任务未改动），按 AGENTS.md 交由流水线在 Windows 上验证。

### 未完成项

- 负责人最终验收：真派一件会卡住的替身活，核对进程树与结构化终止证据；Windows 真机核验。
- 停滞/超时后的自动诊断、续跑或重派不在本任务范围（按 ADR-001 由负责人在新会话分类）。

### 规则边界

- 预算只能来自已登记项目设置（`project add --budget` 或登记 JSON），题目、选手报告、环境变量都到不了校验层，放宽不了；`XAGENTS_MAX_RUNNING` 之类的环境变量依旧只能收紧。
- 没有自动重试、没有负责人 AI 诊断、没有自动细拆、没有新界面、没有自动合并、没有改选手隔离。
- 规划文件、任务状态不由本任务改写；停滞/超时只停止选手进程树并留证据，任务状态记 `stopped` + `termination`，便于负责人区分处理。
- 休眠时间不计入停滞与总时限（`job.sleeps` 记录扣除）。

### Diff 摘要

- `src/core/budget.ts`（新增，约 80 行）：预算校验 + 停滞状态机 + 命令行解析。
- `src/core/runner.ts`（+73/−13）：看管循环预算判定、预警快照、结构化终止原因、`now` 注入。
- `src/core/job.ts`（+8）：`termination`、`stallWarning` 可选字段。
- `src/core/project.ts`（+13）、`src/core/dispatch.ts`（+3 行调用与导入）、`src/cli/cli.ts`（+10 左右）：登记与派活前的预算校验、`--budget` 参数。
- `src/core/view-types.ts`、`src/core/view.ts`（+4）：View 带 `termination`。
- `test/lifecycle.test.ts`（+约 100 行本任务部分）、`test/desktop.test.ts`（+约 45 行本任务部分）、`test/runner-fatal.test.ts`（+1）、`test/ui/fixtures.tsx`（fixture 补 `termination: null`）、`package.json`/`vitest.config.ts`：单用例超时。

注：仓库尚无提交，工作区含此前任务的未提交改动，上述行数是与工作区基线的差异，共享文件里可能混有早前任务的改动。

## 评审记录

### 2026-10-18 Codex 二轮复审

- 结论：`PASSED_WITH_NOTES`。
- 首轮两项阻断均已修复：无看管进程直停、Windows 强停和 `reconcile(stopRequested)` 均保留既有原因并补 `manual`；轮次归档保存 `termination/stallWarning`，续接成功后当前轮清空旧字段，历史证据仍归属于上一轮。对应生命周期与群聊续接测试已覆盖。
- 本机验证：`npm run typecheck` 通过；TASK-008 与群聊联合核心套件中预算、进程树、手动停止、轮次证据相关用例均通过；`npm run test:ui` 为 **34 个文件、312 项通过**；`npm run build` 通过。联合套件唯一失败是 TASK-007 已改变 Cursor 群聊准入但未同步 `test/desktop.test.ts` 的旧拒绝断言，与 TASK-008 修正无关，已记入 TASK-007 的修正要求。
- 保留备注：真实卡住任务、Windows 真机和完整 `npm run verify` 仍由负责人最终验收。由于 TASK-007 未通过且它与 TASK-008 混改 `wake.ts`、`chat-engine.test.ts` 等文件，本轮无法按配置安全地只提交 TASK-008；未自动 commit/push。
- 优先级复核：TASK-008 通过后 `TASK-009` 前置条件满足，提升为 `READY`，优先级仍为 `P1 High`；其他未通过任务优先级无调整。

### 2026-10-18 修正记录（第二轮）

- 统一手动停止的 `termination: manual`：`src/core/commands.ts` 的两条直接路径（看管进程已不在时由 `stop` 直接收尾、Windows 看管卡住 5 秒后的强停收尾）和 `src/core/job.ts` 的 `reconcile`（`stopRequested` 下修正成 `stopped`，含 queued/running 两个分支）都补上 `termination ??= 'manual'`，与看管进程正常收到停止记号的路径一致；已写下的终止原因（如停滞）不覆盖。
- 轮次归档：`src/core/team.ts` 的 `RoundRecord` 增加可选 `termination`/`stallWarning`；`src/core/wake.ts` 的 `archiveFinished` 与 `foldRounds` 把这两个字段归到所属轮——`archiveFinished` 遇到这一轮已被 `foldRounds` 折好的记录时补写证据而不是重复建记录；`resumeMember` 在归档成功后 `delete current.termination/stallWarning`，当前轮不再暴露上一轮原因，历史证据留在 `rounds` 里。
- 新增/扩展测试：lifecycle「看管进程被 SIGKILL 后 stop 收残留组」与「看管进程尚未安装信号处理器时 stop」断言 `termination: 'manual'`（分别覆盖 stop 直停路径与 `reconcile` 的 stopRequested 路径，后者模拟派发进程不在、Windows 强停分支同代码）；chat-engine「同一成员再次 @ 续接」模拟上一轮停滞收尾，断言 `rounds[0].termination === 'stalled'`、预警快照归档到该轮、当前轮两个字段清空、第二轮正常结束后仍为 `undefined`。
- 验证：`npm run typecheck` 通过；`node --test --test-timeout=120000 test/lifecycle.test.ts test/desktop.test.ts test/chat-engine.test.ts` 共 84 条过 82；`npm run test:ui` 312 条全过；`npm run build` 通过。
- 两个与本次修正无关的失败（均已定位）：
  1. 「派发进程准备期间被杀后登记不永远排队」——本机 Kimi 运行时 `process.execPath` 为 Kimi Helper，setup 进程经既有的 `externalEnvironment()`（有意删除 `ELECTRON_RUN_AS_NODE`）启动后不执行 `-e` 脚本；首轮评审已在标准 Node 环境复跑 61/61 通过。
  2. 「群聊桥参数先检查」期望 `members: ['cursor-grok:high']` 被拒绝，但 14:53 工作区里 `src/core/chat.ts` 被本轮任务之外的改动更新（`checkChatOptions` 现接受 Cursor 成员，与 chat-engine 已有的「Cursor 成员」建群用例同向），该 desktop 用例的期望未同步。按范围约束未代为修改，留负责人定夺。

### 2026-10-18 Codex 首轮评审

- 结论：`CHANGES_REQUESTED`。
- 已确认的通过项：预算范围与默认值、停滞预警/宽限恢复/硬上限、日志元数据容错、进程树收尾、公开 View 兼容和单用例超时均已实现。本机复跑 `npm run typecheck`、`npm run test:ui`（34 个文件、311 项）和 `npm run build` 均通过；`node --test --test-timeout=120000 test/lifecycle.test.ts test/desktop.test.ts` 在标准 Node 环境为 **61/61 通过**，实施报告中的运行时差异未复现。
- 阻断问题 1（手动停止原因不完整）：只有看管进程正常收到停止请求的路径会写 `termination: manual`。`src/core/commands.ts` 在看管进程已经不在、直接 `finish(..., 'stopped')` 的分支，以及 Windows 等待 5 秒后的强制收尾分支，都没有写 `manual`；`src/core/job.ts` 的 `reconcile` 在 `stopRequested` 下修正为 `stopped` 时也没有写。因此公开 View 仍无法可靠区分所有手动停止，与验收标准 3 不符。
- 阻断问题 2（续接污染当前轮且丢失历史证据）：`src/core/wake.ts#resumeMember` 开新一轮时没有清除上一轮的 `termination` 和 `stallWarning`，而 `archiveFinished`/`RoundRecord` 也没有归档这些字段。停滞、超时或手动停止后的任务一旦续接，运行中乃至成功完成后仍会暴露上一轮的终止原因/预警；若直接删除字段又会丢失上一轮证据。应先把它们归档到对应 `RoundRecord`，再清理当前轮字段。
- 修正要求：统一所有由主人 `stop` 导致的直接、修正和 Windows 强停路径写入 `termination: manual`；扩展轮次归档以保存上一轮 `termination`/`stallWarning`，`resumeMember` 在归档后清空当前轮字段。补充测试覆盖无存活看管进程的 stop、`reconcile` 的 stopRequested 路径，以及带旧终止信息续接后“历史保留、当前轮清空、成功结束仍为 null”。不得扩大到自动重试、诊断或新界面。
- 修正后验证：`npm run typecheck`；`node --test --test-timeout=120000 test/lifecycle.test.ts test/desktop.test.ts test/chat-engine.test.ts`；`npm run test:ui`；`npm run build`。填写实施报告补充并再次等待复审。
- 优先级复核：`TASK-008` 保持 `P1`，因为它仍阻塞 `TASK-009`；`TASK-009` 至 `TASK-012` 的依赖与优先级不变；`TASK-003` 保持 `P2 READY`；`TASK-007` 保持 `P1 BLOCKED`。已复核，无调整。
