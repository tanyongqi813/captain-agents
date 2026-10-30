# TASK018 安全整合审查 — 2026-10-29

本轮是只读审查，不是新功能开发、已迁移或已发布。09:36启动的审查被后续10:06/10:36触发携带同一旧摘要续入，尚未落盘即再次触发；本检查点统一保存真实事实，不把三个触发说成三轮完成。未重跑已有测试。

## 基准及观察

- 主仓HEAD9fb0b5d；原副本HEAD/共同base ff579921bd22cad385aebc73f5ee2079296c8420。
- 主仓与该base相比，目标文件中已提交差异仅dispatch的规划基准校验和ipc的leadReview；其余共享文件还叠加未提交031–035差异。
- 原副本只有018成本链目标增量；主仓没有costGate/costStatus/costSave消费者，不能拿副本窗口通过冒充主仓可用。
- 应用会话列表仅本会话active，TASK028关联会话notLoaded；不等于证明外部进程无并发。写前仍检查文件摘要、Git锁/操作、在途归属。未接管028。

## 逐段迁移矩阵

| 路径/符号 | 已确认归属与差异 | 安全迁移边界 | 必要新组合证据 |
|---|---|---|---|
| cost-settings.ts / replaceCostSettings | 主仓与旧副本除isDeepStrictEqual及CAS函数16行外相同 | 保留既有load/update/计价查询，只加CAS；先不开放无基线写入口 | 同基线并发保存仅一份成功、坏输入原文件不变、已有TASK017消费者兼容 |
| cost-budget.ts | 副本独有，claimId/日账/时长预占及保守旧占位接口已审 | 只能迁移精确已审内容，不改算法。无消费者阶段不能称本地预算生效 | 接线后的注册前/后失败、重复释放、未知时长预占和终态释放 |
| CostSettings.tsx / cost-settings桥 | 副本独有；真实IPC窗口13/14已过 | 原样内容审查后接线；不得绕开核心CAS或自行读取真实账户 | 最新组合中的真实保存/冲突与必要UI兼容；不无故重复原副本截图 |
| Settings.tsx | 双文件差异仅import、分页、CostSettings挂载三个段，主仓此文件无dirty | 三处增量，不从旧副本替换整文件 | 原设置分页/旧入口及成本页可见，types |
| ipc.ts | 副本cost类型/通道/方法；主仓另有DeepseekCatalogConsent及已提交leadReview | 只加cost，保留目录授权方法、leadReview字段，不能整体覆盖 | 完整XaBridge夹具及白名单测试同步，否则types/接口枚举失败 |
| preload/index.ts、main/index.ts | cost桥邻近031授权桥；主仓还有后台loop/recovery/退出清理 | cost专用status/save＋trusted guard独立接入，保留031开关/后台与禁联网e2e路径 | 错参数/不可信来源拒绝，CAS保存，目录桥保持 |
| dispatch.ts | 副本costGate/claims回滚；主仓实际ID/推理/价表/组预占及028规划基准 | costGate必须吃已解析实际job.model，不用roster槽位；持有claims所有权在createJob前，失败两账本都回滚。保留assertCapsuleInStart，禁止处理028未过finding | 实际DS模型绑定正确；本地预算通过而金额拒绝、反向拒绝均不泄漏；多选手后项失败全部退还；非DS不误入DS组 |
| job.ts | 副本cost字段；主仓dispatchTrace/deepseekConnection/group/credentialVersion | 仅加可选cost，保留主仓全部字段，旧记录兼容 | 类型/冷读、两类冻结身份不混用 |
| runner.ts | 副本attempted/maxMinutes/recordSeconds/release；主仓runtimeMoney/推理复核/临时凭据/错误回交/金额停止证据 | 合并到同一spawn及外层finally。预算取min，spawn成功才算尝试；能力拒绝/认证失败零本地尝试；两账本结算和报告独立，不让一处异常遮蔽另一处清理 | 金额启动门槛失败、本地时限更紧、spawn失败、金额停止后两账释放、报告补丁及临时认证清理保持 |
| wake.ts | 主仓与base相同，副本有claim与try/finally重排 | cost claim必须绑定当前轮，重复续接退回；保留主仓runner收费续接禁止，不能迁移时绕开该门槛 | 金额已结算续接被拒且新cost占位回滚；非收费续接成功/失败保持 |
| test/architecture.test.ts | 副本F10已修扫描器，主仓不是同一验收结果 | 不把修测试当迁移生产；单独审查规则，不能整文件覆盖主仓新架构断言 | 新增cost模块边界应在主仓真实规则下验证 |
| fixtures/desktop/bridge/smoke/ui-spec | 副本含cost接口和分页；主仓另有031/032及其它设置演进 | 只补cost接口/用例/规范段，不回滚当前夹具、完整桥枚举或现行UI规范 | 受影响类型/设置分页/桥白名单组合；全verify仍独立最终闸门 |

## 分批原则与当前结论

1. 实现继续仅原副本。负责人安全整合不是直接重写主仓：先隔离一组已审文件/hunk及最新摘要，再按单独迁移合同逐段处理；不在审查合同内写生产。
2. 可先准备无生产消费者的核心CAS/预算模块，不向用户宣称预算已可执行。桥＋类型＋夹具＋页面接入是不可分接口迁移，需原子例外，不能留下缺方法可启用界面。
3. dispatch/job/runner/wake两账本接线是不可分启动收尾迁移，不可只接派发而不接runner。须另有原子例外及两类预算组合测试。028规划基准部分原封保留；仅Capsule将dispatch列白名单不是并发证据，不能据此全局等待。
4. 当前018原副本功能与主仓收费链组合验收不是同一个对象；不能用旧通过取消新组合测试，也不能不改代码就重跑整套。若只剩发布闸门，按实际证据保留IN_PROGRESS，不伪造READY。
5. 人工余额/价格/经验复杂窗口交互仍需按AC核对既有核心/UI证据，不把13/14简单local夹具当全部业务窗口验收。

## 主仓目标快照（后续写前重核）

dispatch f82ad9bef48b6f57879a021f7930825c3c02705ba5112ad4040773e97b3b4e29
job 1dfd0c88f96645bf6466f544995579254dcef4fe3ed71e7ac6949c3a9149a085
runner 3615903ba295d81957fcc0c4954c4cab27c78204451daac59b701af29b1be08e
wake f527b3698af7101136ab640e215659392c22e17197f5117854705b9eb96b938e
cost-settings 85b1dce2a1b641630fae89547c5cb6d7008eb85a6e2b82240e279cd84c4cf537
ipc 35387dd65cb1202ea35dde3074240d1886658e4b5f45a64b80c0f0b925e697f2

本轮没有迁移、实现、测试重跑、真实网络/认证/模型收费、提交同步或安装部署。此矩阵是静态审查结论，不是自动合并证明；完整verify仍未通过。

