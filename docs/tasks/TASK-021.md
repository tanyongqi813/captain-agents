# TASK-021：DeepSeek/Kimi 上下文节流适配

- 状态：`PASSED`
- 优先级：`P1`
- 难度等级：`Medium`
- 前置任务：`TASK-020` 评审为 `PASSED` 或 `PASSED_WITH_NOTES`
- 需求来源：DeepSeek 容易扩大验证范围，Kimi 容易在开工和上下文压缩后重读整套规划与前置材料。

## 业务结果

选择 DeepSeek、DeepSeek · Flash 或 Kimi Code 时，工作台按每个 job 追加简短的上下文节流规则；它们优先读执行胶囊和精确锚点，不重读全部规划/评审历史，也不重复扩大验证。其他选手保持原提示。

## 范围

- 包含：沿用 roster 的 vendor 事实识别 DeepSeek/Kimi；每个 job 独立组合 prompt；混合批次不错配规则。
- 不包含：改变选手权限；监控每条 shell 命令；自动回滚或删除选手改动。

## 精确锚点

- `src/core/prompt.ts` 的 `workerPrompt`
- `src/core/dispatch.ts` 中写入 `prompt.md` 和 `prepareRun` 的 job 循环
- `src/core/roster.ts` 的 `vendorOf`

## 执行边界

- 可修改：`src/core/prompt.ts`、`src/core/dispatch.ts`、`test/network-wire.test.ts`、`docs/tasks/TASK-021.md`
- 修改文件上限：4

## 验收标准

1. DeepSeek Pro、DeepSeek Flash 和 Kimi 收到同一类上下文节流规则，Codex、Grok 和 Cursor 不收到。
2. 节流规则要求优先读胶囊/锚点、压缩后不重建全量上下文、阶段汇报不停下等待。
3. 同一批派给不同选手时，提示按 job 生成，不会让其他选手误收 DeepSeek/Kimi 规则。

## 执行者验证

```bash
npm run typecheck
node --test --test-timeout=120000 test/network-wire.test.ts test/plan-dispatch.test.ts test/task-plan.test.ts
git diff --check
```

## 已知基线

- `test/quota.test.ts` 的两个 PTY 用例不属于本任务，不运行、不排查。

## 实施报告

- `workerPrompt` 按 `vendorOf` 判断 DeepSeek/Kimi，没有按模型名或隔离种类猜测。
- `dispatch` 保留一次读取的基础题目，在每个 job 准备运行包前追加对应规则，不重复读取项目文件。
- 验证：类型检查通过；相关 39 项测试通过；`git diff --check` 通过。

## 评审记录

2026-10-20：`[PASSED]`。上下文节流只改变题目组合，不改权限、模型选择或选手隔离。
