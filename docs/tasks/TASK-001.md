# TASK-001 — 原生文件夹选择与安全项目登记桥

- handoff_contract: `1`
- status: `PASSED`
- priority: `P1`
- difficulty: `High`
- dependencies: `none`
- current_attempt: `none`

## 业务结果

桌面应用具备一条受控后台能力：主人通过 macOS/Windows 原生目录选择器选择 Git 仓库，后台验证并暂存这次选择；窗口只能使用这次选择产生的一次性令牌登记项目，不能伪造任意路径。登记沿用核心 `addProject`，成功后可立即进入看板和群聊项目名单。

## 范围

- 包含：原生目录选择、Git 仓库验证、建议项目名/显示名、一次性选择令牌、仅 `name`/`label` 的登记参数校验、调用 `addProject`、快速体检、看板刷新、IPC 与 preload 白名单、核心/主进程测试。
- 不包含：设置页可视化表单、编辑已有项目、删除登记、归档、完整体检、安装依赖。

## 现状与设计

- 项目登记规则已经集中在 `src/core/project.ts#addProject`，CLI 已调用它；桌面应用没有项目登记 IPC。
- `AGENTS.md` 要求窗口没有通用文件能力，桥上参数必须先检查。不要新增 `chooseFolder(): string` 后再允许窗口把路径原样传回后台。
- 新增两步专用能力：
  1. `projectChoose()`：主进程调用 Electron `dialog.showOpenDialog({ properties: ['openDirectory'] })`。取消返回 `null`；选择后先解析真实 Git 顶层目录，拒绝非 Git 目录，返回只供展示的数据和随机、短期、一次性的 `selectionId`。
  2. `projectRegister(selectionId, input)`：只接受仍有效且属于当前窗口的令牌；输入只允许 `name` 和可选 `label`，消费令牌后调用 `addProject`。成功后运行 `checkProject(name, { quick: true })`，体检失败不得回滚已完成的登记，但要作为结构化结果返回。最后发布新 `View`。
- 建议值：项目标识由仓库文件夹名规范化得到，必须满足现有 `safeName`；无法安全生成时由界面后续要求主人填写。显示名缺省用文件夹名并经过 `checkLabel`。
- 令牌只保存在主进程内存，不写盘、不暴露原始能力；窗口关闭、成功登记、重复使用或超时后失效。超时时长可选 10 分钟并用可测试的时钟/存储封装，避免后台定时器泄漏。
- `projectRegister` 的窗口输入只允许 `name`、可选 `label`。`worktreeRoot`、`setup[]`、`verify[]`、`denyReadExtra[]`、`rules` 包含路径、命令或后续文件读取能力，不得通过当前窗口桥接收；高级配置必须由后续任务另行设计受控交互，不能因为界面暂时不用就提前暴露能力。

## 主要文件

- `app/shared/ipc.ts`
- `app/preload/index.ts`
- `app/main/index.ts`（可抽一个同目录小模块承载令牌状态与参数校验）

测试、类型和少量核心导出可作为附加文件：`test/desktop.test.ts`、`test/ui/bridge.test.tsx`、`src/core/project.ts`。

## 约束

- 遵守 `AGENTS.md`；不新增依赖，不启动通用文件选择或文件读写桥。
- 窗口不能提供或覆盖仓库绝对路径；最终路径只来自原生选择结果。
- 不覆盖同名项目而不提示。若当前 `addProject` 会覆盖同名登记，应在本任务为桌面登记增加明确拒绝或需要显式确认的语义，并保持 CLI 现有行为兼容。
- 所有登记文件继续经核心原子写与锁；不要在主进程重复实现项目 JSON 格式。
- Windows 和 macOS 都使用 Electron 原生目录选择器；取消不是错误。
- 不修改无关的选手、额度、DeepSeek 或群聊逻辑。

## 验收标准

1. 选择 Git 仓库后返回建议名称、真实仓库路径（仅展示）和一次性令牌；选择非 Git 文件夹得到中文错误；取消返回 `null`。
2. 窗口无法通过 IPC 传入任意仓库路径，伪造、过期、跨窗口或重复令牌均被拒绝。
3. 合法令牌能用 `name` 和可选 `label` 登记项目并沿用核心默认配置；同名项目不会静默覆盖。窗口提交任何路径、命令、规则或额外字段都会被拒绝且不消费令牌。
4. 登记成功即发布新 View；快速体检成功或失败都有结构化结果，失败不删除登记。
5. 桥只暴露 `projectChoose`、`projectRegister` 两个专用方法，参数类型、运行时白名单与测试一致。

## 验证

```bash
npm run typecheck
node --test test/desktop.test.ts test/project.test.ts test/project-check.test.ts
npm run test:ui -- test/ui/bridge.test.tsx
```

负责人最终还需运行 `npm run verify`；真实窗口目录选择冒烟测试由负责人在非隔离环境执行。

## 实施报告

待执行者填写：改动摘要、验证结果、未完成项和 diff 摘要。

## 评审记录

### 2026-10-17：[CHANGES_REQUESTED]

- 原生选择、真实 Git 顶层解析、一次性令牌、跨窗口/过期/重放防护、同名不覆盖、快速体检和 View 刷新均已实现，相关测试通过。
- 必须修正：`ProjectRegisterInput`、`projectInput()` 和共享桥目前允许窗口提交 `worktreeRoot`、`setup`、`verify`、`denyReadExtra`、`rules`。其中命令会在后续流程执行，`rules` 会让主进程解析并在派活时读取窗口指定的文件；受损渲染层可借此获得延迟执行或文件读取能力，违反 `AGENTS.md` 的窗口安全底线。
- 修正范围：当前 IPC 只保留 `name` 与可选 `label`；删除其余字段的共享类型、白名单、转发和正向测试，增加全部路径/命令/规则字段均被拒绝且不消费令牌的测试。核心 `addProject(..., { createOnly: true })` 与 CLI 兼容行为保留。
- 验证仍按本任务“验证”章节执行。
- 优先级复核：`P1` 保持不变；该安全缺口阻止 TASK-001 通过并继续阻塞 TASK-002。难度 `High` 保持不变。

### 2026-10-17：[PASSED]

- `ProjectRegisterInput` 与 `projectInput()` 已收窄为只接受 `name` 和可选 `label`；主进程只向核心转发 `createOnly` 与可选显示名。
- `worktreeRoot`、`setup`、`verify`、`denyReadExtra`、`rules`、`repo` 和未知字段均有拒绝测试，拒绝后选择令牌仍可用于合法登记。
- 原生选择、真实 Git 顶层、一次性/短期/窗口绑定令牌、同名不覆盖、快速体检失败不回滚、View 刷新和 CLI 兼容行为保持成立。
- 负责人复跑：`npm run typecheck` 通过；指定核心测试 47 项通过；`test/ui/bridge.test.tsx` 1 项通过；`git diff --check` 通过。
- 未运行真实 Electron 窗口目录选择冒烟测试，按任务约定留给非隔离环境最终验收，不阻止本次代码评审通过。
- 实施报告仍未回填，但实际 diff、补充测试和负责人复跑结果足以覆盖验收标准。
- 优先级复核：`P1` 保持不变；通过后解除 TASK-002 的前置依赖。难度 `High` 保持不变。

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
