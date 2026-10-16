# Heptalogos 无图形管理宿主

Product Host 直接组合安装与 PostgreSQL 生命周期、持久化、配置、管理员鉴权及管理 HTTP。它不启动模型、Nous、QQ 或通用运行图；这些依赖不可用时，管理仍能使用。正式接口见 [管理合同](../../../specs/management/system-authority.md)，操作入口见 [CLI](../cli/README.md)。

## 职责与边界

宿主保存本产品配置和 Subject 绑定，组合 Identity、Messaging、Life、Agency 和原生认知桥的正式服务接口，通过可独立安装的 Nous 官方 Client 读取实际认知服务、查询或创建 Subject。认知、Seed、Memory、Self 均由 Nous 保存。创建 Subject 不覆盖已有绑定，也不调用模型形成默认人格。

Fastify 路由消费管理 owner 的 schema，生成 `generated/management.openapi.json`，再生成 ManagementClient。CLI 不读取产品数据库或复制业务规则。管理员密码使用既有 Argon2id，opaque session 仅保存摘要；本机 CLI 将会话秘密放进 OS keyring。

`initializeProductInstallation` 是安装器、`heptalogos-host init` 与 Windows portable launcher 共用的初始化入口。初始化有互斥及原子发布，既有 identity 和显式 lifecycle roots 不被重写。Host 使用当前所有权和短事务；关闭时停止接纳、等待有限在途工作并关闭自有 PostgreSQL。

## Linux 独立安装

构建需要 Node 24.21.0、pnpm 11.24.0，以及 Nous 发布的 Client tarball。当前开发依赖使用同级 `Nous-Wave/data/releases/client/` 中内容固定的正式 Client 归档，实际文件名由本包 `package.json` 与 lockfile 指定；它是正式构建输入。安装产物会内置该 tarball 及生产依赖，不依赖源仓目录。

```sh
pnpm nx run product-host:prune
pnpm nx run cli:prune
node scripts/package/install-linux-product.mjs \
  --target /absolute/path/heptalogos \
  --node-root /absolute/path/node-v24.21.0 \
  --postgres-root /absolute/path/postgresql-18.6
```

安装器只接受新目录，复制私有 Node 与完整 PostgreSQL 工具链、Host/CLI 闭包，初始化分开的生命周期目录并注册该安装唯一的 systemd 用户服务。不会替换现有数据目录。安装后从任意 cwd 使用 `bin/heptalogos`。独立 Subject/maintenance Gateway 的槽尚未配置时明确显示 `unconfigured`；不能将管理可用当作 QQ 或模型已经上线。

Windows 保留 portable 初始化及前台 Host 入口。Linux 的 systemd 运行结果不证明 Windows 实机部署；参见 [装配脚本](../../../scripts/package/assemble-portable-product.mjs)。

## 更新既有 Linux 安装

先构建同样的 Host/CLI 安装闭包，再运行更新器：

```sh
node scripts/package/update-linux-product.mjs --target /absolute/path/heptalogos
/absolute/path/heptalogos/bin/heptalogos start
```

更新器先准备独立程序代际，再停止原 Host 和其 PostgreSQL，将现有状态、配置、秘密及材料复制到本安装 BACKUP 并检查数据库控制文件，最后选择新程序。安装身份、Subject 绑定、私有运行时和 OS keyring 会话继续使用。更新完成保持停止，由公开 CLI 启动后核对实际管理与渠道状态。替换程序和保存备份不能代替数据库及渠道的实际恢复验证。

## 渠道服务

QQ 插件使用独立的 `SECRET/channel-service-token` 访问同一 Host 的服务接口；管理员会话继续使用管理入口。服务接口消费语义 owner 的 schema 并生成 Client。原始协议 JSON 保存在受保护 archive，媒体完整流式上传到 CAS；普通消息读取只提供授权材料和已保存的媒体状态。具体 QQ 运行入口见 [原生渠道包](../openclaw-host/README.md)。

启动时仅恢复本地 Activity 与发送不确定状态，随后开放管理。实际原生模型输入由 Host 预登记的运行 ID、提示摘要、当前活动和 scope 绑定；相同提示可在 RESET 后的新运行重新登记，旧运行不能改绑。子 Agent 交接使用真实父运行 ID；实际结果先保全，再沿原 scope 提交 Nous。

## 已采纳 Activity 的单次派发

可信服务入口 `/gateway/v1/activity/dispatch` 选择已 active 的 Activity、一个 canonical 目标会话及最多 64 个实际消息引用。它只读当前目标的已授权材料，复用 Activity 现有 Nous WorkContext，并先保存原始输入，再调用安装提供的 `dispatchNativeActivity` 适配器。公开 schema 见 `activity-dispatch-contracts.ts`，精确语义见 [主体合同](../../../specs/subject/subject-base.md)。普通 QQ 消息不能调用此入口授予权限。

Host 默认适配器读取本安装 `installation-services.json` 的 Subject 身份、根目录和显式 env 文件路径，调用同一独立原生包的 `heptalogos-qq-dispatch` SDK 入口。消息和调用参数走 stdin，Gateway 密码只进入子进程环境；Host 不另建模型循环。SDK 终态保留原始结果，`completed` 表示 RPC 已结束，实际发送以 Agency 和平台回执为准。

当前要求 Activity 的工具为空，与原生生产 denyall 配合。原生服务未配置时返回明确状态；SDK 失败或无法确认时保留 uncertain，重复 requestId 不再次调用。Host 停止或进程超时时终止本地调用进程。实际安装仍须核对模型输入、最终 QQ 回执和结果回流。

## 验证

运行 product-host 构建、聚焦测试、OpenAPI 生成检查，以及安装后的公开 CLI/API。实际安装检查包括认领、登录、配置冲突、管理在依赖离线时可用、正常 stop、重启保持身份与配置、端口释放。QQ、媒体、模型和主体活动必须各自经过真实使用，不能由这些管理检查推定。
