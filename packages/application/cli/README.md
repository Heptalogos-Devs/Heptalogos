# Heptalogos 命令行

CLI 是确定性的 ManagementClient 投影，不调用模型。Linux 服务命令使用安装器发布并核对安装身份的 systemd 描述符；不能传入任意 unit 名。普通聊天不获得这些管理权限。

## 安装后使用

独立安装的 `bin/heptalogos` 自动传入安装根，从任何目录均可调用。开发环境直接运行构建后的 CLI 时，需要 `--anchor-root /absolute/installation`。

```sh
heptalogos start --json
heptalogos admin claim --password-stdin --json
heptalogos auth login --password-stdin --json
heptalogos status --json
heptalogos config describe --json
heptalogos config get --json
heptalogos config check --stdin --json < settings.json
heptalogos config set --stdin --json < settings.json
heptalogos subject show --json
heptalogos subject bind <subject-id> --expected-revision <configuration-revision> --json
heptalogos subject create --operation-id <uuid> --memory --self --json
heptalogos services --json
heptalogos stop --json
heptalogos restart --json
heptalogos maintenance status --json
heptalogos auth logout --json
```

密码从受保护提示或 stdin 读取，不放进 argv 或输出。登录成功只输出状态和到期时间，opaque token 存入对应安装的 OS keyring。配置使用完整 JSON 文档；set 读取当前 revision 并提交 CAS，可显式提供 `--expected-revision`。语义和实际字段以 `config describe` 为准。

Subject create 可加 `--seed-file <path> --seed-format markdown|toml`，没有 Seed 就不补写个人历史。`--operation-id` 用于同一创建请求的安全重试；创建不会替换当前绑定。绑定会查询配置的 Nous 实例，不能仅凭格式合法的 UUID 声称主体存在。

start/stop/restart 不依赖 Host API 在线，停止使用有限 systemd grace。maintenance 的独立 unit 不随 Host stop 一起关闭；未配置时 status 返回 `unconfigured`，启动返回具体下一步。当前 Linux 安装器尚未替用户创建可用的维护模型配置，不能将这个状态当作维护助手已上线。

`--json` 保持机器可读输出。参数错误为 exit 2，认证/权限错误为 3，连接或安装缺失为 4，合同不符为 5，冲突为 6，服务端错误为 7，前台取消为 130。取消后需按操作身份核对已提交变更，不假定远端事务回滚。

精确合同见 [管理](../../../specs/management/system-authority.md)，安装和生命周期边界见 [Host](../product-host/README.md)。验证应从独立安装运行完整认领、登录、配置、启停与恢复，不能只运行源码入口。
