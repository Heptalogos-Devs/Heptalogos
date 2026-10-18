# Heptalogos 无图形管理宿主

Product Host 直接组合安装与 PostgreSQL 生命周期、持久化、配置、管理员鉴权及管理 HTTP。它不启动模型、Nous、QQ 或通用运行图；这些依赖不可用时，管理仍能使用。正式接口见 [管理合同](../../../specs/management/system-authority.md)，操作入口见 [CLI](../cli/README.md)。

## 职责与边界

宿主保存本产品配置和 Subject 绑定，组合 Identity、Messaging、Life、Agency 和原生认知桥的正式服务接口，通过可独立安装的 Nous 官方 Client 读取实际认知服务、查询或创建 Subject。认知、Seed、Memory、Self 均由 Nous 保存。创建 Subject 不覆盖已有绑定，也不调用模型形成默认人格。

Fastify 路由消费管理 owner 的 schema，生成 `generated/management.openapi.json`，再生成 ManagementClient。CLI 不读取产品数据库或复制业务规则。管理员密码使用既有 Argon2id，opaque session 仅保存摘要；本机 CLI 将会话秘密放进 OS keyring。

`initializeProductInstallation` 是安装器、`heptalogos-host init` 与 Windows portable launcher 共用的初始化入口。初始化有互斥及原子发布，既有 identity 和显式 lifecycle roots 不被重写。Host 使用当前所有权和短事务；关闭时停止接纳、等待有限在途工作并关闭自有 PostgreSQL。

## Linux 独立安装

构建需要 Node 24.21.0、pnpm 11.24.0，以及 Nous 发布的 Client tarball。当前依赖使用仓内 `vendor/nous-wave/` 中未经改写的正式 Client 归档，来源提交和 SHA 见该目录 manifest，实际文件名由本包 `package.json` 与 lockfile 指定。安装产物会内置该 tarball 及生产依赖，不依赖源仓目录。

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

所有源码检查完成后，最后一次构建/剪枝并装配到独立 candidate 目录；核验后保持该目录不变，再运行更新器：

```sh
pnpm nx run product-host:prune
pnpm nx run cli:prune
node scripts/package/assemble-portable-product.mjs \
  --target /absolute/path/frozen-portable-product \
  --node-root /absolute/path/node-v24.21.0 \
  --postgres-root /absolute/path/postgresql-18.6
node scripts/package/update-linux-product.mjs \
  --target /absolute/path/heptalogos \
  --candidate /absolute/path/frozen-portable-product
/absolute/path/heptalogos/bin/heptalogos start
```

更新器只消费已完成装配与核验的冻结 candidate：artifact manifest v2 中的 Host/CLI component digest 绑定实际依赖闭包，复制前后均核对；不重新读取 Nx/pruned dist 或执行 pnpm；v1 candidate 保全后从正式输入重新装配，不猜测旧 digest。Linux installation manifest 同步前向更新为 v2，Bootstrap locator 与 service descriptor 的 v1 身份合同不变。相同源码 generation 的错误安装字节也经正常冷备份修复，原 payload 一并保全。更新器先准备独立程序代际，再停止原 Host 和其 PostgreSQL，将现有状态、配置、秘密及材料复制到本安装 BACKUP 并检查数据库控制文件，最后选择新程序。安装身份、Subject 绑定、私有运行时和 OS keyring 会话继续使用。更新完成保持停止，由公开 CLI 启动后核对实际管理与渠道状态。替换程序和保存备份不能代替数据库及渠道的实际恢复验证。

## 渠道服务

QQ 插件使用独立的 `SECRET/channel-service-token` 访问同一 Host 的服务接口；管理员会话继续使用管理入口。服务接口消费语义 owner 的 schema 并生成 Client。原始协议 JSON 保存在受保护 archive，媒体完整流式上传到 CAS；普通消息读取只提供授权材料和已保存的媒体状态。具体 QQ 运行入口见 [原生渠道包](../openclaw-host/README.md)。

启动时仅恢复本地 Activity 与发送不确定状态，随后开放管理。实际原生模型输入由 Host 预登记的运行 ID、提示摘要、当前活动和 scope 绑定；相同提示可在 RESET 后的新运行重新登记，旧运行不能改绑。子 Agent 交接使用真实父运行 ID；实际结果先保全，再沿原 scope 提交 Nous。 原生持久终态可用精确 completion recovery 将 uncertain custody 收敛为原终态，不重新执行 worker；旧 handoff 与直接 RoleRun 的父关系均由 Native owner 核验，查看结果不改写原注册。

## 已采纳 Activity 的单次派发

可信服务入口 `/gateway/v1/activity/dispatch` 选择已 active 的 Activity、一个 canonical 目标会话及最多 64 个实际消息引用。它只读当前目标的已授权材料，复用 Activity 现有 Nous WorkContext，并先保存原始输入，再调用安装提供的 `dispatchNativeActivity` 适配器。公开 schema 见 `activity-dispatch-contracts.ts`，精确语义见 [主体合同](../../../specs/subject/subject-base.md)。普通 QQ 消息不能调用此入口授予权限。

