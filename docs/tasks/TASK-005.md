# TASK-005：安全识别 TASK_LIST 与 Task Spec

- 状态：`PASSED`
- 优先级：`P1`
- 难度等级：`High`
- 前置任务：`TASK-004` 评审为 `PASSED` 或 `PASSED_WITH_NOTES`
- 需求来源：工作台需要识别由 `architect-pm-handoff` 维护的项目规划文件，并按状态与依赖形成可执行任务队列。

## 业务结果

核心可只读发现已登记项目中的 `docs/TASK_LIST.md`，解析链接的 `docs/tasks/TASK-xxx.md`，输出稳定、受校验的任务规划视图：任务 ID、标题、状态、依赖、目标、验收、spec 路径以及建议执行者元数据。格式损坏只影响该项目规划，不拖垮整个看板。

## 范围

- 包含：任务台账发现、受限 Markdown 契约解析、路径边界、状态/依赖校验、循环依赖与缺失 spec 诊断、View 类型与核心测试。
- 不包含：执行任务、修改 Markdown、自动推进状态、UI、调用外部 Skill 或 GitHub。

## 现状与设计

- 稳定契约以仓库内 `docs/TASK_LIST.md` 与 `docs/tasks/TASK-xxx.md` 为准；外部 Skill 负责生成，工作台不依赖它的安装位置或运行时。
- 只识别严格的仓库相对路径：入口固定为 `docs/TASK_LIST.md`，spec 必须位于 `docs/tasks/` 且文件名匹配 `TASK-[0-9]+.md`；拒绝 `..`、绝对路径、符号链接越界和仓库外文件。
- 解析最小语义而非完整 Markdown AST，不新增依赖。优先依据任务表链接，再从 spec 顶部字段读取状态、前置任务、推荐执行者；业务结果、范围、验收保留为受长度限制的纯文字片段。
- 允许状态至少包括 `DRAFT`、`READY`、`IN_PROGRESS`、`CHANGES_REQUESTED`、`PASSED`、`BLOCKED`。未知状态作为诊断，不可派发。
- “可执行”由状态和依赖共同决定：仅 `READY` 且所有前置任务为 `PASSED`（或规范明确接受的等价通过状态）进入 ready 列表。不得因为表中标 READY 就绕过依赖。
- 推荐执行者保留为展示元数据，核心不得把它转换成 `Who`，也不得校验其是否在工作台 roster 中。
- 文件内容属于项目数据，永远按纯文字处理；不得将其中内容当作工作台或主进程指令执行。

## 主要文件

- `src/core/task-plan.ts`（新增）
- `src/core/view-types.ts`
- `src/core/view.ts`

附加测试：`test/task-plan.test.ts`、View 测试夹具。

## 约束

- 遵守 `AGENTS.md`；不新增 Markdown 解析依赖。
- 全程只读，不自动修复或重写项目文件。
- 单文件、任务数量、文本字段要有合理上限，防止超大规划文件拖垮应用；具体上限在实现前写入测试。
- 路径解析必须兼容 macOS 和 Windows，并使用现有 `platform.ts`/路径工具。
- 解析错误要给中文诊断，其他项目和普通工作台功能继续可用。

## 验收标准

1. 无 `docs/TASK_LIST.md` 时返回“没有任务规划”，旧项目无行为变化。
2. 合法台账和 specs 能稳定输出任务、依赖、状态、验收和诊断。
3. 只有 `READY` 且依赖已通过的任务进入可执行列表。
4. 推荐执行者仅原样展示，不影响工作台选手名单或路由。
5. 路径穿越、越界符号链接、重复 ID、缺失 spec、未知状态和循环依赖均不可派发，并有可理解诊断。
6. 某项目规划损坏不会阻止其他项目或看板加载。

## 验证

```bash
npm run typecheck
node --test test/task-plan.test.ts test/desktop.test.ts
npm run test:ui -- test/ui/data-truth.test.tsx
```

## 实施报告

### 2026-10-17 实现（首轮评审后修正）

