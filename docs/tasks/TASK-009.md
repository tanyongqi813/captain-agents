# TASK-009：自治执行记录与确定性推进器

- 状态：`CHANGES_REQUESTED`
- 优先级：`P1`
- 难度等级：`High`
- 前置任务：`TASK-006` 与 `TASK-008` 评审为 `PASSED` 或 `PASSED_WITH_NOTES`
- 需求来源：无人看守需要独立于聊天内存、可崩溃恢复的全局执行状态。

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

待执行者填写：改动摘要、验证结果、未完成项和 diff 摘要。

## 评审记录

### 2026-10-18 Codex 二轮复审：`CHANGES_REQUESTED`

- 已在 `.worktrees/task-009` 复核原三项修正：全局登记锁、固定策略与字段校验、缺失 PID/spawn 失败转 recovering 均已实现。类型检查通过，原指定核心测试 56/56 通过。
- 仍阻断：CLI 只有 start/status/list/stop，无法恢复 recovering 的原登记，start 又会被同任务查重拒绝；须增加只接执行编号的受控 resume 入口，沿用原快照与动作令牌并覆盖 CLI 恢复链路。
- 仍阻断：动作已落盘但 start 尚未返回任务号时，第二次 step 会因 find 没证据再次 start；复审阻塞替身实测同一个动作启动 2 次。应以跨进程执行权/动作锁串行保护证据检查、派发和登记，并在锁内复核推进器所有权。失败回归已留在 task-009 worktree 的 test/autopilot-engine.test.ts；详细修正要求与报告记于该 worktree 的本 Task Spec。
- TASK-003 先前带注通过结论保留；因 TASK-009 未通过，本轮未做条件合并、提交或 push，三个工作副本保留。
- 优先级复核：TASK-009 保持 P1 High CHANGES_REQUESTED，TASK-010 继续 DRAFT；其他相关任务优先级无调整。
