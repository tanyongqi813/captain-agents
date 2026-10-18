# Kimi 套餐查询核实（2026-10-18）

## 已确认

- 新版官方斜杠命令文档列出 `/usage`，用途包括 token 用量、上下文占用和额度信息；`/status` 是运行状态，不应混为新版 `/usage` 的别名。
- 本机 `/Users/yyw./.kimi-code/bin/kimi --version` 返回 `2.1.1`；`--help` 为新版 CLI，支持交互界面和 `-p/--prompt`。帮助里没有独立 `usage` 子命令。不能据此假定 `kimi -p /usage` 一定执行控制命令而不发起模型请求。
- 仓库 `src/core/quota.ts` 的 `queryQuota`、`ensureQuota` 当前明确过滤 Kimi，`quotaBar` 也直接返回空；`stats.ts` 保留 Kimi 用量未知。因此是工作台尚未安全接入，不是 Kimi 不支持查询。

## 官方依据

- 新版斜杠命令：https://www.kimi.com/code/docs/en/kimi-code-cli/reference/slash-commands.html
- 旧版斜杠命令：https://moonshotai.github.io/kimi-cli/en/reference/slash-commands.html
- 会员规则：https://www.kimi.ai/help/kimi-code/benefits

会员页面说明新旧套餐窗口有差异，并存在月度总量约束；Extra Usage 开启后可在套餐耗尽时自动扣费，且可能与网页共用余额。实现必须以实际账户返回字段为准，不假定所有人都有周窗口，也不因 `/usage` 未返回月额度就判月度无限。该会员页面为国际页面，不能把币种或套餐字段硬套到国内账户。

## 尚未验证

本次只执行本机 `--version`、`--help` 并读取官方公开文档，没有启动真实 `/usage` 查询，没有读取登录凭据、修改账号配置或消耗模型额度。以下内容留给 TASK-019 的受控探针确认：

1. 2.1.1 下可安全自动读取的交互路径、完整输出边界、退出与子进程收尾方式。
2. 用户所述 Plan usage、重置倒计时、Extra Usage 本月消耗/月上限/余额的实际字段、单位与缺省含义。
3. 是否存在无需启动模型、无需新开服务的受支持结构化查询；优先该路径，若不可用再使用受控终端读取。
4. 临时工作目录、状态目录迁移及是否产生会话/自动加载钩子等副作用；不得直接复用真实项目或已有会话。
5. Kimi 官方账号与自定义接口的识别边界，避免把中转站模型错误映射成官方套餐。

## 结论

新增 TASK-019 接入 Kimi 官方套餐查询；成功且数据新鲜时消费服务端事实，查询失败或自定义接口仍保留未知/本地预算。套餐窗口、会话资源和付费余额分开处理，继续遵守“达标总成本优先、额度启动前把关”的规划原则。
