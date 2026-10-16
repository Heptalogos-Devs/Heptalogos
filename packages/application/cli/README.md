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

## 世界、生活与陈述

这些命令复用上述管理员登录、当前安装 discovery 和受保护 Gateway 凭据。普通查询使用明确参数；复杂世界采用或事件实现从 JSON 文件/标准输入读取。下面的 ID、域及时间须替换为实际值，创建人物或世界不会更换当前 Subject。

```sh
heptalogos world actor-resolve --subject-id <subject> --world-id <world> --actor-key math-teacher --json
heptalogos world configure --file world-request.json --json
heptalogos world read --subject-id <subject> --world-id <world> --json
heptalogos world prepare --subject-id <subject> --world-id <world> --json
heptalogos world query --subject-id <subject> --world-id <world> --domain <time-domain> --from 2026-10-16T00:00:00Z --to 2026-10-16T12:00:00Z --view subject --json
heptalogos world coverage --subject-id <subject> --world-id <world> --domain <time-domain> --from 2026-10-16T00:00:00Z --to 2026-10-16T12:00:00Z --json
heptalogos world history --subject-id <subject> --world-id <world> --limit 20 --json
heptalogos world actors --subject-id <subject> --world-id <world> --entity-ref <canonical-entity-ref> --json
heptalogos world advance-rules --subject-id <subject> --world-id <world> --domain <time-domain> --from 2026-10-16T00:00:00Z --to 2026-10-16T03:00:00Z --json
heptalogos world advance --subject-id <subject> --world-id <world> --activity-id <adopted-activity> --request-id <uuid> --json
heptalogos narrative claims --subject-id <subject> --conversation-ref <canonical-conversation> --limit 20 --json
heptalogos narrative explain --subject-id <subject> --message-id <actual-platform-message-id> --json
```

`configure` 接受所属 schema 的完整 `{operationId,expectedRevision,definition,schedule}`；`realize --file patch.json` 接受完整 WorldPatch 请求。二者也支持 `--stdin`，文件/输入上限65536字节。CLI保留调用者的operationId、expectedRevision和真实来源；重试同一操作使用同一身份，不自动生成新请求。世界本人actor必须是当前Subject正式self Entity，NPC先由`actor-resolve`取得world-scoped EntityRef；同名真实QQ账号不会合并。

`read` 返回定义与当前计划；`prepare` 是受保护世界作者frame及下个自然节点，查询本身不调用模型。`query` 返回生活事件/见闻，`--view world_author`仅供管理者检查完整世界；`--after-event-id`使用返回的nextEventId分页。`history`返回不可变world state revision，使用nextRevision作为`--after-revision`，它与事件时间线分别查询。

`query --knowledge-at <world-time>`限定故事内知情；`--as-recorded-at <real-UTC>`限定数据库当时实际持有的记录，二者可以同时使用。`coverage`按真实采用段报告complete/limited/gap；钟已前进不会自动变成生活已实现。

`advance-rules`只实现已采用fixed规律的到期段，choice保留给实际选择；`advance`触发正式内部世界机会，可能调用已配置world/主体角色并按已授予范围继续行为。两者均写产品状态，不是只读诊断。实际角色链、Nous接触和原生scheduler需要Host安装组合完成；CLI或API存在不证明独立安装和真实模型已经验收。

`narrative claims`可用`--status adopted|expressed|uncertain|not_sent`和`--after-claim-id`分页，或以`--domain/--from/--to`限定所指时段。`explain`按实际平台message ID读取Claim与真实回执关联。两项均只读，不提供提交review、伪造Claim或改写已发言记录的操作。
