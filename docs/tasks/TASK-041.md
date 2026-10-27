# TASK-041 — 桌面显式启用负责人复审流程

- handoff_contract: `1`
- status: `PASSED`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-027[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果
主人可在规划页的无人看守启动弹窗显式选择负责人新流程，不必使用命令行；界面准确说明返工/拆分保存制品后仍会暂停。

## 非目标
- 不实现增量制品自动提交、授权续跑、跨项目队列、自动换人或费用功能。
- 不默认启用新流程，不改变旧运行记录。

## 架构设计
共享桥类型新增可选布尔开关，主进程严格校验字段及受信负责人，再交给已有运行核心；窗口只筛选展示候选并传标识，不复制协议解析、权限或预算业务规则。切换流程时清空负责人及相关确认，避免沿用旧授权。

## 兼容要求
旧窗口不传开关时保留旧模式；未知字段、非法布尔和不受信负责人在启动前拒绝。选手与强度仍来自统一名单及当前策略。

## 验收标准
1. 默认不启用，选择新流程后仅可选择受信且与执行者独立的负责人。
2. 模式切换使负责人、强度、快速档及权限/联网确认失效；候选失效不能提交。
3. 桥接真实核心生成新协议记录，非法请求没有启动副作用，原兼容用例通过。
4. 界面明确提示返工/拆分暂停、不会自动提交；浅色、深色、窄窗口截图与离线真实窗口测试可核对。

## 依赖与排序
TASK-027 已交付运行核心。本任务先于队列开放；授权续跑需独立的 Git 与成果承接设计，不在此开后门。

## 主要接口
- `app/shared/ipc.ts` — AutopilotInput。
- `app/main/autopilot-bridge.ts` — autopilotActions.start。
- `app/renderer/components/Autopilot.tsx` — AutopilotStartDialog。

## 长期约束
窗口没有命令/任意路径/负责人替代权限。所有测试隔离真实账户，不用真实付费调用做验收。

## 微批边界
- expected_primary_files: `3`
- exception_reason: `none`
