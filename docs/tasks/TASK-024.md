# TASK-024 — 规划共享契约与安全迁移校对

- handoff_contract: `1`
- status: `PASSED`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-023[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果

Architect PM Handoff 与工作台使用同一个版本化规划契约；旧项目可先诊断、预览迁移，再原子应用，并证明任务 ID、状态、依赖与 READY 集合没有被意外改变。

## 非目标

- 本任务不自动派发任务，不修改业务代码，不猜测混合微批状态的含义。
- 不以聊天正文作为机器派活信号。

## 架构设计

在核心中提供单一解析与校验入口，兼容当前中文字段和共享契约英文元数据；CLI 的 doctor/migrate/verify 共用该入口。迁移器默认只读，apply 前后生成语义快照，只有可证明等价时才写入。

## 验收标准

1. 标准契约、现有中文契约和常见旧台账均可给出确定诊断。
2. dry-run 不写文件；apply 原子写入且幂等；verify 能发现交叉引用破坏。
3. 未知状态、重复 ID、循环依赖、微批混合状态和歧义重命名拒绝自动应用。
4. 迁移前后完整核对任务数、ID、标题、状态、依赖、READY 集合、Spec 路径与 attempt。

## 精确锚点

- `src/core/task-plan.ts` 的规划解析与可执行判定
- `src/cli/cli.ts` 的项目规划命令路由
- `test/task-plan.test.ts` 的安全解析回归

## 执行边界

- 可修改：`src/core/task-plan.ts`、`src/core/plan-migrate.ts`、`src/cli/cli.ts`、`test/task-plan.test.ts`、`test/plan-migrate.test.ts`
- 修改文件上限：5
- 超出上述路径或数量时，停止并报告所需联动，不要自行扩展。

## 执行者验证

```bash
node --test --test-timeout=120000 test/task-plan.test.ts test/plan-migrate.test.ts
npm run typecheck
```

## 已知基线

- 无。

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
