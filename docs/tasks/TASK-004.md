# TASK-004：负责人规则接入项目任务台账

- 状态：`PASSED`
- 优先级：`P1`
- 难度等级：`Low`
- 前置任务：无
- 需求来源：主人正在使用 `architect-pm-handoff` 维护 `docs/TASK_LIST.md` 和 `docs/tasks/TASK-xxx.md`，希望负责人和工作台以这些文件为规划来源，但不按其中的推荐执行者绑定选手。

## 业务结果

接入派活工作台的负责人 AI 在开工和续接前，除了读取 `xagents guide`，还会在已登记项目中识别任务台账；存在 `docs/TASK_LIST.md` 时，以它和链接的 Task Spec 作为任务范围、顺序、状态与验收标准的来源。任务里的“推荐执行者”只供原规划流程参考，不决定工作台派给哪位选手。

## 范围

- 包含：更新负责人常驻规则、首次对接说明和指挥手册对应说明；补充规则测试与文档。
- 不包含：解析 Markdown、桌面展示、自动派发、修改任务状态、实现 `architect-pm-handoff` 本身。

## 现状与设计

- 当前唯一负责人常驻规则在 `src/core/intro.ts#LEAD_RULE`，只要求使用 `xagents` 并先读 `xagents guide`。
- 新规则保持简短，只增加一条条件约定：在当前已登记项目根目录发现 `docs/TASK_LIST.md` 时，先读取它和当前任务链接的 spec；只处理状态允许且依赖满足的任务；范围、约束和验收以 spec 为准。
- 明确职责边界：
  - `architect-pm-handoff` / 负责人：形成计划、维护状态、评审、推进下一任务。
  - 派活工作台：隔离、派发、看管、记录和额度控制。
  - Task Spec 中的“推荐执行者”或类似字段：不作为工作台路由指令；负责人应根据工作台当前可用选手、主人设置、额度与任务性质选择选手。
- 负责人不能因为台账存在就自动执行全部任务；只执行主人明确要求或当前负责人已获授权推进的任务。
- `LEAD_RULE` 仍需足够短，避免每次会话占用大量上下文；详细说明放入 `xagents guide` 的既有指挥手册来源，而不是把工作流全文复制进常驻规则。

## 主要文件

- `src/core/intro.ts`
- `src/core/guide.ts`

附加测试：`test/connect.test.ts`、`test/guide.test.ts` 或现有对应测试文件。

## 约束

- 遵守 `AGENTS.md`；不新增依赖。
- 不把外部 Skill 的完整内容复制进仓库，只定义双方稳定的文件契约。
- 不写死只有 Codex、Cursor 或 Kimi 能执行；工作台选手名单仍以 `src/core/roster.ts` 和主人设置为准。
- 不根据“推荐执行者”自动选择选手，不绕过平台的可用性、额度、隔离和强度策略。
- 不改动 `docs/TASK_LIST.md` 或 Task Spec；本任务只规定负责人如何读取和使用。

## 验收标准

1. 常驻规则明确要求在项目存在 `docs/TASK_LIST.md` 时先读取任务台账和当前 spec。
2. 指挥手册明确区分规划来源与实际选手路由，并写明推荐执行者不绑定工作台选手。
3. 没有任务台账的旧项目行为不变。
4. 接入、更新和撤下规则的既有字节保护及测试继续通过。

## 验证

```bash
npm run typecheck
node --test test/connect.test.ts test/guide.test.ts
```

如果仓库没有 `test/guide.test.ts`，应在现有覆盖 `guide` 的测试文件中补断言，不为满足命令凭空创建重复测试层。

## 实施报告

待执行者填写：改动摘要、验证结果、未完成项和 diff 摘要。

## 评审记录

### 2026-10-17：[PASSED]

- `LEAD_RULE`、首次对接说明和指挥手册均已接入 `docs/TASK_LIST.md` / 当前 Task Spec 契约，并明确状态、依赖、授权范围和执行者建议不绑定工作台选手。
- 无台账项目保持原行为，接入规则仍复用唯一 `LEAD_RULE`；对应 connect、guide、intro 测试覆盖有效。
- 负责人复跑：`npm run typecheck`、`test/connect.test.ts`、`test/guide.test.ts`、`test/intro.test.ts` 均通过。
- 实施报告未回填，但实际 diff、测试和验收标准足以完成本次评审。
- 优先级复核：`P1` 保持不变；通过后解除 TASK-005 的前置依赖。难度 `Low` 保持不变。
