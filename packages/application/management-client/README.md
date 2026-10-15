# Heptalogos ManagementClient

便携的 TypeScript/fetch 客户端，由 Product Host 的 OpenAPI 生成，再通过小型 facade 暴露正式操作。协议与业务含义见 [管理合同](../../../specs/management/system-authority.md)。

公开操作覆盖 discovery、管理员认领/登录/注销、产品状态、配置 describe/get/check/set，以及 Subject show/bind/create。请求和响应类型来自生成产物，不维护第二份 DTO。`signal` 将调用方取消传到实际 HTTP 请求；客户端错误保留稳定 Problem 和 HTTP 分类。

根入口没有文件系统、数据库、Host 或原生 keyring 依赖。Node 专用 `./node` 入口读取安装 locator 和 Host endpoint，检查 locator、endpoint 与实际 discovery 的安装身份一致，之后才选择对应的 keyring 会话。错误安装的 endpoint 在发起网络请求前被拒绝。

生成链是 owning schema → Host HTTP → `generated/management.openapi.json` → Client。生成文件不能手改。使用 `pnpm nx run management-client:generate` 更新，`generate:check` 检查漂移；运行该包测试与 type-aware lint。