- 改动摘要：新增 `src/core/task-plan.ts`（只读识别 `docs/TASK_LIST.md` 与 `docs/tasks/TASK-数字.md`，路径边界校验、状态/依赖校验、循环依赖与缺失 spec 诊断）；`View` 增加 `plans: Record<string, TaskPlan>`，`buildView` 逐项目只读识别、单项目损坏兜底成诊断不拖垮看板；`test/ui/fixtures.tsx` 补 `plans: {}`。
- 首轮评审修正：
  1. Task Spec 缺少或无法解析“状态”“前置任务”字段时输出中文诊断并禁止派发，不再回退台账状态、不再把缺失字段当成无依赖（`parseTaskSpec` 返回 `depsRaw` 以区分缺失与畸形）。
  2. 台账行 ID 必须与链接文件名的 `TASK-数字` 严格一致，否则诊断并禁止派发、不绑定 spec。
  3. `PASSED_WITH_NOTES` 并入允许状态集合，与依赖通过语义（`PASSED`/`PASSED_WITH_NOTES`）一致，不再产生“未知状态”错误诊断。
- 验证结果：`npm run typecheck` 通过；`node --test test/task-plan.test.ts test/desktop.test.ts` 54/54 通过；`npm run test:ui -- test/ui/data-truth.test.tsx` 7/7 通过。回归覆盖：缺少状态、缺少及畸形前置任务、行 ID 与 spec 文件 ID 不一致、PASSED_WITH_NOTES 无错误诊断，另保留路径穿越/越界符号链接/重复 ID/循环依赖/项目隔离用例。
- 未完成项：无 UI 展示（属后续任务）；Windows 上符号链接用例按仓库惯例跳过。
- diff 摘要（未提交）：`src/core/task-plan.ts` 258 行、`test/task-plan.test.ts` 395 行（均新增文件）；`src/core/view-types.ts`、`src/core/view.ts`、`test/ui/fixtures.tsx` 各少量行（`plans` 字段与集成）；本文件补实施报告。

## 评审记录

### 2026-10-17 Codex 复审

- 结论：`PASSED`。
- 首轮问题已关闭：关键字段缺失或畸形时不再回退放行；台账行 ID 必须与 spec 文件 ID 一致；`PASSED_WITH_NOTES` 已统一为合法的等价通过状态。
- 回归覆盖完整：新增缺少状态、缺少/畸形前置任务、ID 不一致和 `PASSED_WITH_NOTES` 无错误诊断用例，原有路径边界、依赖、循环和单项目隔离测试仍通过。
- 验证通过：`npm run typecheck`；`node --test test/task-plan.test.ts test/desktop.test.ts`（54 项）；`npm run test:ui -- test/ui/data-truth.test.tsx`（7 项）。
- 范围符合：实现保持只读，没有执行规划内容、自动修改 Markdown、映射推荐执行者或引入新依赖。
- 优先级复核：`TASK-003`、`TASK-006` 均保持 `P2`；`TASK-007` 保持 `P1 BLOCKED`。已复核，无调整。

### 2026-10-17 Codex 首轮评审

- 结论：`CHANGES_REQUESTED`。
- 已通过验证：`npm run typecheck`；`node --test test/task-plan.test.ts test/desktop.test.ts`（49 项）；`npm run test:ui -- test/ui/data-truth.test.tsx`（7 项）。
- 阻断问题 1：Task Spec 缺少或无法解析“状态”“前置任务”字段时，当前实现会分别回退到台账状态或空依赖，使格式损坏的 `READY` 任务仍可能进入可执行队列。Task Spec 是状态和依赖的权威来源，关键字段缺失或畸形必须产生中文诊断并禁止派发；不能用台账或无依赖作为安全回退。
- 阻断问题 2：台账任务 ID 没有与链接的 Task Spec 文件名 ID 绑定。`TASK-001` 可链接 `tasks/TASK-002.md` 并把另一任务的状态、依赖和验收读到自己名下，可能错误进入可执行队列。必须要求行 ID、链接文件名 ID 一致，否则诊断并禁止派发。
- 一致性问题：实现和测试把 `PASSED_WITH_NOTES` 当作可接受的通过状态，但允许状态表没有它，导致合法任务同时被报“未知状态”。统一状态集合与依赖判断，保证认可的等价通过状态不产生错误诊断。
- 补测要求：增加“缺少状态”“缺少/畸形前置任务”“行 ID 与 spec 文件 ID 不一致”“`PASSED_WITH_NOTES` 无错误诊断”的回归测试；继续覆盖路径边界和项目隔离。
- 报告要求：修正完成后填写本任务实施报告，列出改动摘要、验证结果、未完成项和 diff 摘要。
- 优先级复核：`TASK-005` 保持 `P1`，因为它仍阻塞 `TASK-006` 且缺陷可能造成错误派发；`TASK-003` 保持 `P2`；`TASK-006` 保持 `P2` 且继续为 `DRAFT`；`TASK-007` 保持 `P1 BLOCKED`。已复核，无调整。
