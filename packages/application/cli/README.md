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

start/stop/restart 不依赖 Host API 在线，停止使用有限 systemd grace。maintenance 的独立 unit 不随 Host stop 一起关闭；未配置时 status 返回 `unconfigured`，启动返回具体下一步。Linux 安装器提供 `configure-maintenance`：先用同一正式 Nous installer 将独立 OpenClaw 安装到 `<anchor>/runtime/openclaw-maintenance`，再显式给出既有受保护 env 文件、原生模型 profile 和 provider/model。维护配置固定在 descriptor maintenance.CONFIGURATION/openclaw.json，已有配置、密码和状态保留；新 profile 禁用所有插件/QQ/Nous cognition、cron 和 heartbeat，只作为本机 operator 助手。模型凭据只引用原 env 文件，不复制密钥。

```bash
node scripts/package/install-linux-product.mjs configure-maintenance \
  --target <anchor> --environment-file <existing-private-env> \
  --source-profile <existing-native-profile> --model <provider/model> \
  --port <independent-loopback-port>
```

安装器返回实际 origin；让 ProductSettings.maintenanceGateway.origin 与该独立端口一致。随后使用已安装的 `heptalogos maintenance start/status/stop/restart`。维护 unit 没有 Host Requires/PartOf 或 Subject prepare/discovery 依赖；配置成功不等于模型可用，实际健康与任务由公开 native RPC 验证。

`--json` 保持机器可读输出。参数错误为 exit 2，认证/权限错误为 3，连接或安装缺失为 4，合同不符为 5，冲突为 6，服务端错误为 7，前台取消为 130。取消后需按操作身份核对已提交变更，不假定远端事务回滚。

精确合同见 [管理](../../../specs/management/system-authority.md)，安装和生命周期边界见 [Host](../product-host/README.md)。验证应从独立安装运行完整认领、登录、配置、启停与恢复，不能只运行源码入口。

## 活动、注意与主动追求

这些命令仍是确定性的 schema-generated Client 投影。必须先以本机管理员登录；CLI 会验证 OS keyring 会话，再从同一安装的受保护 SECRET 读取 Gateway 服务凭据，凭据不进入 argv 或输出。普通 QQ 工具没有这些宿主凭据，不能据此自授管理权限。

```sh
heptalogos life list --stdin --json < life-list.json
heptalogos life get --stdin --json < activity-id.json
heptalogos life propose --stdin --json < activity-proposal.json
heptalogos life adopt --stdin --json < activity-adoption.json
heptalogos life transition --stdin --json < activity-transition.json
heptalogos life progress --stdin --json < activity-progress.json
heptalogos life attention --stdin --json < attention-opportunity.json
heptalogos life dispatch --stdin --json < exact-activity-dispatch.json
heptalogos pursuit list --stdin --json < pursuit-list.json
heptalogos pursuit get --stdin --json < pursuit-id.json
heptalogos pursuit adopt --stdin --json < pursuit-adoption.json
heptalogos pursuit evaluate --stdin --json < actual-evidence.json
heptalogos pursuit recheck --stdin --json < pursuit-id.json
heptalogos pursuit transition --stdin --json < pursuit-transition.json
heptalogos pursuit reconsider --stdin --json < revised-condition-adoption.json
heptalogos pursuit history --stdin --json < pursuit-history.json
```

列表请求为 `{"subjectId":"<实际 UUID>","states":[],"limit":50}`，可带上一页 `nextId` 作为 `afterId`。单个活动为 `{"subjectId":"<实际 UUID>","activityId":"<实际 UUID>"}`；单个 Pursuit 用 `pursuitId`。历史请求另需 `limit`，可用上一页 `nextRevision` 作为 `afterRevision`。这些请求仅查询 owner，不触发模型。

变更请求必须显式提供 schema 要求的 operationId/requestId、对象 ID、expectedRevision 和实际授权；CLI 不自动读取并替换 CAS，不生成目标或推断权限。`dispatch` 是明确的原生执行请求，只接受已采纳 Activity 和真实 messageRefs，可能实际调用模型及已授权发送；它不是只读查询。Pursuit 评价只接受实际 evidenceRefs，不能提交 truth/complete 或自由 evaluator。返回值、冲突、来源撤回、UNKNOWN/覆盖与历史全部由既有 owner 决定；CLI 不读数据库或重实现评价规则。

所有命令支持 `--help` 与 `--json`，错误/取消退出码沿用上文。Gateway 凭据失效不删除已经验证的管理员 OS keyring 会话；管理会话本身失效仍需重新登录。
