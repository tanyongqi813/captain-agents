# TASK-042 — 负责人决定与待处理胶囊的只读展示

- handoff_contract: `1`
- status: `DRAFT`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-027[PASSED|PASSED_WITH_NOTES], TASK-041[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `none`

## 业务结果
主人可从无人看守详情看到负责人最后决定、脱敏理由及待处理增量胶囊数量，明确为什么暂停；不必手工打开运行登记。

## 非目标
不导出胶囊正文、不写仓库、不提交或采用补丁、不自动续跑或换人。

## 架构设计
核心从已验证的运行记录生成有界只读摘要，窗口只展示，不解析原始回包或原始登记。优先显示精确的停机事实，通用求助原因不得掩盖已保存制品这一事实。

## 兼容要求
旧运行缺少协议或决定时显示既有独立审查记录。读取不产生通知、文件或状态变更；不向窗口泄漏绝对路径、动作令牌、原始 prompt 或密钥。

## 验收标准
1. 五动作以固定中文标签显示；correct/split 显示已保存制品数量及尚未授权续跑说明。
2. 旧记录、暂无决定、损坏记录均不伪造结果。
3. 摘要有长度上限及脱敏，界面将模型文本按纯文字展示。

## 依赖与排序
在桌面入口后优先完成，只读证据可见后再设计显式 Git 授权及成果承接；后者不能隐含在展示按钮里。

## 主要接口
- `src/core/autopilot-view.ts` — autopilotView。
- `src/core/view-types.ts` — ViewAutopilot。
- `app/renderer/components/Autopilot.tsx` — AutopilotDetail。

## 长期约束
任何提交、导出、权限变更及续跑必须通过独立已授权写入口；只读摘要不授予执行能力。

## 微批边界
- expected_primary_files: `3`
- exception_reason: `none`
