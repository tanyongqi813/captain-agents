# TASK-020：Task Spec 执行边界进入派活题目

- 状态：`PASSED`
- 优先级：`P1`
- 难度等级：`Medium`
- 前置任务：无
- 需求来源：DeepSeek 执行 TASK-016 时自行扩大修改和验证范围，重复运行全量测试、界面测试和构建，导致一次实现过长。

## 业务结果

从任务规划页派活时，执行者不仅看到目标和验收标准，还能看到明确的可修改文件、修改数量上限、执行者验证命令、禁止的重型验证和已知基线问题；遇到越界需求时停止并报告，不自行扩张。

## 范围

- 包含：扩展 Task Spec 受限解析，识别执行边界、执行者验证和已知基线；把结构化结果写入规划派活题目；旧 Task Spec 兼容。
- 不包含：根据任务文本执行命令；直接阻断选手在自己副本里运行命令；修改项目全量验收配置；修改选手模型选择。

## 现状与设计

- `task-plan.ts` 目前只从 Task Spec 取顶部状态/依赖、业务结果和验收标准；`plan-dispatch.ts` 因此无法把验证边界交给执行者。
- 在 Task Spec 模板增加可选的 `## 执行边界`、`## 执行者验证`、`## 已知基线` 三节。执行边界只接受简单列表：可修改的仓库相对路径，以及一个有界的“修改文件上限”整数。执行者验证只作为发给选手的文本，平台绝不执行其中命令。
- 新字段和现有规划解析一样设置数量、单项字数和总字数上限，Markdown 和项目文本始终当不可信纯文本处理。
- 题目中明确写“执行者验证是上限，全量验收由负责人整合后执行”；修改文件或命令需超出契约时，要求选手停止并在报告中说明原因。
- 对不含新章节的旧 Task Spec，保持现有题目和可执行性，不伪造文件白名单、验证命令或基线结论。

## 主要文件

- `src/core/task-plan.ts`
- `src/core/plan-dispatch.ts`
- `docs/tasks/TEMPLATE.md`
- `test/task-plan.test.ts`
- `test/plan-dispatch.test.ts`

## 执行边界

- 可修改：`src/core/task-plan.ts`、`src/core/plan-dispatch.ts`、`docs/tasks/TEMPLATE.md`、`test/task-plan.test.ts`、`test/plan-dispatch.test.ts`、`docs/tasks/TASK-020.md`
- 修改文件上限：6
- 超出上述路径或数量时，停止并报告所需联动，不要自行扩展。

## 约束

- 遵守 `AGENTS.md`；不新增依赖，不做无关重构。
- 不从 Markdown 执行命令，不把规划文本解释为平台配置或权限。
- 不改变现有 READY/依赖校验和规划页派发权限。

## 验收标准

1. 含新章节的 Task Spec 被派发时，题目完整呈现有界的可修改文件、文件数上限、执行者验证和已知基线。
2. 题目明确要求不运行未列出的全量测试、UI 测试、构建或全量验收；如需扩大范围，停止并报告，由负责人决定。
3. 路径、命令、基线项和整份题目都有严格上限；超长、非法形状、绝对路径和越界路径不会被当成有效执行边界。
4. 旧 Task Spec 和不走规划页的 `xagents run` 行为保持兼容。
5. 测试覆盖正常契约、缺省契约、超长/非法内容和最终题目文本；不需要真启动选手。

## 执行者验证

```bash
npm run typecheck
node --test --test-timeout=120000 test/task-plan.test.ts test/plan-dispatch.test.ts
```

只运行上述命令；不运行 `npm test`、`npm run test:ui`、`npm run build` 或 `npm run verify`。同一完整命令最多运行两次，全量验收交给负责人。

## 已知基线

- `test/quota.test.ts` 的两个 PTY 用例在当前机器和主工作区的既有基线中均失败；本任务不运行、不排查、不修复它们。

## 实施报告

- 实际修改：`task-plan.ts` 受限提取精确锚点、相对路径白名单、文件上限、执行者验证和已知基线；`plan-dispatch.ts` 生成短执行胶囊，不再把 Task Spec 当本轮执行提示。
- 兼容：旧 Task Spec 没有新章节时保持可派发，不伪造白名单、命令或基线。
- 验证：`npm run typecheck` 通过；`test/task-plan.test.ts`、`test/plan-dispatch.test.ts`、`test/network-wire.test.ts` 合计 39 项通过；`git diff --check` 通过。

## 评审记录

2026-10-20：`[PASSED]`。受限解析、短胶囊、旧任务兼容与定向验证均满足。
