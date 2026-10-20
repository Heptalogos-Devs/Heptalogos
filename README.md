# Heptalogos

> **INTERRUPTED — 开发已暂停（2026-10-20）。** 当前分支保存未完成施工；最新改动尚未整体验证。详见[中断交接](Session-Handoff-2026-10-20-15-28.md)。恢复须等待用户明确指令。

Heptalogos 管理持续主体的世界、生活、注意、交往与行动。独立运行时使用角色素材和近期交往；连接 Nous Wave 后，同一 SubjectId 使用长期认识与实际经历。

当前代码从新 PostgreSQL 数据库启动。业务在 `packages/hept`，正式 Zod 输入在 `packages/contracts`，HTTP 与 CLI 共用 `createHept()`。完整施工依据位于同级 [Specs 快照](https://github.com/Heptalogos-Devs/Nous-Wave/tree/feat/spec-rebuild/docs/construction-specs)。

```sh
corepack pnpm install
pnpm hept init --database postgresql://localhost/hept --data data/hept
HEPT_CONFIG=data/config/hept.toml pnpm hept admin-create --email admin@example.test --password-ref env:HEPT_INITIAL_PASSWORD
HEPT_CONFIG=data/config/hept.toml pnpm serve
```

管理员密码通过所选 SecretRef 提供。`admin-create` 将 CLI API key 写入受限凭据文件；浏览器与服务凭据使用 Better Auth。默认只监听回环地址。

```sh
HEPT_CONFIG=data/config/hept.toml pnpm hept subject create Alice
HEPT_CONFIG=data/config/hept.toml pnpm hept --subject <subject-id> model register examples/model.json
HEPT_CONFIG=data/config/hept.toml pnpm hept --subject <subject-id> settings set examples/settings.json
HEPT_CONFIG=data/config/hept.toml pnpm hept --subject <subject-id> subject start
HEPT_CONFIG=data/config/hept.toml pnpm hept --subject <subject-id> chat '今天想聊些什么？'
HEPT_CONFIG=data/config/hept.toml pnpm hept --subject <subject-id> inbox
```

模型示例的 `credentialRef` 指向环境或受限文件，先按自己的提供方修改端点和模型 ID。配置不带真实凭据。

[当前设计与操作](docs/INDEX.md)说明目录、模型接触、消息、世界与集成。运行检查为 `pnpm verify`；真实数据库轨迹使用 `HEPT_TEST_DATABASE_URL` 指向专用空库。
