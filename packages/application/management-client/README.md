# Heptalogos ManagementClient

便携的 TypeScript/fetch 客户端，由 Product Host 的 OpenAPI 生成，再通过小型 facade 暴露正式操作。协议与业务含义见 [管理合同](../../../specs/management/system-authority.md)。

公开操作覆盖 discovery、管理员认领/登录/注销、产品状态、配置 describe/get/check/set，以及 Subject show/bind/create。请求和响应类型来自生成产物，不维护第二份 DTO。`signal` 将调用方取消传到实际 HTTP 请求；客户端错误保留稳定 Problem 和 HTTP 分类。

根入口没有文件系统、数据库、Host 或原生 keyring 依赖。Node 专用 `./node` 入口读取安装 locator 和 Host endpoint，检查 locator、endpoint 与实际 discovery 的安装身份一致，之后才选择对应的 keyring 会话。错误安装的 endpoint 在发起网络请求前被拒绝。

生成链是 owning schema → Host HTTP → `generated/management.openapi.json` → Client。生成文件不能手改。使用 `pnpm nx run management-client:generate` 更新，`generate:check` 检查漂移；运行该包测试与 type-aware lint。

`createGatewayHostClient` 是同一生成链下的 Channel 服务入口，使用独立 serviceToken。它覆盖当前权限读取、身份、消息与历史覆盖、受保护 raw archive、流式媒体、Life/Agency 和正式 Nous Host bridge。请求与响应仍取自 owning schema；不会从模型参数获取管理员权限。媒体入口消费生成的 Blob/File 类型，Node 可将受控文件作为 Blob 流式上传。

Gateway 仅允许显式 loopback HTTP origin，禁止重定向；实际来源、会话及行为权限在 Host/adapter 的当前状态上核对。此 Client 可用不表示具体安装已配置 Gateway 或 QQ；部署状态由实际安装查询和端到端运行证明。

同一 `./gateway` facade 还覆盖正式 World 日历读取/修改、WorldProfile 采用/读取、LivingState、官方 Clock 的明确管理操作，以及 `reactorStatus/reactorHistory/reactorAttentionExplain/reactorWake`。所有请求和响应来自 Host OpenAPI；CLI 通过同一客户端调用，不能写入伪造的审议、接触、review 或发送回执。配置激活的响应单独返回原生机会投影状态，离线 Native 不阻止配置保存；`projected` 只表示原生调度已接受请求。
