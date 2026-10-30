# Execution Capsule — TASK-018 / attempt-12

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `12`
- revision_reason: `changes_requested`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
修复 F-10：显式 any 检查不能误拒绝合法 HTML 属性，更不能在源码扫描中不推进。

## 本轮验收切片
- HTML step="any" 字符串不被当成类型；真正的 any 类型仍拒绝。
- 对项目所有 TS/TSX 文件检查有界完成，模板字符串、插值、注释、正则及字符串场景有明确测试或保守处理，不静默跳过失败文件。
- 检查器遇不支持的语法有界报错，不忙循环；不要用删掉规则或编码生产属性躲避检查。

## 已确认事实（禁止重新推导）
- TypeScript 7 主入口只暴露版本，不提供 createSourceFile/ScriptTarget，禁止依赖旧 API 或安装新依赖。
- 当前 hasExplicitAny 使用 typescript/unstable/ast.createScanner；扫描 autopilot-diagnosis.ts 字符 8092（模板字符串附近）后空 token 不推进。
- F-05 生产保存冲突修复已过 45/45、UI 9/9、四工程类型检查；F-11 分页测试 9/9，保持不动。
- 完整 UI 345 中仅上述两处失败已定向修复；完整核心当前已知原文本误报失败；完整构建 PASS，无源码新改动则不重复。
- 当前仅合同校验通过不代表 Task 可派发，Task 仍 IN_PROGRESS。

## Active findings
- `F-10`：显式 any 检查误报及纠偏扫描不推进。

## 源码锚点（最多 5 个）
1. `test/architecture.test.ts` — hasExplicitAny、显式 any 检查及正反例。
2. `src/core/autopilot-diagnosis.ts` — 只读复现模板上下文，不改该文件。

## 修改白名单
- `test/architecture.test.ts`
- max_modified_files: `1`

## 明确非目标
- 不改生产源码、F-05/F-11 或其他历史实现；不安装、不访问网络、密钥或真实选手。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/architecture.test.ts`
2. `git diff --check`

## 禁止验证
- 不重复完整核心/UI/build/typecheck；已有通过证据不重跑。不运行真实窗口或收费联调。

## 已知基线失败
- 当前架构检查无法完成，已主动中断；先修后仅验证本文件。

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `10`
- soft_call_limit: `12`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 初始加一次纠偏后仍失败则回交；不在不推进的同步循环上依赖 JS 定时器超时，须检查扫描进展并有界失败。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 检查修复
- remaining_gaps: 集成缺口
- anchors_touched: 符号
- verification: 命令结果及 latest_code_covered
- active_findings: F-10 resolved/unresolved
- scope_or_baseline_notes: 新事实
