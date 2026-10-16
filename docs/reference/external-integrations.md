# 外部集成参考

当前产品边界见 [外部集成说明](../product/external-integrations.md)。安装和管理命令以各实际软件版本为准；下列链接提供上游资料。

## 模型网关

已有模型网关由操作者独立部署和维护。当前产品调用模型由正式 OpenClaw 实例或 Nous 模型角色执行，其凭据和路由分别留在该软件的私有配置中；Heptalogos 管理配置绑定官方 Nous discovery 与两个独立 Gateway。

现有 NewAPI 的渠道、上游密钥、映射、配额和历史保持原有管理方式。Heptalogos 不复制上游配置，也不使用旧 AIRuntime 配置冒充当前主体模型入口。

- [NewAPI 项目](https://github.com/QuantumNous/new-api)
- [NewAPI API 参考](https://docs.newapi.pro/en/docs/api)

## OpenClaw

使用 Nous 正式 installer 安装和 prepare 固定原生版本；插件合同见 Nous 包说明。主体与维护实例分别管理进程、profile、状态、秘密与工具权限。Heptalogos Host 不在自己的进程中启动另一个 Agent 循环。

- [OpenClaw 项目](https://github.com/openclaw/openclaw)
- [OpenClaw 上游文档](https://github.com/openclaw/openclaw/tree/main/docs)
- [Heptalogos Host 安装与服务](../../packages/application/product-host/README.md)

## 媒体与 QQ

QQ 协议和登录由独立 NapCat 提供，第一方 Channel 只消费明确授权的账号与会话。不要将登录页面、原始 OneBot endpoint 或凭据暴露为普通模型工具。

[FFmpeg](https://ffmpeg.org/) 是实际音视频处理的外部前提；媒体适配须核对当前安装、受控路径、格式与预算。只有实际转录、视频结果及其回流才能证明对应能力可用。

## 验证范围

本机 HTTP/数据库/原生 SQLite fixture 只证明实际触及的合同。真实上线还须使用独立安装的软件、QQ 客户端、实际模型和工具，核对发送、媒体、取消、恢复与同一 Subject 的连续工作。缺登录或缺模型角色时保留准确状态，不能用通用健康检查替代。
