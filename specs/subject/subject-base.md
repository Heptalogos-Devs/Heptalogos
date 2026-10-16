# 主体绑定与 Product Activity

## 所有权

Nous 是 SubjectId、可选 Seed、Memory、Self、Social 和认知生命周期的唯一所有者。Heptalogos 管理配置只引用一个现有 SubjectId；创建主体经官方 Client 执行，允许无 Seed，创建不自动替换当前绑定。运行中的绑定及 Nous 来源必须先停用再替换。

Host 重启、模型变化、QQ 重新登录或新增账号不会产生另一个主体。Host Identity 另有稳定的 `entity:heptalogos:<UUID>`，真实协议账号绑定到该 Entity；昵称和群名片不建立身份关系。

## 活动

`packages/product/subject` 的 Life 拥有 Activity。正式字段与操作以 [contracts.ts](../../packages/product/subject/src/contracts.ts) 为准：目的、明确世界与时间窗、实际来源及 WorkContext、提出者、采纳者、采纳权限、状态、实际进展、下一机会和中断条件。

状态为 planned、active、paused、completed、cancelled、failed。提案按 operationId 幂等；采纳保存实际 actor 与范围，必须是当前安装权限的子集。未采纳提案不能启动。生命周期和进展更新核对 expectedRevision，终态不能恢复。取消、完成或失败保留已经产生的成果和具体行动事实。

start/resume 必须核对活动世界与当前正式时钟、时间窗；域不同不能直接比较数值。世界时间由 Nous 的正式时钟提供，Host 持久记录时间与网络超时仍采用现实时间。

进展只保存后续有用的实际来源、文件和结果引用。重启使 active 活动需要重新判断并继续，标记原生进行中运行和发送的不确定性；不会从旧工具步骤自动重放。

## 注意与消息

Messaging 先接纳持久事实；收信不直接等于主体观察，也不自动调用模型。Life 从可信会话信息、直接消息、提及、回复、当前活动、中断条件和等待时间中选择有界注意机会。休息时不选原始消息；等待超限的旧输入先于持续新消息，普通群聊可以在自然节点进入候选。

实际选中的材料才进入正式 Nous Observation 与原生输入。普通聊天提出安排或说“记住/忘记”不能直接修改活动权限、认知管理权限或维护范围。

## 可信原生输入派发

服务凭据入口 `POST /gateway/v1/activity/dispatch` 接收 `requestId`、Subject、已采纳 Activity、canonical conversationRef 和最多 64 个实际 messageRefs，不接收 prompt、来源许可或工具授权。Host 重新检查 active/continuation、当前安装授权、已采纳 observe 范围与 canonical 消息来源及真实原生路由。材料读取只使用目标会话和选中的引用，最多 1 MiB；遗漏、撤回或跨会话选择必须拒绝，不扩大到完整 inbox。

Activity 必须已有同 Subject、open 的正式 Nous WorkContext。实际作者通过 Identity 的真实协议账号解析，平台发生时间和 Host 接收时间分别保留；转述与媒体状态仍来自原材料。只有这些材料进入 contact Observation，工程 prompt 不成为新来源。CognitionUsage 的来源许可为显式目标 origin 和当前 exact WorkContext，不由 audience 字段推导，也不授权其他 anchors。

Activity 的工具由正式 native boundary v4 控制：Host prepare 返回精确 allowedToolNames，模型工具集合先过滤，实际 prepare/execute 两阶段再经 `/nous/v1/tool-execution` 核对同一已 admitted contact、活动与当前 operator scope；撤权、取消或 Host 不可用均不执行。只读认知工具使用私有调用上下文中的 actual usage，不接受模型参数授予权限。Host 在原生 SDK 调用前保存 raw prompt、digest、UUID nativeRunId 及固定参数。`requestId` 唯一绑定该选择，首次 claim 才可调用已有 native adapter；并发或之后重试返回保存状态。RPC terminal 保存实际结果，不能确认的失败保持 uncertain，不自动重派，也不把调用结束当作 Activity 达成。重启留下的 dispatching 需要显式核对，不会取得第二次调用机会。

迁移 `0006_native_dispatch` 只给既有 native input 添加请求唯一索引，保留原消息、活动与原生事实。适配器通过独立 OpenClaw 的公开 CLI 调用 agent/expectFinal；Host 不运行模型循环。

## 当前边界与验证

Life/Agency 已有正式 owner 和 PostgreSQL 迁移；活动 CAS、重启进展、世界域拒绝及取消与发送点的真实锁交错有数据库测试。完整部署还必须接上原生调度、真实工具、QQ 和跨日恢复；内部测试不能替代这些完成条件。

管理身份与进程服务见 [系统管理合同](../management/system-authority.md)，行为采纳与回执见 [行为合同](reaction-behavior.md)。旧 Subject Chat 的表和原数据由迁移保全，当前产品不再使用旧 mailbox/proposal-only/固定 Expression 执行链。

## 原生自然机会接续

服务凭据入口 `POST /gateway/v1/activity/opportunity` 仅接收实际 account/conversation。可信 QQ Channel 在正式事实接纳后及既有连接/历史自然机会调用；接纳完成不等待模型。Host 只选择已明确采纳、active、无需恢复且拥有该会话 observe 的 Activity，复用 Life attention 与现有原生 dispatcher，不自动采纳、不增加权限或运行后台重试 worker。休息、Subject disabled、无合格 Activity、无 observe 的会话均保持安静。

会话 observe 授权允许该会话未来的真实来信；Activity sourceRefs 是来源/认知 anchors，不是未来消息白名单。每次输入仍按真实 canonical conversation、精确 messageRefs/contactRef/externalObjectRef 校验；非 message anchors 仍需显式 scope.sourceRefs。受控 child handoff 继承实际父注册的消息来源，不复制 contact Observation。

每次自然机会最多选择一条持久 pending message；持久 pendingRef+conversation+message 生成稳定 UUID request/nativeRunId，重复机会复用原生持久 claim。进入该 owner 的 completed/uncertain/dispatching 结果后原 pending 完成，由原 native owner 保留回执/不确定性；不重新发送。撤回内容通过 metadata 跳过，不产生 Observation。真实 PostgreSQL 回归覆盖两条在采纳之后的新来信、并发机会、重复机会与撤销 send 后的静默。

观察和发送分别检查：仅 observe 的目标（包括群 1072706649）仍可派发学习/处理，参数固定 `deliver=false`，不附带 channel/accountId/to，不产生外发；结果保留于 Host/Nous。仅 Activity 与当前 operator 都允许该目标 send 时，才使用 `deliver=true` 和准确渠道/账号/目标。同一 Activity 同时包含观察群和测试群时，每次 sourceRead origin 与材料仍仅属于本次目标。底层 Agency/QQ adapter 的发送拒绝保持不变。
