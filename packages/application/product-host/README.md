# Heptalogos 无图形管理宿主

Product Host 直接组合安装与 PostgreSQL 生命周期、持久化、配置、管理员鉴权及管理 HTTP。它不启动模型、Nous、QQ 或通用运行图；这些依赖不可用时，管理仍能使用。正式接口见 [管理合同](../../../specs/management/system-authority.md)，操作入口见 [CLI](../cli/README.md)。

## 职责与边界

宿主保存本产品配置和 Subject 绑定，通过可独立安装的 Nous 官方 Client 读取实际认知服务、查询或创建 Subject。认知、Seed、Memory、Self 均由 Nous 保存。创建 Subject 不覆盖已有绑定，也不调用模型形成默认人格。

Fastify 路由消费管理 owner 的 schema，生成 `generated/management.openapi.json`，再生成 ManagementClient。CLI 不读取产品数据库或复制业务规则。管理员密码使用既有 Argon2id，opaque session 仅保存摘要；本机 CLI 将会话秘密放进 OS keyring。

`initializeProductInstallation` 是安装器、`heptalogos-host init` 与 Windows portable launcher 共用的初始化入口。初始化有互斥及原子发布，既有 identity 和显式 lifecycle roots 不被重写。Host 使用当前所有权和短事务；关闭时停止接纳、等待有限在途工作并关闭自有 PostgreSQL。

## Linux 独立安装

构建需要 Node 24.21.0、pnpm 11.24.0，以及 Nous 发布的 Client tarball。当前开发依赖指向同级 `Nous-Wave/data/releases/client/nous-wave-client-0.1.0.tgz`；它是正式构建输入，不能改成对 Nous 源文件的 import。安装产物会内置该 tarball 及生产依赖，不依赖源仓目录。

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

## 验证

运行 product-host 构建、聚焦测试、OpenAPI 生成检查，以及安装后的公开 CLI/API。实际安装检查包括认领、登录、配置冲突、管理在依赖离线时可用、正常 stop、重启保持身份与配置、端口释放。QQ、媒体、模型和主体活动必须各自经过真实使用，不能由这些管理检查推定。
