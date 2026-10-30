# Execution Capsule — TASK-036 / attempt-01

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-036.md`
- task_id: `TASK-036`
- attempt: `01`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `Medium`
- required_planning_lookup: `none`

## 本轮唯一目标
实现无默认真实通道的有界诊断执行核心和离线子进程验证，不接应用/自动化网络入口。
## 本轮验收切片
- 调用方显式提供可信命令，无shell；临时目录固定小文件及独立HOME，不继承凭据环境。
- 单次最长90秒，输出总量/单行有界，仅投影事件阶段/结果是否符合固定内容，不保存原始日志或任意错误/命令。
- 成功、无输出、仅工具开始、进程不退出/子孙清理、输出超限及启动失败替身；未知模型/版本/用量保持null，不冒称真实通道已测。
## 已确认事实（禁止重新推导）
- platform已有treeSpawn/processSince/assertTreeControl/killTree，禁止重写。
- cursor流有system/init及tool_call started/completed；仅事件不证明文件实际读完，必须独立结果校验。
- 无现有channel-probe核心；test/probe是隔离自检，不重用。
- 用户授权先做036离线范围，不修改安全模板或真实调用。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `src/core/platform.ts` — 进程树接口。
2. `test/fixtures/streams/cursor-stream.jsonl` — 结构化阶段。
3. `test/helpers.ts` — 临时环境参考。
## 修改白名单
- `src/core/channel-probe.ts`
- `test/channel-probe.test.ts`
- max_modified_files: `2`
## 明确非目标
- 不接真实CLI适配器/账户，不读真实密钥、不探测网络，不改workers/platform/028/018。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=30000 test/channel-probe.test.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不全量/core旧测试/UI/build/e2e，不启动真实模型，不安装部署。
## 已知基线失败
- none confirmed
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `18`
- soft_call_limit: `18`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 需要超白名单/真实权限、一次纠偏仍失败时回交。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 运行核心及替身
- remaining_gaps: 适配器与单独授权真实验收
- anchors_touched: 新模块
- verification: 结果/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 不冒称真实通道或发布通过
