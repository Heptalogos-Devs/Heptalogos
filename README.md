# Heptalogos

Heptalogos 管理持续主体的世界、生活、交往与行动。当前正在按同级 [Specs](../Specs/README.md) 重建基础设施；领域能力继续施工，进度见[当前施工](docs/construction.md)。

产品使用独立 TypeScript 服务与 PostgreSQL 数据库。`createHept` 组合领域与正式 `@nous-wave/platform` 发行包，HTTP 和 CLI 调用相同 owner。Node 24、TypeScript 7、pnpm 12；各包编译到标准 `dist/`，使用 pnpm pack/deploy。

先准备外部空库，并在进程环境配置 `HEPT_DATABASE_URL`。环境变量值由引导 SecretRef 读取；命令行只保存变量名。

```sh
pnpm install
pnpm build
pnpm hept --instance-home /path/to/instance init --database-mode external --database-url-env HEPT_DATABASE_URL
pnpm hept --instance-home /path/to/instance admin-create --email admin@example.test
pnpm hept --instance-home /path/to/instance host start
```

`admin-create` 从受保护交互读取密码，建立真实 Better Auth 管理员并保存本机受限 CLI key。自动化可用 `--password-env VARIABLE` 或 `--password-stdin`。独立机器安装数据库时，选择 `init --database-mode managed`，显式执行 `runtime acquire postgres` 后再运行 `init`；Host 启动不下载运行时。

另一个终端可运行：

```sh
pnpm hept --instance-home /path/to/instance host status
pnpm hept --instance-home /path/to/instance login --email admin@example.test
pnpm hept --instance-home /path/to/instance doctor
pnpm hept --instance-home /path/to/instance subject create Alice
pnpm hept --instance-home /path/to/instance host stop
```

模型与 Provider 通过 `provider create`、`model create`、`settings update` 配置；秘密单独由 `secret create` 登记，配置只引用 SecretRef。`model test` 使用同一实际 SDK、预算、时间捕获、原件与调用账本；金额未知保存为空。`hept.execution` 登记原生 OpenClaw 连接，原生执行、工具、Skills 与历史继续由 OpenClaw 持有。

`time` 提供域、Clock 修订、读钟、捕获、绑定与截止点投影；输入使用正式合同 JSON 文件。`data export/preview/import/purge` 传输主体资料，当前 restore 要求原安装身份。Subject fork 的新时钟与历史来源计划仍待完成，当前入口明确不可用。

[操作与事务](docs/design.md)说明当前 owner；[文档目录](docs/INDEX.md)列出接入说明。`pnpm typecheck`、`pnpm test`、`pnpm build` 是当前检查；真实产品场景以 `HEPT_TEST_DATABASE_URL` 指向专用空库，测试临时目录放工作区 `temp/`。
