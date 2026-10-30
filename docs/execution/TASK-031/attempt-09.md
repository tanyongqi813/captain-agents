# Execution Capsule — TASK-031 / attempt-09

- handoff_contract: `1`
- capsule_schema: `2`
- dispatch_state: `CLOSED`
- planning_source: `docs/tasks/TASK-031.md`
- task_id: `TASK-031`
- attempt: `09`
- revision_reason: `initial`
- priority: `P1`
- difficulty: `High`
- required_planning_lookup: `none`

## 本轮唯一目标
落地自动目录刷新的默认关闭、保存身份绑定和撤销配置核心，不启用后台请求。

## 本轮验收切片
- 专用开关只接受布尔及调用方看到的当前身份摘要，锁内对照已保存规范化地址/协议和凭据文件元数据版本；旧身份不能授权新地址，不接收临时密钥。
- 普通设置补丁不能开启授权；地址/协议变化与授权撤销同次写入，切回旧地址也不恢复；仅模型/价格变化保留授权。
- 凭据版本变更、缺失、坏授权记录均显示未授权；不读密钥正文、不发请求。关闭再开启产生新授权代号，旧在途身份可区别。

## 已确认事实（禁止重新推导）
- 08调度核心5/5已过，但未接生产。凭据版本已有deepseekCredentialVersion，仅lstat元数据，无密钥指纹。
- writeSettings设置锁已有；本批扩核心配置接口并实际接入连接修改撤销，主进程/IPC/UI/目录提交后续另批。

## Active findings
- none

## 源码锚点（最多 5 个）
1. `src/core/settings.ts` — writeSettings、readDeepseekRuntimeSettings。
2. `src/core/deepseek-credentials.ts` — deepseekCredentialVersion，只读。

## 修改白名单
- `src/core/settings.ts`
- `test/deepseek-catalog-consent.test.ts`
- max_modified_files: `2`

## 明确非目标
- 不读真实凭据、不接真实网络/定时器/IPC/UI，不改调度、目录写入及旧收费实现。

## 定向验证（最多 5 条）
1. `node --test --test-timeout=120000 test/deepseek-catalog-consent.test.ts`
2. `npm run typecheck`
3. `git diff --check`

## 禁止验证
- 不重跑旧目录/费用/纯调度测试，不跑全量/UI/build/窗口或真实通道。

## 已知基线失败
- none confirmed

## 单次执行预算
- budget_mode: `prompt_soft`
- soft_timebox_minutes: `15`
- soft_call_limit: `15`
- runner_limit_reference: `none`
- max_correction_rounds: `1`
- on_budget_stop: `return partial + checkpoint; do not claim completed or blocked`

## 停止条件
- 来源冲突或白名单外需求停下报告；一次纠偏仍失败保存检查点。

## 精简 Implementation Report（固定格式）
- outcome: completed / partial / blocked
- handoff: none / checkpoint
- stop_reason: none / soft_budget / scope_conflict
- workspace_branch: 路径分支
- changed_files: 路径
- completed_scope: 本切片
- remaining_gaps: 接线验收
- anchors_touched: 设置授权接口
- verification: 结果与latest_code_covered
- active_findings: none
- scope_or_baseline_notes: 新事实
