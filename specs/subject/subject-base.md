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

显式 Activity 批量派发与自然机会共用 Messaging 的实际接触边界：Host 在原生输入被 admitted 后记录精确 message contact，并在同一事务中完成这些消息的 pending，避免自然机会重复回应已读批次。prepareRead、选源或未 admitted 的输入不完成 pending；未接触消息和平台事件继续保留待处理，既有材料仍可按权限重读。

观察和发送分别检查：仅 observe 的目标（包括群 1072706649）仍可派发学习/处理，参数固定 `deliver=false`，不附带 channel/accountId/to，不产生外发；结果保留于 Host/Nous。仅 Activity 与当前 operator 都允许该目标 send 时，才使用 `deliver=true` 和准确渠道/账号/目标。同一 Activity 同时包含观察群和测试群时，每次 sourceRead origin 与材料仍仅属于本次目标。底层 Agency/QQ adapter 的发送拒绝保持不变。

## Pursuit 与正式条件评价

`createPursuitService` 在现有执行 lineage/fence 中保存行为侧 Pursuit。显式采纳引用 exact Desire revision、DesiredCondition revision、采纳者与原因，关联已经采纳的同 Subject Activity 和 open WorkContext。认知期望不自动创建 Pursuit，Pursuit 不直接产生外部效果。

每次继续由 `guardActivity` 检查真实 Motivation head/lifecycle；修订、撤回、生命周期 epoch、不可用或世界域变化会暂停 Pursuit 并要求 review，同时经 Life owner 暂停其活动。旧条件不能静默转成新修订；`reconsider` 明确采纳新的精确引用，历史与既有结果保留，执行保持暂停，恢复使用正常 Life 操作。不得比较未声明映射的时间域。

评价只将已有实际 evidence refs 与 Activity 的显式 source scope/open WorkContext 提交给官方 `Motivation.evaluate`。接口不接收调用者 truth、complete 或自定义 evaluator。NoUS 根据实际 Material/owner timeline 决定 Achieve 正见证、Maintain 完整窗口、UNKNOWN、limited/gap 和 finalConclusion；H 只保存 evaluationId、exact revision、实际来源与结果投影，不实现第二个 evaluator 或 Observation recorder。Activity 完成或一次效果失败都不自动结束 Pursuit。

服务 API `/gateway/v1/pursuit/{adopt,read,recheck,transition,reconsider,evaluate}` 从 subject owner schema 生成 OpenAPI/Client，要求独立 gateway service credential 与当前绑定 Subject；普通聊天或 administrator session 不能获得该服务身份。HTTP 注册 hook 与 Motivation adapter 独立于 gateway composition，部署组合需要注入 owner 并在既有 Activity/Agency 授权点调用 guard。迁移 0007 只新增 Pursuit/修订历史/评价引用表，不覆盖既有 Activity、消息、认知或效果历史。

## 原生 Activity 进展

Host 为实际派发注册的 agent RPC 携带独立 `toolBindings.heptalogos`，包含该次 nativeRunId 与 Activity ref。原生 `heptalogos_life` 工具只从 SDK factory context 获取该绑定及 agent/Session，并将 SDK execute 的实际 toolCallId 交回 Host。缺绑定时不提供工具；不能以模型参数、提示文本或最近 Session/run 查找补足身份。

service-only `/gateway/v1/native/life` 在事务外完成当前 Pursuit/来源检查与 world 读取，在 Host fence 内锁定并重新验证实际 running run、已 admitted contact、Activity scope、operator grant 与 Pursuit 本地 revision。inspect 读取该 Activity；progress 的 note 是主体陈述，来源引用由 Host 从实际选源、已提交反馈 receipt 生成，不接受模型的成果或来源宣称。两者都要求当前 `heptalogos_life` 工具许可。

Life.progress 可显式改变 work/wait/rest，保持当前 active 状态，并要求下一处理点属于 Activity 当前实际 world。rest 阻止新来信正文读取；同 world 到期后由 Life owner CAS 转回 work，既有原生 opportunity 续行，无额外 timer 或模型循环。wait 仍可处理已授权来信。并发进展或授权撤回不能被旧 revision 覆盖。

## 当前纠偏施工合同

独立世界与陈述由[WorldLife](world-life.md)及[NarrativeCommit](narrative-claims.md)拥有，原生多角色由[执行合同](../system/ai-runtime.md)拥有。它们为唯一活动计划的当前施工范围，前文已实现消息派发路径不构成这些能力已完成的声明。

机会扩展为message、world_event、schedule、activity_result、cognition_change、explicit_subject_intent。仅message必须提供实际会话；内部生活不依赖QQ账号或虚假消息。主观决定可继续、观察、推迟、拒绝、询问、交流、学习、委派、发起活动或休息。Direct/@/maxWait只触发重新考虑，不保证回复。Subject在已授予工具/来源/渠道/预算内可自行采用活动，不要求操作者逐项管理adopt。

Nous EpistemicView是唯一主体知识投影，包含相关熟悉范围、接受事实/报告、亲历/听说/学习区分、未知与freshness/coverage限制、刚获得的执行辅助和学习机会。Host只传purpose/视角/真实来源和世界时间，不读取三个域拼第二份知识库。陌生主题仍可在本人愿意且权限允许时学习；后台懂得不等于主体已有专业经验。

世界/worker/review使用execution_only，成果经显式有界handoff才形成subject_experience。观察、学习、reflection与后续表达保留各自来源；未读正文不能进入主体认知。短期情境心境由实际生活/评价延续，不每次随机重置或改写长期Self。

## 正式主观决定采用

`createDeliberationService` 在同Subject短叙事锁与Activity CAS内保存不可变DecisionCommit，引用实际sourceRunId、操作身份、确切选择及实际来源。模型JSON仍是提案；Host在事务外核对真实subject.deliberation角色、provider admission和输入范围，再在同一事务内通过受信assertion复核当前权限。模型不填写actor、渠道授权或受众。

`adopt`接受明确operationId、Subject/Activity、sourceRunId、expectedActivityRevision和decision；同操作同内容返回原采用，不重做Life变化，同操作改内容拒绝。`read(subjectId,decisionRef)`和`readOperation(subjectId,operationId)`读取已有采用，调用者重入应先读receipt，不以新revision重建原请求。采用返回新的activityRevision，后续ExpressionBrief据此使用当前Activity CAS。

choice保存continue_activity、observe、defer、decline、ask、communicate、learn、delegate、initiate_activity或rest，以及短原因、可选下一机会和明确任务/表达分量。ask/communicate需要expressionIntent；任意action都可以明确带伴随交流。没有expressionIntent就不自动生成客套回复。表达意图保存原intent/stance/限定、deception及event/cognition/priorClaim refs，后续brief必须从这个已采用来源派生，不能在renderer矛盾后补一个谎言动机。

rest采用rest，defer采用wait；其他choice保留当前mode，交流不会顺便取消休息。显式下一点必须是同域未来；未给下一点时保留尚在未来的既有节点，已经到期的节点被本次采用消费。Life.progressIn在同一事务更新模式/下一点，progress.note与实际成果原样保留，决定本身不伪装为进展说明。

delegation的goal、工具和来源是已采用任务约束，其来源/工具须在实际run范围，工具同时在当前Activity范围；源权限由可信Host复核，不能把message/conversation/world的读取规则简化为字符串前缀。newActivity只保存本次已采用方向和模式，实际Activity/WorkContext创建与worker执行由原Life/Host消费者继续，不能以DecisionCommit冒充任务已运行或已完成。该操作不改写Pursuit、认知或外发结果。
