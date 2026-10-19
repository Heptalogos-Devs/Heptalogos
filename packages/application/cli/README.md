# Heptalogos 命令行

CLI 是确定性的 ManagementClient 投影；查询不调用模型，明确的执行或机会命令可使原生调度器运行主体。Linux 服务命令使用安装器发布并核对安装身份的 systemd 描述符；不能传入任意 unit 名。普通聊天不获得这些管理权限。

## 先查看当前主体

安装后的命令默认使用该安装绑定的Subject；管理读取不调用模型。

```sh
heptalogos status
heptalogos status --watch
heptalogos status --json
heptalogos subject documents
heptalogos subject documents --import /absolute/path/SOUL.md --reason "明确修订说明"
heptalogos calendar today
heptalogos calendar week
heptalogos calendar template
heptalogos calendar range --from 2026-10-19T00:00:00Z --to 2026-10-20T00:00:00Z
heptalogos task <总览中的任务ID>
heptalogos task <原任务ID> --runs
heptalogos task <原任务ID> --inputs --run-id <原运行ID>
heptalogos task <原任务ID> --resume
```

总览显示实际运行路径与代次、OS自启、自动工作配置、Gateway阻塞、现有任务/保留结果及按角色汇总的已记录token用量。未留存的用量和未核实价格标未知；原生配置中的零价不作为免费依据。总览另外读取Nous生效维护策略，分别显示系统调度与当前Subject的自动维护开关。Ctrl-C只退出watch。没有管理进程时仍显示本地安装/服务状态，不为查询启动服务。

`subject documents`确定性导出IDENTITY、SOUL、RELATIONSHIPS、LANGUAGE、LIFE到安装DATA/subject-documents/<Subject>并返回完整路径。未形成内容显示未形成；Self/Social正文与SDK片段使用同一个Nous域渲染。每条认知的折叠来源中包含`nous-revision`修订块：只编辑其中的`content`，保留原修订、epoch和Subject，再用`--import 文件 --reason 说明`显式提交。导入复用正式Self/Social修订和历史，未改内容跳过；每条独立结果可见，部分失败可沿同一文件和原因继续。再次导出前会将已编辑文件保留到drafts，文件编辑本身不写认知。LIFE的未来安排走Calendar操作。

`calendar template`只预览公开学校时间骨架，不采用课程或身份。`task --runs`按原任务列出实际角色登记及输出问题；`--inputs`明确读取一项原运行的宿主输入与正式Native provider请求，可能包含聊天正文。旧调用没有最终请求记录时保留未知，宿主prompt单列。today/week使用世界时钟和世界时区，无需填写UUID；没有世界时明确显示未配置。任务resume读取新鲜revision恢复同一Activity，不重建任务；自动工作暂停时不启动模型。

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
heptalogos start --component all --json
heptalogos restart --component subject --json
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

安装器返回实际 origin；让 ProductSettings.maintenanceGateway.origin 与该独立端口一致。随后使用已安装的 `heptalogos maintenance start/status/stop/restart`。维护 unit 没有 Host Requires/PartOf 或 Subject prepare/discovery 依赖；实际健康与任务通过公开 native RPC 读取。

`--json` 保持机器可读输出。参数错误为 exit 2，认证/权限错误为 3，连接或安装缺失为 4，合同不符为 5，冲突为 6，服务端错误为 7，前台取消为 130。取消后需按操作身份核对已提交变更，不假定远端事务回滚。

精确合同见 [管理](../../../specs/management/system-authority.md)，安装和生命周期边界见 [Host](../product-host/README.md)。验证应从独立安装运行完整认领、登录、配置、启停与恢复，不能只运行源码入口。

`start/stop/restart --component host|subject|maintenance|all`默认只处理Host，all按组件依赖顺序启停。进程启动、配置保存与自主付费运行分别控制，CLI不在启动后请求模型机会。subject.enabled与已授权预算决定自动工作；安装和Gateway配置默认不打开开机启动，--autostart yes|no显式选择，重配/升级保留原选择。

配置set在Native/Nous停机时仍可提交，保存不触发Reactor机会；原生profile/model/密钥仍归独立OpenClaw配置。config describe显示角色和资源上限，reactor status读取当前有效值。

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

## 入场、日历与 Reactor

新建独立主体后，先显式绑定它，再采用可选 WorldProfile。Seed 与 WorldProfile 分别提供；学生世界示例在 [student-world-profile.json](../../product/subject/examples/student-world-profile.json)。示例中的主体、世界、operationId、规则 UUID、时区及入场时间必须换成实际选择。不要给已有主体自动套用学生身份或倒拨原有时钟。

```sh
heptalogos world clock --subject-id <subject> --json
heptalogos world clock-configure --file clock-request.json --json
heptalogos world profile-adopt --file profile-request.json --json
heptalogos world profile-read --subject-id <subject> --world-id <world> --json
heptalogos world living --subject-id <subject> --world-id <world> --json
heptalogos world calendar --subject-id <subject> --world-id <world> --domain <domain> --from 2026-10-01T00:00:00Z --to 2026-11-01T00:00:00Z --timezone Asia/Shanghai --calendar-view combined --perspective subject --json
heptalogos world calendar-change --file calendar-change.json --json
heptalogos reactor status --subject-id <subject> --json
heptalogos reactor history --subject-id <subject> --limit 32 --json
heptalogos reactor attention --subject-id <subject> --json
heptalogos reactor wake --subject-id <subject> --operation-ref <explicit-operation-ref> --json
```

`clock-configure` 请求为 `{subjectId,operationId,timeDomainRef,rate,worldTime}`，通过官方 Clock 执行明确的管理操作。`profile-adopt` 请求为 `{subjectId,worldId,operationId,expectedRevision,profile}`；Clock 当前域必须匹配 profile 且不早于其入场点。采用后绑定该世界并投影统一机会；设定只有经过实际读取和 NoUS admission 才形成接触，不记成已生活的经历。

`calendar` 支持任意有限区间；`--calendar-view planned|lived|combined` 区分计划与实际，`--perspective subject|world_author|public` 选择知情范围。用返回的 `continuation` 作下一页参数，显示时区不修改原始 recurrence 身份。`calendar-change` 使用 owner 的完整请求，明确 `scope: this|future|unrealized`、`expectedRevision`、`ruleId`、本地 `recurrenceId` 和 `change`。已实现部分保留历史；Profile 内原始课表仅作采用来源，当前课表以日历 owner 为准。

`living` 读取实际采用区间累计的精力、地点和设备视图，查询不推进世界。`reactor status` 显示前台 Reaction、最近实际动作、有效限额、角色绑定和最近机会投影；可带 `--reaction-id` 查看某轮。`history` 用 `nextReactionId` 作 `--after-reaction-id`；`attention` 可带 `--explanation-ref` 读取当时保存的元信息选择。通知的已读状态以实际 open/read 回执为准；worker 结果在明确 release 并经过原生输入 admission 后进入主体情境。

`reactor wake` 只请求一次原生调度机会，随后可能按当前授权调用角色模型。主观决定、工具任务、renderer、review 和实际发送仍走同一正式执行链，查询和管理命令不提供手工写入这些结果的捷径。
