# TASK-032 — 连接推理强度默认值与能力校验

- handoff_contract: `1`
- status: `IN_PROGRESS`
- priority: `P1`
- difficulty: `High`
- dependencies: `TASK-031[PASSED|PASSED_WITH_NOTES]`
- current_attempt: `09`

## 业务结果

兼容中转站仅接受默认强度的模型，避免固定 high 造成连接失败。

## 非目标

- 不查询第三方账单、不自动发起收费探测、不承诺实际账户绝不超额。
- 不在规划阶段修改实现或启动真实选手。

## 架构设计

DeepSeek 编辑新增按模型的推理强度模式：默认表示完全省略显式强度覆盖，由通道默认处理；显式模式仅开放已确认支持且符合平台底线的档位。模型 ID 列表不代表强度能力；能力来源注明已核验元数据或用户配置及更新时间。旧 high 配置保留并提示确认；新配置推荐默认。保存前核对实际命令；不将元数据缺失自动当作支持 high。错误只触发一次限频目录刷新并回交用户，不进行收费推理重试或自动切 Pro。

## 兼容要求

- 保留旧设置和历史记录可读；新字段不能静默降低现有安全约束。
- CLI 与桌面共用核心规则；任务执行不改写规划文档。

## 验收标准

1. 默认模式实际启动参数不含强制推理强度，其他通道行为不变。
2. 显式档位与已确认能力匹配，不支持时在启动前清楚拒绝。
3. 目录刷新无法提供强度能力时保留未知，不捏造能力；默认与省略参数行为通过命令替身验证。

## 依赖与排序

- 前置：TASK-031。新增任务保持 DRAFT；执行前由负责人确认接口、拆出不超过 3 个主要实现文件的微批并生成 Capsule。

## 主要接口

- src/core/deepseek-settings.ts；src/core/workers.ts；src/core/roster.ts

### 显式能力兼容合同

reasoningCapabilities为可选保存声明，绑定规范化baseUrl及wireApi，models按实际ID登记high布尔值、source=user及ISO更新时间；最多128项。当前无可信元数据导入器，不接受自称metadata的声明，不从目录ID推断能力。旧省略/high字段保持可读且不自动改成默认，但派发显式档位须匹配声明；未知/不支持/换地址协议模型均启动前拒绝，提示选默认或确认能力。default不需要声明，命令省略行为保持。首批设置解析与派发门槛同批生效；续跑/真实启动复核和编辑声明另批，整项未完成不放行。

错误回交只识别run.log末尾64KiB完整JSON行的error/turn.failed事件：model_not_found或unsupported_parameter且param为reasoning_effort/model_reasoning_effort，不猜散文或工具错误。按job.id与resume.round（缺省1）持久去重，消费先留历史再请求，崩溃不重试。同次原授权grant/binding、冻结地址/协议/凭据版本须仍匹配；runner只登记，桌面消费复用031受控调度/取消，不给CLI开网络。未授权不补队列，授权重开不复活旧请求，失败/冷却不重试，保留原报告/费用并提示主人。

## 长期约束

- 凭据不写入设置、账本、目录或日志；新增自动请求不绕过现有授权和网络边界。
- 不将工具步数推导成模型请求数；缺失 token 与能力必须显示未知。

## 微批边界

- expected_primary_files: `3`
- exception_reason: `none`
