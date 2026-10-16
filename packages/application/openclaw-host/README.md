# Heptalogos QQ 原生渠道

此包为独立 OpenClaw 提供 QQ Channel，负责 OneBot 连接、协议解析、历史和媒体适配。消息、身份、活动、行为采纳和实际回执归 Heptalogos Host；认知仍使用同一 Nous 集成。插件不启动另一套 Agent Runtime。

OpenClaw 2026.9.1 由 Nous 正式安装器提供，作为外部 peer，不打进 Product Host。现有私密连接文件保持 `{url, token, accountId}`；配置只引用文件，日志不输出凭据或签名媒体 URL。

Host 的当前接收和效果授权在原生接纳及实际发送前再次检查。普通插件配置不能增加收件人或操作权限。文字使用 OneBot 原生 text segment，类似 CQ 码的文字也不会被当作命令。`ws.send` 之后无法确认的结果保持 uncertain，不自动重发。

## 构建与安装

先使用 Nous 正式安装器准备运行目录，再在本包运行：

```sh
node scripts/prepare-sdk.mjs /absolute/path/to/official-runtime
```

该命令核验实际 SDK 的受控补丁，只调整生成的开发依赖链接。仓库的 `openclaw-host:build` 和 `openclaw-host:pack` Nx target 构建独立 tarball。包内含实际生成的 Gateway Client，安装时不依赖未发布的 workspace 包。

插件声明 `nousNativeState` 中的接收队列和原子键值存储能力，由 Nous 正式受控安装入口核对安装归档、npm 身份及实际文件后授予。普通配置不能自授原生存储权限，也不能冒用官方插件来源。

## 接收、媒体与恢复

实际下载的字节计入原生持久原子存储，按账号和 UTC 日期累计；重新连接或进程重启不会重置当日预算。实时接收先于历史补拉，历史游标及 limited/gap 覆盖由 Messaging 保存。受保护的转发继续读取信息不进入普通消息正文。

当前原生渠道支持文字、媒体和回复，不支持编辑、撤回、表情反应或群管理。只观察的群即使被模型工具、子 Agent 或排程命名，仍不能通过发送入口产生效果。

## 验证

隔离验证使用真实 SDK custody、路由、SQLite 接纳、网络不确定结果和独立安装加载。它们不证明实际 QQ 登录、所有媒体编解码能力或收件人可见的真实投递；这些需要在正式安装后分别验证。

正式配置以 `hostAnchorRoot` 指向已绑定安装，Client 每次请求复用公开 discovery 核对实际 boot 与 loopback 地址。SubjectGateway 启动前的 prepare CLI 使用同一 reader 更新正式 Nous `hostBridge.origin`；服务依赖原 Host 生命周期，重启后重新建立运行许可。

`heptalogos-qq-dispatch` 从 stdin 接收 Host 已预登记的原生 agent 参数，使用正式 SDK 执行单次派发并等待实际终态。配置、状态和凭据沿该原生实例的环境提供，命令行不携带消息或密钥；未知结果不自动重试。

Native discovery/request registries may register another Channel object while the actual account is already running. QQ resolves that account through the public SDK named runtime store, scoped to installation/account, rather than a registration-local delivery closure. Startup claims synchronously before awaiting prerequisites; another lifecycle cannot create a parallel sender. Shutdown disables new adapter use while draining and releases only its own lifecycle identity. Custody and Host begin/record remain on the original message adapter.

## Activity Life 工具

`heptalogos_life` 只在 Host 为实际 agent RPC 附上 `toolBindings.heptalogos = { nativeRunId, activityRef }`，且当前 SDK factory 提供真实 agent/Session 时注册。`inspect` 返回本次已采纳 Activity 的 revision、world、进展和下一处理点；`progress` 只接收主体自身 note、expectedRevision、mode 与下一 world point。身份、授权、来源和成果引用不进入模型参数。Host 检查当前原生 run、已接纳 contact、Activity/Pursuit 与 operator 工具权限；进展引用只取本次真实来源和已提交反馈，note 明确标为主体陈述。

工具需要 operator 和 Activity 同时明确授权 `heptalogos_life`。改变 mode 不完成或暂停当前 Activity，当前 run 可以正常结束。rest 在下一处理点到期前不读取新来信；到期时 Life 以同一 world 与 revision CAS 转回 work，再由既有原生 opportunity 入口继续。wait 保留来信注意语义，也可按已保存下一点继续。模型工具不取得管理或发送权限。
