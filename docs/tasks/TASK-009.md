# TASK-009 — 自治执行记录与确定性推进器

- handoff_contract: `1`
- status: `PASSED`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-006[PASSED|PASSED_WITH_NOTES], TASK-008[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果

主人从一个可执行 Task ID 启动“无人看守”后，平台能把整个执行的状态、预算、当前节点和历史尝试原子落盘；应用或推进器重启后可继续，不会重复启动同一步。

## 范围

- 包含：自治执行登记结构、状态机、原子更新与锁、崩溃恢复、全局预算核算、受控启动/停止核心入口、CLI 骨架与核心测试。
- 不包含：调用负责人 AI、自动细拆、复用专用副本写入、自动审查/验收、桌面界面。

## 现状与设计

- 新增 `AutopilotRun`（实际命名可按仓库惯例调整），存于 `~/.xagents/autopilots/<id>/run.json`；不把全局状态塞进 `Job` 或 `Batch`。
- 记录至少包含项目/仓库/起点、Task ID/spec、已由主人选定的执行者范围、网络与读写快照、时长/停滞/尝试/节点/深度/额度预算、状态、当前动作令牌、节点与尝试历史。
- 推进器是隔离外的 detached 进程，模式参考 `team-engine.ts`。每次转移先在锁里核对状态和动作令牌，再记录意图，最后启动外部工作；恢复时能判断工作是尚在运行、已完成还是未启动。
- 初始状态机只搭骨架：`planning | executing | reviewing | verifying | diagnosing | recovering | completed | needs_owner | stopped`。本任务用可控替身动作验证转移，不接真实 AI。
- 预算统一核算运行时长（扣除休眠）、尝试数、新节点数和已知用量。任一上限到达后只能转 `needs_owner` 或完成收尾。
- 首版只接受三个策略预设：短任务 = 60 分钟/4 次尝试/3 子节点，标准 = 240 分钟/10 次/6 节点，长任务 = 480 分钟/16 次/10 节点；细拆深度最大 2，单节点 `continue` 和 `retry` 各最多 1 次。入口只接预设 ID，不接任意数字或 JSON。

## 主要文件

- `src/core/autopilot.ts`（新增）
- `src/core/autopilot-engine.ts`（新增）
- `src/cli/cli.ts`
- `test/autopilot-record.test.ts`（新增）
- `test/autopilot-engine.test.ts`（新增）

## 约束

- 遵守 `AGENTS.md` 和 ADR-001；不新增依赖。
- 只能从 TASK-006 的核心权威校验入口启动，不信任界面带来的 Task 内容。
- 同一自治执行任何时刻只有一个推进器；锁损坏、重复进程和旧记录都必须失败关闭。
- 启动和停止参数严格白名单；不接受路径、任意命令、隔离开关或未在 roster/policy 里的选手。
- 本任务不得为了跑通骨架而自动改 Task Spec 状态或合并主分支。

## 验收标准

1. 可从真正 ready 的 Task ID 创建一份完整登记；不可执行任务、非登记项目、非法预算或非法选手在写文件前被拒绝。
2. 所有转移均在原子锁内验证；两个推进器并发时只有一个取得动作权。
3. 在“登记意图后崩溃”和“外部动作完成后、落盘前崩溃”两个时点重启，不会重复派出一件活，也不会永久卡在过渡态。
4. 时长、尝试、节点或用量任一预算用完后，替身动作不再被调用，登记转为 `needs_owner` 并记录具体上限。
5. 推进器被杀掉后，下次只读列表/启动命令能识别并恢复；停止后不留存活推进器或选手进程。
6. 三个策略预设的时长、尝试、节点和深度与设计文档一致；任意数字、未知预设或尝试放宽在登记前被拒绝。

## 验证

```bash
npm run typecheck
node --test test/task-plan.test.ts test/plan-dispatch.test.ts test/autopilot-record.test.ts test/autopilot-engine.test.ts
npm run build
```

## 实施报告

### 2026-10-18 实现（独立 worktree `feat/task-009-autopilot`）

- 工作地点：独立 Git worktree `.worktrees/task-009`，分支 `feat/task-009-autopilot`（从 `codex/custom-requirements` 的当前工作区状态铺开，含尚未提交的 TASK-005/006/008 成果）。未提交、未 push、没有用 `git stash`。
- **改动摘要**
  1. `src/core/autopilot.ts`（新增，358 行）——执行登记与判定，不启动任何外部工作。
     - 独立登记：`~/.xagents/autopilots/<编号>/run.json`，`withLock` 里"读 → 改 → 写"，写入走 `writeJson`（先写临时文件再改名，`fd.sync` 后才 rename），超过 2 MB 拒绝写。
     - 结构：项目/仓库/起点提交、Task ID/spec、主人选定的选手范围、联网与读写快照、预设策略、状态、当前动作令牌、节点与尝试历史、推进器 pid、时长/休眠/尝试/节点/已知用量。
     - 校验：`createAutopilot` 在写文件前做完所有检查——项目名、`TASK-数字` 格式、策略只认 `short|standard|long`、选手 1–6 位且必须在 roster 与主人策略内（`selection` + `checkChoice`）、项目未归档、任务必须由 TASK-006 的权威入口判定为可执行、同一任务同时只许一台。没登记的项目把 ENOENT 翻成中文。
     - 状态机 `advance`：`planning | executing | reviewing | verifying | diagnosing | recovering | completed | needs_owner | stopped` 九个状态的纯转移，非法转移返回 `false`；`budget`/`blocked` 只能转 `needs_owner` 并写中文原因与 `limit`；`lost` 只转 `recovering`（推进器丢了不是失败），`resume` 接着走。
     - 预算：`budgetUsed` / `exceededBudget` 四项——运行时长（`elapsedSeconds`，休眠单独记在 `sleeps` 里不计）、尝试次数、节点数、已知用量（登记里给了 `usageLimit` 才判）。到线只转 `needs_owner`。
     - 预设与上限：short 60 分钟/4 次/3 节点，standard 240/10/6，long 480/16/10；`MAX_DEPTH = 2`，单节点 `continue`、`retry` 各 1 次。
     - 令牌：`transition(id, token, fn)` 在锁里核对状态与当前动作令牌，令牌对不上就拒绝；旧记录、手改坏的记录 `parseRun` 直接失败关闭。
  2. `src/core/autopilot-engine.ts`（新增，306 行）——确定性推进器。每步固定形状：锁里核对状态与令牌 → 写意图（`action.token`）→ 动手 → 回来落盘结果。
     - 互斥：`takeAction` 的意图与令牌在同一次锁内改写里完成，两个推进器同时来只有一个写进去；`launchAutopilotEngine` 和 `runAutopilot` 都先看有没有活着的 pid，登记里已经有推进器时进程直接退出。
     - 崩溃恢复：`recover` 分两种现场——"有令牌没任务号且找不到证据"（外部动作从没启动）用同一个令牌补一次；"找到带同一令牌的任务记录"（外部动作成功、登记没落盘）只认领不重派。两边都受令牌保护，旧推进器回来也改不动新状态。
     - 预算到线：先把在跑的那几件活 `stop` 掉，再转 `needs_owner`，之后一步外部动作都不会再发。
     - 收尾：派活本身失败（自检/额度/并发/登录）不重试，直接 `needs_owner` 写原因；一次尝试成功或失败都记账（`attempts`、节点状态、用量），失败按每节点 1 次重试且受预算限制。
     - 受控入口：`startAutopilot`（建登记 → 叫推进器）、`stopAutopilot`（先 `killEngine` 再停活再落 `stopped`、清 pid）、`reconcileAutopilot`（推进器不在就记 `recovering`，不永久卡在过渡态）。
     - 骨架边界：一次尝试正常做完后按状态机进 `reviewing`，因为本任务不接 AI 审查与验收，随即以中文原因转 `needs_owner` 交给主人；`reviewed`/`verified` 两条转移已实现并单测覆盖，留给后续任务接审查与验收。
  3. `src/core/autopilot-entry.ts`（新增，12 行）——detached 推进器入口，只接一个登记编号，先 `loadConfiguredRoster()` 再 `runAutopilot(id)`，别的参数一概不认。
  4. `src/cli/autopilot.ts` + `src/cli/cli.ts`——CLI 骨架 `xagents autopilot start|status|list|stop`，参数走现有 `parse`/`arity` 白名单（`--project`、重复 `--who`、`--policy`、`--ro`），帮助文案同步；不接任意数字或 JSON。`status`/`list` 先过 `reconcileAutopilot`，登记文件坏了的条目报出来但不拖垮其它。
  5. 接线（都是加几行，不改既有行为）：`src/core/job.ts` 加可选 `autopilot: { run, token }`；`src/core/dispatch.ts` 透传并写进任务记录（崩溃恢复的现场证据）；`src/core/plan-dispatch.ts` 把权威校验抽成 `readyTask(project, taskId)` 供规划派发与无人看守共用，并透传 `autopilot` 令牌，`planDispatch` 行为不变；`src/core/wake.ts` 的引擎快照白名单加 `autopilot-entry.ts`。
  6. 没有新增依赖；没有改选手隔离、自检、额度或 roster；没有接负责人 AI、自动细拆、自动审查、自动验收和桌面界面；不改 Task Spec 状态、不合并主分支。
- **测试结果**
  - `npm run typecheck`：通过（核心 + main + preload + renderer）。
  - `node --test --test-timeout=120000 test/task-plan.test.ts test/plan-dispatch.test.ts test/autopilot-record.test.ts test/autopilot-engine.test.ts`：**48/48 通过**（task-plan 26、plan-dispatch 4、autopilot-record 9、autopilot-engine 9）。
  - `npm run build`：通过（main、preload、renderer 三份产物）。
  - 另跑 `npm run test:ui`：**34 个文件、312 项全通过**（本次没有改界面，跑一遍确认接线没碰坏）。
  - 另跑全量核心测试 `npm test`：841 项里 **829 通过、2 项失败**，失败的是 `test/quota.test.ts` 里两条伪终端桥用例（先报 `out of pty devices`，随后连带的 `.pids` 文件 ENOENT）——隔离环境里开不出 pty，和本任务无关（这两条在本任务开工前的基线里就同样失败）；其余全过。
  - 验收标准逐条对应：
    1. 登记/拒绝 → `autopilot-record` 的"从真正 ready 的任务建登记"和"不可执行的任务、非登记项目、非法选手和非法预算都在写文件之前拒绝"（DRAFT、依赖没过、台账没有、坏号、未登记项目、错选手、7 位、非法强度、非预设策略，全部写文件前失败，且事后没有登记目录）。
    2. 互斥 → "两个推进器同时动手，只有一个取得动作权"（三个并发 `stepAutopilot`，替身只被调用一次，`attemptCount === 1`）；另有"动作令牌：换人之后旧令牌的改写被拒绝"。
    3. 两个崩溃窗口 → "崩溃窗口一：记下意图、还没动手就崩了"（用原令牌补一次，不重复记账）、"崩溃窗口二：外面已经派完了、还没落盘就崩了"（零次新派活，认领任务号后接着收尾）、"推进器被杀：只读列表能认出并记成等恢复，再启动就从登记接着走完"。
    4. 预算 → "预算用完：替身动作不再被调用，登记转 needs_owner 并写明是哪一项"（时长、尝试两种上限；在跑的那件活被 `stop`）。
    5. 停止与残留 → "停止：先停推进器再停在动的活，之后不留存活进程"（真起一个 detached 进程当推进器，`stopAutopilot` 后确认进程真的不在、登记 `stopped`、pid 清空）；"收尾状态下叫推进器不会起进程"；被杀后 `reconcileAutopilot` 认成 `recovering`。
    6. 预设与深度 → "三个策略预设与设计一致"与"预算四项分别判定"。
  - 生产自检、隔离、额度、并发上限一概没放宽：无人看守派活走的是同一个 `planDispatch → dispatch`，一条判断都没改。
- **未完成项 / 需负责人验收**
  - 真实窗口冒烟（`npm run test:e2e`）没跑：要开真的 Electron 窗口，在隔离里跑不了；本任务也没有界面改动。
  - 没有用真实选手跑过一整轮无人看守（范围本来就是"骨架 + 替身动作"）；接真实审查、验收、细拆是后续任务（TASK-010 起）的事。
  - `usageLimit` 目前只有登记层支持（给了上限才判），还没有从设置换算默认上限；已知用量现在只累计、随任务记录增加。
  - 子节点 DAG 只有根节点一个（`nodes` 与常量上限已经就位），细拆在后续任务里扩。
  - `docs/design.md` 没有另写一节：设计落在 ADR-001 与本题、以及代码顶部注释里，需要的话请负责人指定要补的位置。
- **diff 摘要（未提交，在 worktree `feat/task-009-autopilot` 里）**
  - 新增：`src/core/autopilot.ts`（358 行）、`src/core/autopilot-engine.ts`（306 行）、`src/core/autopilot-entry.ts`（12 行）、`src/cli/autopilot.ts`（79 行）、`test/autopilot-record.test.ts`（262 行）、`test/autopilot-engine.test.ts`（289 行）。
  - 改动：`src/core/job.ts`（+3：`autopilot` 追溯字段）、`src/core/dispatch.ts`（+2：选项与写进任务记录）、`src/core/wake.ts`（+1：快照白名单）、`src/core/plan-dispatch.ts`（抽 `readyTask` 并透传令牌）、`src/cli/cli.ts`（+30：命令分支与帮助）、本文件（实施报告）。
  - 未提交、未 push；提交与合并留给负责人。

### 2026-10-18 第二轮修复（评审三条阻断项）

评审意见照做，三条都改在核心层；界面、Task Spec 状态、依赖都没动，仍在 worktree `feat/task-009-autopilot`，未提交、未 push、未合并。

- **1. 同一任务并发启动的竞态**

  原来 `createAutopilot()` 是"先 `listAutopilots()` 查重，再 `reserveAutopilot()` 建目录、写 `run.json`"，三段不在同一把锁里，两个并发启动会都通过查重、各建一台。

  现在加了全局登记锁 `registryLockDir()`（`~/.xagents/autopilots/.registry`，`listAutopilots` 会跳过点开头的目录），`createAutopilot` 把四件事放进同一把锁里做完、按顺序：① 扫描已有登记（`listAutopilots`）② 判同一 `project + taskId` 有没有活跃执行，有就报"这个任务已经有一台无人看守在推进（编号），请先 stop 或等它结束"③ 在内部分配编号（`mkdir` 仍是第二道保险）④ 建目录并写入初始 `run.json`（写前按同一套规矩校验）。不再只依赖目录编号唯一。

  另外在推进器侧补了进程内互斥（`inProcess` 集合）：同一个进程里两个 `runAutopilot` 盯同一台执行，第二个直接退出。

  测试：`同一任务并发启动：只有一个建成，磁盘上只有一台活跃登记，也就只可能起一台推进器`——`Promise.allSettled` 起三次，断言恰好一个成功、两个收到"已经有一台无人看守在推进（编号）"、`listAutopilots` 里只有一台登记且没有 pid（没有推进器被拉起来）。另外做了反向验证：临时拆掉全局锁后这条用例立刻失败（三个都建成），确认它真能抓到竞态；`同一个进程里两个推进器盯同一台执行：只有一个动手` 覆盖进程内互斥。

- **2. 严格校验持久化的 `AutopilotRun`**

  `parseRun` 改写成 `assertRun`（`parseRun` 保留为它的别名，导出没变），逐项校验，任何一项不对都抛中文错误失败关闭，**不按默认值修、不按现在的设置放宽**：

  - 编号：目录名必须是平台生成的写法（`0918-1530-auto`），且 `run.id` 必须等于目录名；
  - 策略：`policy.id` 必须是 `short|standard|long`，且 `minutes / attempts / nodes` 必须与 `PRESETS[id]` **逐项完全相等**（手改数字等于放宽预算，直接拒绝并报出应为多少）；
  - 基本字段：`version === 1`；`project`、`repo`（必须是绝对路径）、`base`（提交写法）、`taskId`（`TASK-数字`）、`spec`（不含 `..` 的相对路径）；
  - 选手与开关：`who` 必须是数组、1–6 位、每项符合 `选手:强度[:fast]`；`network`、`ro` 必须是真假值；
  - 时间：`created`、`updated`、`ended` 必须是能解析的时间，`updated` 不得早于 `created`；
  - 计数：`elapsedSeconds`、`sleeps` 必须有限且非负；`attemptCount`、`nodeCount` 必须是非负整数；`usage.read/cached/out` 有限非负；`usageLimit` 有限且大于 0；NaN、Infinity 在 JSON 里会变成 null，同样被挡下；
  - 进程号：`pid` 必须是整数（0 或负数算"没有合法进程号"，交给恢复流程，不当成坏记录）；`pidSince` 是 Windows 才有的出生时间，单独出现才算坏；两者类型/有限性都校验；
  - 动作：`action.token`、`action.node` 非空、`action.attempt` 是 ≥1 的整数、`action.at` 是时间、`action.jobs` 是字符串数组；
  - 节点：`nodes` 非空数组，每项 `depth` 在 0–`MAX_DEPTH`、`state` 只能是那四种、`attempts/continues/retries` 非负且 `continues ≤ 1`、`retries ≤ 1`；
  - 尝试：每项 `node/token` 非空、`attempt ≥ 1`、`at` 是时间、`outcome` 只能是 `done|failed|blocked`、`jobs` 是字符串数组；
  - 自洽：`attempts.length === attemptCount`、`nodes.length === nodeCount`；
  - 状态不变量：结束状态必须有 `ended`、没结束的不能有；结束状态不许再挂 `action`；`limit` 只许出现在 `needs_owner` 且必须是四项预算之一；`needs_owner`、`stopped` 必须有原因，`reason` 有就必须是 ≤500 字的非空文字。

  写入口也加了同一套校验（`updateAutopilot` 写盘前用 `JSON.parse(JSON.stringify(run))` 再跑一次 `assertRun`）：坏记录、被改宽的预算、NaN 都进不了盘。读取时一个字段都不"顺手修好"，也不拿当前设置覆盖旧快照——`读取登记照原样读回，不按现在的设置偷偷修旧快照` 用"当年开着联网、只读、两位选手"的旧登记证明读回来一字不差。

  测试：`被改过或被写坏的登记一律失败关闭：策略、编号、布尔、计数、动作、节点、进程号、用量` 覆盖 43 种篡改（三项预算数字被改宽、策略换成自造的、编号与目录不一致、`who` 非数组/超量/写法坏、`network`/`ro` 非布尔、创建时间不是时间、更新时间早于创建、没结束却写了结束时间、`stopped`/`needs_owner` 缺原因、运行时长 NaN/Infinity/负数、休眠负数、尝试次数负数/非整数/与记录不符、节点数与记录不符、用量负数/NaN、用量上限 0、进程号是字符串、只有启动时间没有进程号、动作令牌空/序号 0/时间坏/任务号非数组、节点非数组/深度超限/状态不认识/续做或重试超限、尝试结局或令牌坏、结束状态挂动作、预算标记位置不对、版本不认识、起点提交不像提交），每条都断言报出针对该字段的中文原因，并断言 `listAutopilots` 把 43 条全列进 `broken`、正常那台照样出现；另有一条断言写入口本身拒绝把 `policy.minutes` 改成 9999。

- **3. 活跃登记缺 PID 时无法恢复**

  原来 `reconcileAutopilot` 遇到"活跃状态但没有合法 PID"直接原样返回，创建后没叫起来、或 spawn 失败，就会永久卡在 `planning`。

  现在统一走 `markLost`：只要状态还在走、而推进器不是"活着且出生时间也对得上"（`engineAlive`：进程号必须是正整数、进程必须还在、Windows 上出生时间还必须一致，对不上就当进程号被复用），就原子地转成 `recovering`、清掉无效的 `pid/pidSince`、写明"推进进程不在了，下一次启动会从登记文件接着走"；已经结束的（`completed`/`needs_owner`/`stopped`）一个字都不动。`engineAlive` 里出生时间自己再核一遍——macOS 的 `alive()` 不管 `since`，只按号判。`startAutopilot` 在 spawn 失败时也显式把登记记成 `recovering` 并清 pid，不留"活跃但没有推进器"的半截状态；推进器自己走完时会把属于自己的 pid 清掉。

  顺带修了两处会被这条路径引爆的问题：① `settle` 在 `recovering` 状态下收到结果时会先 `resume`（`recovering → executing`）再记账，否则状态机拒绝、结果白丢；② 所有节点都已有结论却没有新动作可做时，`takeAction` 转 `needs_owner`（"没有可继续的节点了"），`runAutopilot` 把 `idle` 也当"歇一轮"，不会再空转（此前这种情形会让推进器热循环）。

  测试：`登记建好但还没叫推进器就崩了：只读列表认成等恢复，不永久卡在准备中`、`叫不起来推进器（spawn 失败）：登记记成等恢复，不留"活跃但没有推进器"的半截状态`（注入会失败的 `launch`，断言抛错后登记是 `recovering`、无 pid，并且能接着走到 `needs_owner`）、`进程号非法、进程已经死了都算推进器丢失；活着且对得上的不受影响；结束状态不动`（pid 0、pid 负数、pid 是已杀进程、Windows 上出生时间对不上 → 都转 `recovering` 并清 pid；`pid = 自己` 且出生时间一致 → 保持 `executing`、pid 不动；`stopped`、`needs_owner` 不被改成 `recovering`）、`等恢复的登记再启动：沿用原动作令牌和已有证据，不重复派活`（令牌 `token-r` 原样保留，重启后按证据认领 `job-42`、零次新派活、走完转 `needs_owner`、pid 清空）。

- **测试结果（在 `.worktrees/task-009` 里跑）**
  - `npm run typecheck`：通过。
  - `node --test --test-timeout=120000 test/task-plan.test.ts test/plan-dispatch.test.ts test/autopilot-record.test.ts test/autopilot-engine.test.ts`：**56/56 通过**（task-plan 26、plan-dispatch 4、autopilot-record 12、autopilot-engine 14；上一轮是 48 项）。
  - `npm run test:ui`：34 个文件、312 项全通过。
  - `npm run build`：通过。
  - `git diff --check`：干净（没有空白错误）。
  - 另跑全量 `npm test`：**837/849 通过**，失败的只有 `test/quota.test.ts` 里两条伪终端桥用例（隔离里开不出 pty，从基线起就一样），其余全过；其中也包含仓库的"核心源代码不使用显式 any"约定检查。
  - 补记：校验代码第一版用了 `Record<string, any>`，被 `test/architecture.test.ts` 的约定检查抓到，已改成 `Record<string, unknown>` + 局部收窄，一个显式 `any` 都不留（这台机器的 TypeScript 是 7.x，控制流不会因为"调用一个不返回的函数"就收窄，所以校验里的 `bad(...)` 一律写成 `throw bad(...)`）。
  - 反向验证：临时拆掉全局锁，`同一任务并发启动` 那条用例立刻失败（"三个并发启动只能成一个"），确认新用例真能抓到原来的竞态；验证完已还原。

- **未完成项与风险**
  - 校验严格化的代价：`run.json` 只要有一处不自洽就整条读不出来（会出现在 `list` 的 broken 列表里），得由主人从备份恢复或删掉重建——这是评审要求的"失败关闭"，但真实使用时主人会看到"等恢复/坏了"而不是自动修好。
  - 损坏登记目前不参与"同一任务只能有一台"的判断（`createAutopilot` 只看读得出来的登记）。一台登记坏掉之后，同一任务可以再启一台；因为坏的那台已经推不动外部动作，这里接受这个取舍并在此写明。
  - 仍然没接自动审查、验收与细拆（TASK-009 范围之外），一次尝试做完会转 `needs_owner` 交主人。
  - `usageLimit` 还只有登记层支持；子节点 DAG 仍只有根节点。
  - `npm run test:e2e` 没跑（隔离里开不了窗口，本任务无界面改动）。

- **diff 摘要（本轮，相对上一轮快照；仍是未提交状态）**
  - `src/core/autopilot.ts`：358 → 481 行。新增 `registryLockDir`、`assertRun`（`parseRun` 变薄别名）、`isText/isWhen/isNumber/isCount/isIds/isRelative` 校验小件；`createAutopilot` 改成"一把全局锁里扫描 → 查重 → 分配编号 → 建目录写登记"；`updateAutopilot` 写盘前再校验一次。
  - `src/core/autopilot-engine.ts`：306 → 349 行。新增 `inProcess` 进程内互斥、`engineAlive`、`markLost`；`reconcileAutopilot` 改为"活跃但推进器不可信就转 `recovering`"；`startAutopilot` 增加 `launch` 注入口并在失败时记 `recovering`；`settle` 支持从 `recovering` 续上；`takeAction` 没有可继续节点时转 `needs_owner`；`runAutopilot` 退出时清自己的 pid、`idle` 不热循环。
  - `test/autopilot-record.test.ts`：262 → 396 行。新增并发启动、43 项损坏登记、读回不改快照三条用例；收尾改用 `retire` 替身（结束状态带时间与原因）。
  - `test/autopilot-engine.test.ts`：289 → 416 行。新增未启动即恢复、spawn 失败、进程号非法/已死/对不上/活着的对照、等恢复续跑沿用令牌、进程内互斥五条用例。
  - 其它文件（`job.ts`、`dispatch.ts`、`plan-dispatch.ts`、`wake.ts`、`cli.ts`）本轮没动；没有整份覆盖主工作区，也没有提交、push、合并。
  - 未提交、未 push；提交与合并留给负责人。

### 2026-10-18 第三轮修复（Codex 二轮复审的两条阻断）

二轮复审的两条阻断都修了，仍在 worktree `feat/task-009-autopilot`：没提交、没 push、没合并，主工作区没动，没加依赖。

- **阻断 1：受控的 `autopilot resume <编号>` 入口**

  原来 `start` 永远 create，`recovering` 又算活跃被查重挡住，主人手上没有能照着敲的命令，等于恢复入口不可达。

  现在加了 `resumeAutopilot(id, { launch })` 和命令行 `xagents autopilot resume <编号>`：

  - **只接编号**，别的选项一个都不接；读的就是原登记，任务、任务说明、选手、只读/联网快照、策略预算、动作令牌、尝试记录一律原样保留，只是把推进器重新叫起来，不新建登记（所以不可能另起一台）；
  - **拒绝**已经收尾的（"已经停在「等主人」，不用恢复；要重来请用 xagents autopilot start 另开一台"）、找不到的、读不出来的（坏的登记照旧失败关闭）、以及推进器还活着的（"推进器已经在跑（进程号 X），不用恢复"）；
  - **提示全改成能照着敲的**：`status`/`list` 里推进器掉了的说法是"推进进程不在，运行 xagents autopilot resume <编号> 接着走"；`start` 叫不起推进器时的报错直接写"登记 <编号> 已经留好，用 xagents autopilot resume <编号> 接着起来"；`--help` 里有这一行，`start` 成功后的提示也补了这一句。中文状态名收到核心里一份（`stateNames`），命令行不再自己写一遍。

  测试：`受控恢复：只接编号，任务、选手、权限、预算和动作令牌一个字都不改，也不另建一台`（恢复后接着跑，用原来的令牌认领 `job-keep`、零次重派）、`受控恢复拒绝：结束的、找不到的、坏的、推进器还活着的都不许起`、`命令行恢复链路：推进器没起来的登记用 resume <编号> 接着走，不另建一台、不改原预算令牌`（**真走命令行**：`status`/`list` 提示里有可执行命令 → `xagents autopilot resume <编号>` → 真起后台推进器进程 → 等到登记走到 `needs_owner`；断言还是同一个编号、没有第二台、`policy` 还是 standard、选手和创建时间没变；再 resume 一次被拒）、`推进器没能启动时，start 的报错直接给出可以照敲的 resume 命令`、`命令行骨架` 里补了 resume 的缺参数与 `--help` 检查。

- **阻断 2：动作锁保护证据检查、派发与任务号登记**

  原来 `takeAction` 落盘令牌后到写回任务号之间没有互斥，另一轮 `step` 走进 `recover` 查不到证据就再派一次；进程内 Set 挡不住第二个推进器进程。复审留的那条失败用例实测派了 2 次。

  现在每台执行有一把**跨进程动作锁**（`actionLockDir` = `<登记目录>/.action`，用 `fsx.withLock`：属主进程号 + 令牌、属主死了会被回收）：

  - `stepAutopilot` 的整段"**锁内重读权威登记 → 复核状态与令牌 → 查证据 → 真的派出去 → 写回任务号**"都在锁里，锁外看到的东西不算数；后进来的那一步先看到前一步写好的任务号，于是只认领、不重派；
  - `startAction` 动手前在锁里再复核一遍：已经收尾就一件都不派，令牌被顶掉就退让，时长或用量到线就转 `needs_owner`（只看时长和用量，因为尝试数、节点数是这一步刚记的，不能拿"刚记的数"把最后一次机会吃掉——新加的 `dispatchBudget`）；
  - **执行权也在锁内领**：`runAutopilot` 不再"先读 pid 再写 pid"，而是同一次登记锁改写里"看有没有活的推进器 + 把 pid 写成自己"，两个进程同时起来也只有一个拿到这台执行；
  - **停止与预算收尾不许旧动作继续派活**：`stopAutopilot` 先拿动作锁再停推进器，所以正在派活的那一步要么已经把任务号写回来（随后被停掉），要么在锁里发现"收了"而根本不派；`stop` 和预算收尾都会按令牌把"派出去了但还没记上号"的活认领出来一起停掉，不留残留在外面的活。

  测试（新增 7 条，其中 3 条在旧写法下真的会红）：
  - `评审回归：派发尚未写回任务号时，并发恢复不能重复启动同一动作`（复审留的那条，现在只派 1 次）；
  - `已有动作的并发恢复：两个推进器抢同一个动作，只认领一次、一件活都不重派`；
  - `两个真实进程抢同一台执行：锁在跨进程上生效，只派一次活`（两个真子进程各自 `stepAutopilot`，各自把派活记到同一个日志文件；断言日志只有一行 `token-x`、登记里只写回一次任务号）；
  - `跨进程领执行权：两个真进程同时起来，只有一个拿到这台执行，另一个当场退出`（另一个打印"推进进程已经在跑"，登记里的 pid 必须是真正拿到执行权的那个）；
  - `停止与派发撞在一起：停止等动作锁，刚派出去的那件活照样被停掉，之后旧令牌不许再派`、`预算到线时，按令牌把已经派出去但还没记号的活认领出来停掉，一件新的都不派`。

  反向验证（都验完就还原了）：把 `stepAutopilot` 里的动作锁临时拆掉，`评审回归`、`停止与派发撞在一起`、`两个真实进程抢同一台执行` 三条立刻变红；把执行权领取临时改回"先读再写"，`跨进程领执行权` 5 次里红 4 次（旧写法本身靠时序，偶尔能侥幸）。

- **测试结果（在 `.worktrees/task-009` 里跑）**
  - `npm run typecheck`：通过。
  - `node --test --test-timeout=120000 test/task-plan.test.ts test/plan-dispatch.test.ts test/autopilot-record.test.ts test/autopilot-engine.test.ts`：**66/66 通过**（上一轮 56 项；其中 autopilot-record 14 项、autopilot-engine 22 项）。
  - `npm run test:ui`：34 个文件、312 项全通过。
  - `npm run build`：通过。`git diff --check`：干净。
  - 另跑全量 `npm test`：**847/859 通过**，只剩 `test/quota.test.ts` 里两条伪终端桥用例失败（隔离里开不出 pty，从基线起就一样）。

- **未完成项与风险**
  - 动作锁让同一个任务的派活真正串行：两个推进器同时来，后一个要等前一个派完（等一次派活的时间）。这是要的行为，但如果一次派活特别久，排在后面的 `step` 会等到 120 秒上限才报"等待文件锁超过"。
  - `stop` 现在会先等动作锁；推进器正好在派活时，停止会等这一步落盘（随后把派出去的活停掉），不会立刻返回。
  - 损坏的登记仍不参与"同一任务只能有一台"的查重（坏的那台推不动外部动作）；`usageLimit`、子节点 DAG、自动审查/验收仍不在本任务范围。
  - `npm run test:e2e` 没跑（隔离里开不了窗口，本任务无界面改动）。

- **diff 摘要（本轮，仍是未提交状态）**
  - `src/core/autopilot.ts`：481 → 499 行。新增 `stateNames`（中文状态名，命令行共用）、`actionLockDir`（跨进程动作锁目录）、`dispatchBudget`（动手前只看时长与用量的预算复核）。
  - `src/core/autopilot-engine.ts`：349 → 422 行。`stepAutopilot` 整段进动作锁并锁内重读；新增 `exhaust`（预算收尾时按令牌认领并停掉外面的活）；`startAction` 动手前复核收尾/令牌/预算；`recover` 锁内重跑并区分"别人刚收尾"；`runAutopilot` 执行权在登记锁内领取；`launchAutopilotEngine` 返回是否真起了进程；新增 `resumeAutopilot`；`stopAutopilot` 先拿动作锁并把没记号的活认领出来停掉。
  - `src/cli/autopilot.ts`：新增 `autopilotResume`（打印保留的任务/选手/策略/权限/用量/原令牌），`progress()` 等提示改成可执行命令，状态名改从核心取。
  - `src/cli/cli.ts`：`autopilot resume <编号>` 分支、帮助一行、未知子命令提示加上 resume。
  - `test/autopilot-record.test.ts`：396 → 453 行，新增 2 条（命令行恢复链路、start 失败提示），`命令行骨架` 补 resume 检查。
  - `test/autopilot-engine.test.ts`：416 → 636 行，新增 7 条（已有动作并发恢复、停止与派发撞车、受控恢复、受控恢复拒绝、跨进程抢同一台执行、跨进程领执行权、预算到线认领）。
  - 上一轮的文件（`dispatch.ts`、`job.ts`、`plan-dispatch.ts`、`wake.ts`）本轮没动，也没有整份覆盖主工作区。

## 评审记录

### 2026-10-18 Codex 三轮复审：`PASSED_WITH_NOTES`

- 两项二轮阻断均已关闭：增加只接编号的 CLI resume 入口，恢复沿用原登记与动作令牌；跨进程动作锁覆盖权威重读、证据查找、外部派发和任务号回写，推进器执行权也在登记锁内领取。停止与预算收尾能按令牌认领未写回任务号的活再停止。
- 本轮在 task-009 worktree 复跑类型检查、指定核心测试 **66/66**、UI **312/312** 和构建，全部通过；包含上轮失败回归、CLI 真进程恢复、跨进程争抢和停止竞争测试。
- 代码已按任务增量整合至 `codex/custom-requirements`；未覆盖 TASK-007/008 的共享文件新修复，也保留了目标分支新增的通知与派活参考规划。目标分支全量验收结果与 Git 提交记录见 docs/review-task-003-009-integration-2026-10-18.md。
- 非阻断注记：当前仍是有界执行骨架，一次执行后交 needs_owner；自动诊断/审查/细拆由后续任务完成。动作锁等待上限 120 秒，停止可能等待正在进行的派发落盘。已知用量阈值与子节点扩展仍按原范围留给后续。
- 优先级复核：TASK-009 记为 PASSED；TASK-003 同步记为 PASSED（保留视觉验收注记）；TASK-010 的前置条件满足，DRAFT → READY，优先级仍 P1 High。TASK-011～016 的前置关系与优先级不变，TASK-015 仍为 P2 READY。已复核，无优先级调整。

### 2026-10-18 Codex 二轮复审：`CHANGES_REQUESTED`

- 原三项修正已确认：登记创建在全局锁中查重并落盘；固定预算数值及记录字段增加校验；缺失/死亡 PID 与 spawn 失败可记录为 recovering。本轮复跑类型检查和原指定核心测试 **56/56 通过**。
- 阻断 1（恢复入口仍不可达）：`src/cli/cli.ts` 仅有 start/status/list/stop；status/list 只标记 recovering，start 始终 create，因 recovering 仍属活跃而被同任务查重拒绝。用户没有命令恢复原登记。现有恢复测试直接调用 runAutopilot，未覆盖真实入口。增加受控 `autopilot resume <编号>`（或等价、明确且经过测试的已有登记恢复入口）：只接编号，读取并保留原任务、选手/权限/预算/动作令牌，结束或损坏记录拒绝；仍活着的推进器不能重复启动；帮助与提示给出可实际执行的命令。新增 CLI/核心入口测试，验证 create→launch 崩溃或 spawn 失败后能通过入口恢复原编号，不能另建一台。
- 阻断 2（动作令牌尚不能排他保护外部派发）：takeAction 落盘 action 后到 start 返回任务号之间，另一轮 step 进入 recover，find 还查不到记录，于是再次 startAction；两次调用使用同一个 token，回写时比 token 不能撤销已经发生的两次外部副作用。复审新增 `test/autopilot-engine.test.ts` 的“评审回归：派发尚未写回任务号时，并发恢复不能重复启动同一动作”，第一轮 start 挂起时执行第二轮 step，实测 start 被调用 **2 次而非 1 次**。保留该失败用例供修复。应使用跨进程的执行权/动作锁，把权威状态与令牌复核、证据检查、实际发起及任务号登记串起来；不得仅用进程内 Set。runAutopilot 的存活 PID 检查也须在取得执行权的锁内复核，当前先读后锁写 PID 仍有竞争窗口。补已有 action 的并发恢复与两个真实进程争抢的回归；停止与预算收尾不得让过期动作随后继续派活。
- 修复范围保持 TASK-009；TASK-003 先前通过结论保留。本轮未合并、未提交、未 push。三个 worktree 的分支仍同指 1895958，所有实现未提交；修复通过后由负责人抽取任务增量整合至 codex/custom-requirements，并保留 TASK-007/008 的最新共享文件修改。
- 验证：类型检查；原指定四个核心文件（含本轮新增失败回归）；CLI 恢复端到端与跨进程并发回归；UI；构建；git diff --check。通过后补实施报告再复审。
- 优先级复核：TASK-009 保持 P1 High CHANGES_REQUESTED；TASK-010 继续 DRAFT，TASK-003 保持先前带注通过；其他相关任务优先级无调整。

### 2026-10-18 Codex 首轮复审：`CHANGES_REQUESTED`

- 已确认指定验证全部通过：类型检查通过，任务规划/派发/自治登记/推进器 **48/48**，构建通过；动作令牌、两个崩溃窗口、预算停机和真实后台进程停止均有自动化覆盖。
- 阻断 1：`createAutopilot` 在全局锁之外先 `listAutopilots()` 查重，再分别 `reserveAutopilot()`。两个同时启动同一项目/Task 的请求都可能先看到“没有运行”，随后各自保留不同目录并各启动一台，违反同一任务不能重复推进的约束。应在共享的自治登记锁内完成“扫描活跃同任务 → 保留编号 → 写初始 run.json”，并新增真正并发的 `Promise.allSettled` 测试，断言只成功一个且只留下一个活跃登记。
- 阻断 2：`parseRun` 只验证策略 ID，不验证 `minutes/attempts/nodes` 是否精确等于对应预设；手改后的 `{ id: 'standard', minutes: 999999, ... }` 会被当作合法登记继续推进，绕过“只接受三个预设、旧记录或损坏记录失败关闭”。同样需要严格验证 run.id 与目录 ID、who/布尔值、计数、节点/尝试/action/pid/usage 等运行时形状与有限值，至少保证所有影响安全边界和预算的字段不能靠改 JSON 放宽。补充损坏策略和关键字段的失败关闭测试。
- 阻断 3：`reconcileAutopilot` 对活跃状态但缺少 `pid` 的登记直接返回。创建登记后、启动推进器前崩溃，或 spawn 失败时，会留下永久处于 `planning` 的记录；`status/list` 不会标为 `recovering`，再次启动也没有受控恢复入口。应把“活跃且没有合法 pid”视为丢失推进器并转 `recovering`，同时覆盖 create→launch 崩溃窗口及 spawn 失败后的恢复测试。
- 集成要求：修复必须基于当前 TASK-007/TASK-008 结果重放 `dispatch.ts`、`job.ts`、`plan-dispatch.ts`、`wake.ts` 的小块改动，禁止用本 worktree 的整文件覆盖主工作区；指定验证通过后再复审。
- 优先级复核：保持 `P1 High`，状态改为 `CHANGES_REQUESTED`；TASK-010 继续等待。已复核，无调整。

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
