# 管理宿主与客户端

管理 owner、HTTP 和客户端分别承担语义、传输和使用体验。Product Host 直接组合安装、私有 PostgreSQL、持久化、配置、管理员鉴权和正式 SDK，不再通过 RuntimeKernel/DBOS/旧 Subject Executor 启动管理。

```text
CLI / TypeScript Client
  → Host HTTP / generated OpenAPI
  → Authentication + ProductManagement
  → owning Configuration / Nous official Client

Linux CLI lifecycle → installer-owned systemd units
Independent maintenance Gateway → normal management API or authorized machine operations
```

schema 在 management，Host 生成唯一 OpenAPI，Client 保留生成请求/响应类型。Node local adapter 核对 locator、endpoint 和实际 discovery 后选择该安装的 keyring。普通聊天与服务调用不取得管理员身份。

配置和 Subject 绑定是持久产品事实，依赖探测是当下观测，不能合并成一个 ready 布尔。Nous 保持长期认知 Authority；Host 的 Subject 操作使用同一正式 Client，不复制 Seed、Memory 或 Self。

安装初始化使用锁和原子发布，既有 roots 与 identity 保留。systemd 是 Linux 进程监督者；模型/工具循环属于独立 OpenClaw。当前 Gateway 槽未配置时明确不可用，Host 和 CLI 仍能运行。

精确操作、错误及 Authority 见 [管理 Spec](../../specs/management/system-authority.md)，实际命令见 [CLI](../../packages/application/cli/README.md)，部署和验证边界见 [Host](../../packages/application/product-host/README.md)。未来 QQ、生活与行为能力扩展各自 owner，并由同一管理表面呈现，不恢复旧通用计划平台或第二个模型运行时。
