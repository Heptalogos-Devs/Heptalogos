# 外部集成

Heptalogos 使用独立安装的 Nous 官方 Client 与正式 OpenClaw 插件。Nous 保存长期认知；OpenClaw 原生循环调用模型、工具、浏览器和子 Agent，持有渠道 durable ingress/send。Host 拥有身份、消息事实、活动、行为采纳与实际回执。架构见 [认知集成](../architecture/cognition-integration.md)。

## 模型与维护

模型入口和发送语义以正式安装版本为准。当前产品不经过旧 AIRuntime/proposal-only 主体链或固定第二次 Expression；仓库中独立库的存在和测试不表示已被产品消费。外部模型网关仍独立运行，既有配置、渠道、上游凭据和历史应保留。

主体与机器维护使用不同 OpenClaw profile、工作目录、状态、端口、秘密和权限。主体工具不能读取管理目录或原始 OneBot 凭据，也不能直接控制已登录 QQ 页面绕过正式 Channel。普通聊天不授予维护权限。

## QQ 与媒体

第一方 Channel 从 Host 获得当前账号及会话接收/观察/外部效果范围。入站先保全原始协议引用，再接纳去重的消息或平台事件；历史和实时使用同一个稳定身份。媒体和 forward 在有界工作中处理，原文接触与后续解释分别记录。

Host 的服务 API 使用独立机器凭据，覆盖身份、Messaging、受保护原始资料、流式媒体上传和 Agency；它不能接受管理员登录会话代替服务凭据。普通消息材料读取剥离原始 envelope、下载凭据和受保护 sourceRef。发送前由 Host 与实际 adapter 核对当前权限。

FFmpeg 和媒体类型识别由实际媒体适配使用；安装、资源限制和真实资源链路必须单独验证，不能仅凭检测到命令就宣称转录或视频理解可用。

## 安装边界

OpenClaw 通过 Nous 正式 installer 安装固定版本并 prepare 所需原生入口。Heptalogos 消费同一个可独立安装的插件，不复制认知。Host 管理应在 Nous、模型或 QQ 不可用时仍能查询状态与停止服务；库构建、fixture 和 readyz 不证明真实 QQ 已上线。

操作入口见 [外部集成参考](../reference/external-integrations.md) 和 [宿主安装运行说明](../../packages/application/product-host/README.md)。运行命令以实际 CLI 和生成管理合同为准。
