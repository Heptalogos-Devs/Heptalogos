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

服务凭据入口 `POST /gateway/v1/activity/dispatch` 接收 `requestId`、Subject、已采纳 Activity、canonical conversationRef 和最多 64 个实际 messageRefs，不接收 prompt、来源许可或工具授权。Host 重新检查 active/continuation、当前安装授权、Activity sourceRefs、已采纳 observe/send 范围及真实原生路由。材料读取只使用目标会话和选中的引用，最多 1 MiB；遗漏、撤回或跨会话选择必须拒绝，不扩大到完整 inbox。

Activity 必须已有同 Subject、active 的正式 Nous WorkContext。实际作者通过 Identity 的真实协议账号解析，平台发生时间和 Host 接收时间分别保留；转述与媒体状态仍来自原材料。只有这些材料进入 contact Observation，工程 prompt 不成为新来源。CognitionUsage 的来源许可为显式目标 origin 和当前 exact WorkContext，不由 audience 字段推导，也不授权其他 anchors。

当前入口只允许 Activity `tools=[]`，配合生产原生 denyall；没有正式逐 Activity 工具执行控制时不能扩大工具。Host 在原生 SDK 调用前保存 raw prompt、digest、UUID nativeRunId 及固定参数。`requestId` 唯一绑定该选择，首次 claim 才可调用已有 native adapter；并发或之后重试返回保存状态。RPC terminal 保存实际结果，不能确认的失败保持 uncertain，不自动重派，也不把调用结束当作 Activity 达成。重启留下的 dispatching 需要显式核对，不会取得第二次调用机会。

迁移 `0006_native_dispatch` 只给既有 native input 添加请求唯一索引，保留原消息、活动与原生事实。适配器通过独立 OpenClaw 的公开 CLI 调用 agent/expectFinal；Host 不运行模型循环。

## 当前边界与验证

Life/Agency 已有正式 owner 和 PostgreSQL 迁移；活动 CAS、重启进展、世界域拒绝及取消与发送点的真实锁交错有数据库测试。完整部署还必须接上原生调度、真实工具、QQ 和跨日恢复；内部测试不能替代这些完成条件。

管理身份与进程服务见 [系统管理合同](../management/system-authority.md)，行为采纳与回执见 [行为合同](reaction-behavior.md)。旧 Subject Chat 的表和原数据由迁移保全，当前产品不再使用旧 mailbox/proposal-only/固定 Expression 执行链。

## Pursuit 与正式条件评价

`createPursuitService` 在现有执行 lineage/fence 中保存行为侧 Pursuit。显式采纳引用 exact Desire revision、DesiredCondition revision、采纳者与原因，关联已经采纳的同 Subject Activity 和 open WorkContext。认知期望不自动创建 Pursuit，Pursuit 不直接产生外部效果。

每次继续由 `guardActivity` 检查真实 Motivation head/lifecycle；修订、撤回、生命周期 epoch、不可用或世界域变化会暂停 Pursuit 并要求 review，同时经 Life owner 暂停其活动。旧条件不能静默转成新修订；`reconsider` 明确采纳新的精确引用，历史与既有结果保留，执行保持暂停，恢复使用正常 Life 操作。不得比较未声明映射的时间域。

评价只将已有实际 evidence refs 与 Activity 的显式 source scope/open WorkContext 提交给官方 `Motivation.evaluate`。接口不接收调用者 truth、complete 或自定义 evaluator。NoUS 根据实际 Material/owner timeline 决定 Achieve 正见证、Maintain 完整窗口、UNKNOWN、limited/gap 和 finalConclusion；H 只保存 evaluationId、exact revision、实际来源与结果投影，不实现第二个 evaluator 或 Observation recorder。Activity 完成或一次效果失败都不自动结束 Pursuit。

服务 API `/gateway/v1/pursuit/{adopt,read,recheck,transition,reconsider,evaluate}` 从 subject owner schema 生成 OpenAPI/Client，要求独立 gateway service credential 与当前绑定 Subject；普通聊天或 administrator session 不能获得该服务身份。HTTP 注册 hook 与 Motivation adapter 独立于 gateway composition，部署组合需要注入 owner 并在既有 Activity/Agency 授权点调用 guard。迁移 0007 只新增 Pursuit/修订历史/评价引用表，不覆盖既有 Activity、消息、认知或效果历史。
