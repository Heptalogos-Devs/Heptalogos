# 原生多角色执行合同

## 所有权与实现范围

本文件拥有 Heptalogos 对独立 Nous/OpenClaw 的原生执行合同。旧 AIRuntime 的 GatewayProfile/ModelProfile、subject.primary/subject.expression 和独立 SDK 循环不是当前执行路由。Host 保存产品职责绑定、用途、预算和权限；OpenClaw 保存 provider/model/协议/凭据及 generation 参数；Nous 保存认知形成/embedding/rerank 配置。不得维护第二份 provider registry。

当前代码已接通独立角色、可信输入、DecisionCommit、世界/叙事和唯一发送组件；单前台Reactor与语义动作、后台让出和压缩新增合同尚须迁移实际消费者，独立安装、真实模型、QQ与跨日仍按活动计划验收。

## 角色与可信运行

产品职责为 world.planner、subject.deliberation、subject.execution、subject.render、narrative.review；Nous reflection 不复制为 Host 角色，maintenance 使用独立运行实例。产品 role 与原生 agent ID、main/worker 标签分别表达，不能依靠模型自称赋权。

RoleBinding 至少拥有职责、nativeAgentRef、启用状态、输出合同、预算、期限、允许工具类别与显式同职责备用 profile。RoleRun 保存实际 Subject/Activity、role/purpose、视角、Agent/Session/run、父运行及 exact source/WorkContext、实际模型/模板/配置版本、费用和结果引用。同Subject的前台与后台交接由[Reactor](../subject/reactor.md)拥有，不能让每个会话各自并发审议；短事务不跨模型长锁。

用途与接触性质由认证 Host binding 提供。world author、review和worker原始成果按 execution_only 保存，不能自动形成 Subject Episode/反思。主观经验须由正式 contact 释放；没有 Host 配置的独立集成不伪造产品事件。每个角色独立 history/cursor，世界幕后与专家完整历史不得流入主体 transcript、reranker或摘要。

原生 exact child 结果保持不可变父 binding，仅作为 execution_only RoleRun；显式、有界 release 创建 subject_experience contact 和 activity_result 机会。子 Agent 完工不能直接调用主线程或向 QQ announce。来源重复不成为独立证人。

## 调用链与输入

接纳事实 → Life/Attention/WorldLife 选择实际感知 → Nous 按 purpose/视角提供 EpistemicView和当前认知 → subject.deliberation → 继续/沉默/休息、委派执行或 ExpressionBrief → subject.render → 一次 narrative.review → NarrativeCommit/Agency → 唯一实际派发。已有明确采用决定不重复审议；内部机会完全无需虚假会话。

每个 provider attempt 前通过同一官方 managed SDK应用当前 role、用途、来源范围、世界域/时间和模型输入预算；首轮、工具后续、再生成、模型切换、child与compact后调用均适用。工具描述、媒体、历史与输出预留计入总预算；关键身份/限定装不下时暂停，不截掉后继续。技术工具权限与认知视角各自检查。

Prompt由职责模板、当前主体投影、世界/任务、带归属材料及本次可提交范围组成；Seed、网页和QQ文字都是材料，不能取得system指令权。不沿用个人助手/满足每条请求的默认骨架。运行记录保存可检查的短理由与实际输入引用，不要求或保存隐藏推理。

## 独立渲染与失败

所有 Subject 自然表达和人格表现动作必须经过独立配置的 subject.render，用自然文本输出；允许相同模型的独立用途调用，不能把 execution 尾段改名当 renderer。目标模型为 doubao-seed-character-260628；实际可用模型必须经已授权配置确认，不能从ID推断JSON/tools/视觉支持。仅同职责显式fallback可用。

默认 renderer/review期限60/30秒，审议120秒；renderer输出2048 tokens、结构提案4096，受实际平台与总预算上限约束。每次attempt均计费，不能重试重置预算。普通确定性世界推进无需模型轮询；后台生成须有显式预算份额。

缺 renderer 时保留待表达状态；缺必要认知时停止相关主观调用；管理、接纳和无关世界规则推进继续。schema/语义不合格最多一次针对具体差异修正，失败保留候选与原因，禁止无限裁判链。原生模型/网络/工具不在Host写事务内。

## 采用与外发

模型结果始终是提案。world planner 只提出 WorldPatch；renderer不持有任意工具或直接发送权；review只读相关正文与依赖，不评风格分。实际配置/权限变化在相关采用与真实效果点重查。

正文读回、Claim/NarrativeCommit 由[叙事合同](../subject/narrative-claims.md)拥有，世界视角与实现由[WorldLife](../subject/world-life.md)拥有，实际唯一发送见[行为合同](../subject/reaction-behavior.md)。系统机械通知和原始文件传递保持系统/工具归属；其伴随主体文字仍走渲染。

Host先读取公开agents.list，在已配置的primary/fallback中选择实际存在的profile；有已保存dispatch时先恢复原实际profile/结果，不在付费运行失败后切换再执行。角色模板通过原生extraSystemPrompt+minimal mode进入实际system输入，外部JSON只作带归属材料。结构角色附所属owner的正式JSON schema；renderer只输出自然文本。模型/协议/凭据仍完全归原生profile。

结构角色的正式schema同时注册为受信Host provider policy，经官方SDK在原生最终调用中设置strict json_schema；renderer与execution显式使用text。审议schema按当前action要求实际必需的表达意图、委派或日历变更，并使用当前owner可解析的target集合。

专业任务工具是已采用delegation.tools与RoleBinding/Activity工具范围的交集约束，实际tokenBudget/allowedToolNames通过正式native ABI 5前置控制。短前台链沿Reaction整体deadline，后续短动作/审议/渲染/评审不能重置；长专业worker用独立已采用活动预算并让出前台，具体见Reactor。RoleResult保留冻结的Activity revision、实际原生结果及期限；phase身份与semantic digest由采用决定确定，当前世界投影刷新不导致重跑旧付费阶段。

执行结果优先释放有界最终生成结果，正文与原始归属共同进入新的正式Subject contact；后续主观决定由同一DecisionCommit消费者实际采用。新的initiate_activity/learn采用创建独立WorkContext和Life Activity，沿原scope重新授权，通过原生world scheduler或一次内部角色调用获得首个运行机会；不依赖QQ会话，也不把决定本身记为学习成果。

关键继续信息、原生固定前缀后台压缩和硬超窗见[连续性](../subject/context-continuity.md)。全部角色无需每个事件都轮流调用；renderer只需自然文本，语义动作由强审议的同一schema采用，原生工具执行同一owner，不另建FC命令语法。