Host 默认适配器读取本安装 `installation-services.json` 的 Subject 身份、根目录和显式 env 文件路径，调用同一独立原生包的 `heptalogos-qq-dispatch` SDK 入口。消息和调用参数走 stdin，Gateway 密码只进入子进程环境；Host 不另建模型循环。SDK 终态保留原始结果，`completed` 表示 RPC 已结束，实际发送以 Agency 和平台回执为准。

逐 Activity 工具使用正式 native boundary v5 的模型集合过滤和强制执行前授权；实际能力仍受原生工具策略及 OS 沙箱限制。原生服务未配置时返回明确状态；SDK 失败或无法确认时保留 uncertain，重复 requestId 不再次调用。Host 停止或进程超时时终止本地调用进程。实际安装仍须核对模型输入、最终 QQ 回执和结果回流。

## 验证

运行 product-host 构建、聚焦测试、OpenAPI 生成检查，以及安装后的公开 CLI/API。实际安装检查包括认领、登录、配置冲突、管理在依赖离线时可用、正常 stop、重启保持身份与配置、端口释放。QQ、媒体、模型和主体活动必须各自经过真实使用，不能由这些管理检查推定。

Native cognition requires `captureObservedStamp(subjectId)` from the official Subject clock. It captures outside the write transaction and freezes the first actual message, tool/result-release or delivery encounter; retries reuse the stored observation. Realized-world contacts instead retain their typed `worldRealized.worldObserved`, with exact world/event/revision and actor-visible event scope checks.

The single-connection owner integration test can also cross the actual Nous boundary when `HEPTALOGOS_TEST_NOUS_RUN_ROOT` names an independently started temporary official Core installation. It checks canonical WorldLife events, first-contact clock capture, real Observation ingestion and replay after clock advancement; it makes no model or channel call.

Host按正式RoleBinding调用独立原生world/deliberation/execution/render/review，使用官方Nous投影；Activity dispatch先采用主观选择，只有明确表达意图才建立renderer brief。无QQ的世界机会和新学习Activity使用内部audience；工具和发送权限由实际Activity及当前安装配置决定。重入优先读取保留的付费结果和release receipt，执行结果须显式释放后才成为主体接触。角色工具、完整输入/输出token及连续阶段期限经过正式native控制。

Reactor 的目标解析只接受当前 SituationFrame 列出的精确对象 handle 或公开 sourceRef，随后核对对象动作及现有 owner 权限。只观察会话不展示 communicate；未知目标和歧义将具体问题与可选动作保存在既有 Activity 继续信息中，供下一正常机会考虑，参见 [Reactor 合同](../../../specs/subject/reactor.md)。

已采纳 Task 在自身获准会话内打开和读取材料会保留原 Activity、WorkContext、目的、来源和工具范围。当前听众取自仍获准的打开视图或唯一观察会话；多会话未打开时为 internal，不从 WorkContext 的隐式约束键取得听众或权限。

Feedback 重放按首次 canonical Observation envelope 核对原 Contact/native 身份与实际事件事实，并返回原 envelope；后来的 Contact scope 或 SDK 诊断字段不改写历史用途、接触时间或事实摘要。未知 context 与原有 audit 矛盾仍拒绝，新的 provider/tool 输入及结果显式释放继续经过当前权限 owner。

Custody promotion 可保留同一事件的既有 committed receipt 行；只有完整原身份/envelope 一致且 receipt 已提交时，它才是合法历史副本。重放保留原 receipt、返回 retained-only envelope，不再次提交 Nous；未提交或内容矛盾的双表记录仍拒绝。

同一已采纳 Task/WorkContext 跨 Reaction 承接实际已见材料时，Host 只读取同 Contact 的正式 admission 与实际 provider 完成反馈。每次按当前来源集合、听众和 observe grant 重查，恢复 exact occurrence roots；不把 Activity 继续文字、旧投影摘要或聚合 epistemic entry 作为权限。既有派生材料由官方 Material 元数据核对原 artifact/source-region lineage 后作为 currentSources 选择，不能凭历史 derived ID 授权，也不重新观察或解码。

安装默认只注册供人工启动的systemd服务，不启用开机启动；需要时显式传`--autostart yes`。`configure-subject-gateway`和`configure-maintenance`同样接受`--autostart yes|no`，省略时保留实际systemd选择。安装/升级不启动模型，普通服务启动或配置保存不请求Reactor机会。自动工作暂停时管理Host可独立运行。

认证的`GET /v1/overview`、`GET /v1/subject/documents`和`GET /v1/calendar`提供同一生成Client/CLI使用的零模型读模型，查看不推进生活或索引。`GET /v1/tasks/:activityId`读取绑定主体原任务的角色登记；默认隐藏输入，显式inputs=true读取一项已接纳运行的实际provider尝试和宿主prompt。Native原生记录保留最终body、usage和结果，历史缺口及费用保留未知。`GET /v1/calendar/template`纯读可选时间骨架。总览读取Nous生效维护开关；soul导出不创建人格或第二份认知。

编译/prune输出保持在各dist；安装器在tmp/product-artifacts中物化生产闭包，冻结产物从该闭包发布。打包不向编译输出安装node_modules，避免API生成和源码构建误读旧部署模块。
