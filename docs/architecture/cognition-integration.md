# Nous Wave 认知接入

Heptalogos 通过可独立安装的 Nous 官方 Client 消费同一认知服务。Nous 保存 Subject、Seed、Memory、Self 及后续认知领域；Heptalogos 保存产品配置、消息、活动和行为。两侧通过 SubjectId 关联，产品不读取 Nous 私有数据库，也不复制认知对象作为自己的事实。

## 当前管理接入

Product Host 从配置的 Nous runRoot 读取正式 discovery，使用其中的本机服务凭证连接，并核对指定 InstanceId。认证状态查询用于展示真实 Core/Kernel 等组件状态；Subject 查询、绑定与可选 Seed 创建直接使用官方 Client。创建不自动替换产品绑定。管理配置通过已有 revision/activation CAS 生效，活跃绑定不能绕过配置入口的替换限制。

管理自身不依赖认知服务在线。Nous 不可用时，管理员仍可登录、查看配置和依赖状态、修复连接；需要实际认知的 Subject 操作明确失败。配置中的 subject.enabled 只是运行意图，不能证明模型、QQ 或认知循环已经就绪。

接口和权限的精确合同见 [Management Spec](../../specs/management/system-authority.md)，安装与官方 Client 构建输入见 [Product Host](../../packages/application/product-host/README.md)。

## 正在接入的主体循环

当前管理接入尚不构成 QQ 主体运行。活动计划要求正式 OpenClaw 原生模型循环复用 Nous 的 Memory、WorkContext、Projection 和 ContextCompiler，覆盖工具后续、RESET/压缩、子 Agent 和真实结果回流。Heptalogos 消费同一插件，管理实例与主体实例各自运行并隔离凭证和工具范围。

消息接收、实际注意、行为采纳、唯一发送及认知回流分别由自己的所有者记录。普通聊天中的“记住/忘记”不授予认知管理权限。Social、语言惯例、Motivation 和 Pursuit 随后按完整功能接入；不能将旧 AIRuntime 或已有 Foundation 库视为这些能力已实现的证明。

实施范围与实际验证要求见 [活动计划](../../project/plans/qq-continuous-subject.md)。长期职责、生活与认知语义由 Architecture-Vault 的[共享合同](https://github.com/Heptalogos-Devs/Architecture-Vault/blob/main/docs/integration/cognition-agency.md)与[目标设计](https://github.com/Heptalogos-Devs/Architecture-Vault/blob/main/docs/Heptalogos/TARGET_DESIGN.md)维护。
