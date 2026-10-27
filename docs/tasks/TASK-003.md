# TASK-003 — 已登记项目的管理与高级配置

- handoff_contract: `1`
- status: `PASSED`
- priority: `P2`
- difficulty: `Medium`
- dependencies: `TASK-002[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果

主人可在“设置 → 项目”查看并维护已登记项目：打开仓库、编辑登记配置、运行快速/完整体检、归档或取消归档，以及只移除工作台登记。

## 范围

- 包含：打开仓库目录、编辑显示名与 `worktreeRoot/setup/verify/denyReadExtra/rules`、快速/完整体检、归档/取消归档、移除登记及确认、对应专用 IPC、核心原子更新和测试。
- 不包含：移动或删除仓库、删除 Git 分支/工作副本/任务历史、自动修复体检问题、自动创建群聊。

## 现状与设计

- `setProjectLabel` 和 `setArchived` 已存在；核心缺少完整配置更新与“仅移除登记”的专用操作。
- 所有变更继续走核心锁和原子写；保留既有 `check`、`baseline`，除非对应体检明确更新它们。
- “移除登记”只删除 `~/.xagents/projects/<name>.json`，不碰仓库、工作副本、任务和历史。执行前必须二次确认并写明该边界。项目存在 `queued/running` 活、仍存活的准备/选手进程，或存在 `state === open` 的群聊时拒绝移除；已结束任务和已关闭群聊只作为历史保留，不阻止移除。检查与删除必须在项目登记锁内重新确认，不能只依赖界面快照。
- 打开路径必须按已登记项目名由后台解析，不允许窗口传绝对路径。
- 完整体检沿用现有 `checkProject` 生命周期：由主进程等待核心调用，核心完成后原子写回 `check/baseline`。主进程为每个项目加内存中的进行中互斥；同一项目快速/完整体检不能重入，不同项目可以各自运行。关闭设置窗口不取消已经开始的体检，只要应用主进程仍在就继续并落盘；退出整个应用后不承诺恢复未完成体检，也不持久化“进行中”状态，重新打开只展示最后一次已经写完的结果，可由主人重新发起。

## 主要文件

- `src/core/project.ts`
- `app/main/index.ts`（可抽项目 actions 模块）
- `app/renderer/components/ProjectSettings.tsx`

附加契约、preload、规范与测试文件可随实现更新。

## 约束

- 遵守 `AGENTS.md`；不新增依赖。
- 所有路径操作从登记项目名解析，窗口不能传入任意绝对路径。
- “移除登记”必须与“删除仓库”明确区分，默认不可逆操作只影响登记文件。
- 编辑不能静默抹掉体检结果、验收基线或未知的兼容字段。
- 上述移除与体检生命周期决定已经由 Codex 补齐；执行者不得自行放宽。

## 验收标准

1. 主人可查看和编辑全部现有登记字段，非法路径或命令结构被核心拒绝。
2. 可从列表打开仓库目录，窗口不能借此打开未登记路径。
3. 快速/完整体检有明确状态与结果，不会重复启动同一项目体检。
4. 归档、取消归档与现有看板/历史行为一致。
5. 移除登记不删除仓库、任务、历史或 Git 数据，并有明确二次确认。

## 验证

```bash
npm run typecheck
node --test test/project.test.ts test/project-check.test.ts test/desktop.test.ts
npm run test:ui -- test/ui/settings-projects.test.tsx
npm run build
```

负责人最终运行 `npm run verify` 并执行真实窗口冒烟测试。

## 实施报告

2026-10-18 由 Kimi 在独立 worktree（分支 `feat/task-003-project-settings`）完成；未提交、未 push。

### 改动摘要

1. **核心**（`src/core/project.ts`）：新增 `updateProject(name, patch)`——锁内读-改-写，只改提交的字段（label / worktreeRoot / setup / verify / denyReadExtra / rules），`check`、`baseline` 和未知兼容字段原样保留；`worktreeRoot` 和 `denyReadExtra` 走 `relativePath`（拒绝绝对路径和 `..`），列表必须是文字且无空项，`rules` 为 null 时清除、否则 `realpath` 核实存在。新增 `removeProject(name)`——在**项目登记锁内重新确认**：有 `queued/running` 活、残留准备或选手进程（`stillRunning`/`alive`，含未启动完的派发进程）、或 `state === 'open'` 的群聊时拒绝（中文原因）；只删 `~/.xagents/projects/<name>.json`，不碰仓库、工作副本、任务、历史和 Git 数据。
2. **View**（`src/core/view.ts`、`view-types.ts`）：`View.projects` 升级为 `ViewProject[]`，已登记项目带 `config`（worktreeRoot/setup/verify/denyReadExtra/rules，缺省填充、坏文件不拖垮视图），给设置页编辑弹窗预填；只在任务里出现过的项目 `config` 为 null。
3. **主进程**（`app/main/project-bridge.ts`、`app/main/index.ts`）：新增 `projectManageActions`——`open`（`loadProject` 按登记名解析仓库后 `shell.openPath`，不存在报中文）、`update`（白名单 `projectPatch` + 成功后发布 View）、`remove`、`check`（**内存按项目互斥**，同一项目快速/完整体检不重入，不同项目并行；类型只认 `quick`/`full`）、`chooseRules`（系统文件选择器 + 一次性令牌：窗口永远交不进 rules 的绝对路径，伪造/过期/跨窗口/重复使用都拒绝）。完整体检由主进程等待核心 `checkProject` 跑完（核心自己原子写回 `check`/`baseline`）；关闭设置窗口不取消；退出应用不持久恢复。`app/main/index.ts` 接 5 个新通道，全部先 `guard(event)` 验来源。
4. **IPC / preload**（`app/shared/ipc.ts`、`app/preload/index.ts`）：新增 `projectOpen / projectUpdate / projectRemove / projectCheck / projectChooseRules` 通道、类型和桥方法；`ProjectUpdateInput` 的 `rules` 只收 `null`（清除）或选择令牌。
5. **UI**（`app/renderer/components/ProjectSettings.tsx`，先于 `docs/ui-spec.md` 定稿）：每个已登记项目一行加“…”菜单（`MoreMenu`）：打开仓库 / 编辑登记 / 快速体检 / 完整体检 / 归档·取消归档（走 `setSettings({ archivedProjects })` 整份替换，与看板同一套）/ 移除登记…（`ConfirmDialog` 二次确认，写明“只移除登记，不删仓库、任务、历史和任何 Git 数据”）。编辑弹窗按 `View.projects[].config` 预填全部字段；相对路径界面先校验（保存不可点），核心再校验一遍，拒绝原因中文写在弹窗里；体检结果在面板上方写通过/逐项问题清单。所有调用只传项目名。
6. **规范**（`docs/ui-spec.md`）：设置 → 项目一节补“项目行操作 / 打开仓库 / 编辑登记 / 体检 / 归档 / 移除登记”六条（2026-10-18，TASK-003）。

### 验证结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过（4 个 tsconfig 全过） |
| `node --test test/project.test.ts test/project-check.test.ts test/desktop.test.ts` | 59/59 通过 |
| `npm run test:ui -- test/ui/settings-projects.test.tsx` | 13/13 通过 |
| `npm run test:ui`（全量） | 317/317 通过 |
| `npm run build` | 通过 |

补充：`npm test` 全量 830 件，失败 20 件，与主工作区基线（823 件、同样 20 件失败）逐项对比**完全一致**——均为本机环境固有问题（`process.execPath` 是 Kimi Helper 而非真 Node，凡真实派生进程的用例如“派发进程准备期间被杀”“caffeinate”“伪终端桥”等在本机必然失败），与 TASK-003 无关。新增 7 件核心测试（updateProject×2、removeProject、管理桥×4）全部通过。

未执行：真实窗口冒烟测试（`npm run test:e2e`）按 AGENTS.md 交给负责人验收；浅色/深色/窄窗口截图检查依赖冒烟测试，同样未在隔离里跑。

### 未完成项和风险

- 移除前只检查“本项目”的任务记录与群聊；登记文件损坏（JSON 语法错）时 `removeProject` 报读不出，需主人手动处理（行为与现有 `loadProject` 一致）。
- 完整体检进行中退出应用：按 Spec 不承诺恢复，重新打开设置只展示最后一次写完的结果。
- `updateProject` 的 `rules` 选择令牌与登记令牌同样只在主进程内存放 10 分钟。

### diff 摘要

基线提交 1895958 之后 worktree 里还包含 TASK-001/002/004/005/006/008 的未提交成果，故 `git diff --stat`（93 文件、+2091/−300）不是 TASK-003 一家之数。TASK-003 本会话实际改动：`src/core/project.ts` +96、`src/core/view.ts` +37、`src/core/view-types.ts` +17、`app/shared/ipc.ts` +53、`app/preload/index.ts` +11、`app/main/index.ts` +138、`app/main/project-bridge.ts` +270（新文件，含 TASK-001/002 已有的 151 行）、`app/renderer/components/ProjectSettings.tsx` 88→约 340 行（TASK-002 已有 88 行）、`docs/ui-spec.md` +50；测试 `test/project.test.ts` +120、`test/desktop.test.ts` +110（管理桥 4 件 + buildView 期望）、`test/ui/settings-projects.test.tsx` 新增 5 件管理交互（8→13），另有 `fixtures.tsx`、`bridge.test.tsx`、`history.test.tsx`、`chat.test.tsx`、`dashboard.test.tsx`、`project-plan.test.tsx`、`lifecycle.test.ts` 补 `ViewProject` 新字段期望。关键实现位置：`src/core/project.ts` 的 `updateProject`/`removeProject`，`app/main/project-bridge.ts` 的 `projectManageActions`/`fileSelections`/`projectPatch`，`app/renderer/components/ProjectSettings.tsx` 的 `EditDialog`。

## 评审记录

### 2026-10-18 Codex 集成复核：`PASSED_WITH_NOTES`

- 实现按增量整合至 codex/custom-requirements，保留了目标分支较新的 Cursor 群聊与执行预算代码。59 项核心/桥测试及 13 项项目设置 UI 已于首轮复跑通过；本轮合并后 UI 共 317 项通过，构建与真实窗口通用冒烟通过。
- 新项目编辑弹窗专属的浅/深色及窄窗口截图检查仍保留为非阻断注记；既有窗口冒烟不等同于该专属视觉检查。
- 状态统一记为 PASSED，验收注记保留在评审记录中；优先级 P2 Medium 无调整。

### 2026-10-18 Codex 复审：`PASSED_WITH_NOTES`

- 核心更新保留 `check`、`baseline` 和未知字段；移除登记在项目锁内重新核对活跃任务、残留进程与开放群聊，只删除登记文件；打开仓库和规则文件均通过专用桥按登记名或一次性令牌解析。
- 本轮复跑：类型检查通过；核心/桌面验收 **59/59**；设置项目 UI **13/13**；构建通过。未执行真实 Electron 窗口的浅色、深色和窄窗口冒烟，因此带注通过。
- 集成注记：本 worktree 没有任务提交，分支仍与共同基点相同；合并时必须抽取 TASK-003 专属增量，不能整文件覆盖主工作区较新的 TASK-007 修正。
- 优先级复核：状态改为 `PASSED_WITH_NOTES`，优先级保持 `P2`。已复核，无调整。

### 2026-10-18 Codex 执行前补全

- 已解决原 Spec 的两个待确认：活跃任务、残留进程或开放群聊引用时拒绝移除登记；结束任务和关闭群聊不阻止。完整体检由主进程等待并按项目互斥，关闭设置窗口不取消，退出应用不做持久恢复。
- `TASK-003` 保持 `P2 Medium READY`，前置 TASK-002 已通过。该任务可与 TASK-007、TASK-009 在独立工作副本中并行，但不得在同一未提交工作区同时修改。
- 优先级复核：已复核，无调整。

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
