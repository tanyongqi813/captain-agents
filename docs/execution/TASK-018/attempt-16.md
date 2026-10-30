# Execution Capsule — TASK-018 / attempt-16

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-018.md`
- task_id: `TASK-018`
- attempt: `16`
- revision_reason: `checkpoint_resume`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`
- implementation_workspace: `/Users/yyw./Documents/ChatGPT/派活工作台/captain-agents/.worktrees/task-018`

## 本轮唯一目标
补AC1尚无真实窗口组合证据的人工余额/价格/经验编辑，保持13/14本地预算场景不重跑。
## 本轮验收切片
- 来源/过期可见；编辑余额、币种、单价0和经验倍率，非法币种整份不写；合法保存后关闭进程重开保持。
- 临时资料/用户目录，不调用真实选手/认证；价格段浅深900窄截图实际查看。
## 已确认事实（禁止重新推导）
- 15审查矩阵已保存，不重复归属盘点。018实现仍仅原副本，主仓未整合。
- 原副本生产和build13未变，仅新增测试无需重新build。
- costSave核心CAS、local窗口保存重启已有证据，此次只补不同数据类别实际交互。
## Active findings
- none
## 源码锚点（最多 5 个）
1. `app/renderer/components/CostSettings.tsx` — balanceRow/价格/经验。
2. `test/e2e/cost-settings.ts` — 临时Electron启动模板。
3. `src/core/cost-settings.ts` — 资料类型/校验。
## 修改白名单
- `test/e2e/cost-data.ts`
- max_modified_files: `1`
## 明确非目标
- 不改生产/规范/主仓、不迁移、不重复13/14用例、不真实联网。
## 定向验证（最多 5 条）
1. `node --test --test-timeout=60000 test/e2e/cost-data.ts`
2. `npm run typecheck`
3. `git diff --check`
## 禁止验证
- 不build/全量/core/UI，不跑13/14旧窗口。
## 已知基线失败
- 隔离启动Electron失败需临时目录明确审批。
## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `12`
- soft_call_limit: `14`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`
## 停止条件
- 若生产缺陷或一次纠偏后失败，保存真实partial，不能扩文件。
## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 原副本分支
- changed_files: 测试
- completed_scope: 数据交互
- remaining_gaps: 整合/verify
- anchors_touched: 新测试
- verification: 结果/latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 取证不冒充主仓可用
