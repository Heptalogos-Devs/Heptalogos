# 人格表达、原文与Claim索引

## 所有权与表达

Communication/Narrative拥有完整交流交付。WorldLife拥有已实现世界事实，Nous拥有认识，Messaging/Agency拥有原文、实际听众、唯一发送身份与派发结果。原文先保存；Claim是可追溯的派生索引，不承担普通消息能否落库和发送的资格。

ExpressionBrief来自已采用主观决定。可选`semanticRequirement`只标明`world_fact`、`serious_commitment`或`important_conflict`；普通交流省略。前两类经`prepareExpression`把正式世界提案或未来承诺交WorldLife/Life采用，receipt留在`semanticPreparation`，再交renderer；已知冲突在最终候选提交前局部读回。Brief保留actor/听众、意图/姿态、实际来源、必须限定、知识立场、允许世界细化范围、旧说法关系和承诺。所有Subject自然表达经独立subject.render；renderer只输出自然文本/许可表现槽位，不改变听众、工具权限和技术结果。专业worker资料只在正式释放后成为主体输入。

角色owner把本次短来源键映射到真实引用及类型一次。输出格式只在正式responseFormat中维护，prompt只保留含义和短目录。Reactor调用完整交流操作，不自行串接brief、解析review、猜来源或修复派发表。

## 普通交流交付

renderer结果立即保存。普通候选的原文、听众、来源、已采用意图、时间和唯一发送身份在本地短事务保存，随后经现有唯一发送出口派发。保留精确sourceIndex、reply/thread、媒体和真实平台结果；不要求结构化Claim先完成，不为普通闲聊无条件调用reviewer。

即将交语义处理的原生prepared先由`retainCandidate`短事务保存在原ExpressionBrief，固定原renderer与nativeIntentId。历史未保存的候选只能从真实注册review的原typed输入恢复；核对原父renderer、Subject/Activity和注册currentContextDigest，不接受操作者提供正文。`recoverExpressionCandidates`只恢复候选，不采用或发送。

任务恢复后，当前Subject在情境中看到原候选文字、原意图、听众、生成时间与历史问题；communicate选中该candidateRef并说明当前理由，RoleExecution从owner目录绑定原originalIntent；discard明确放弃。Communication以当前真实DecisionCommit和前台/Activity修订追加采用receipt，保留历史brief/rejection；当前来源、听众及重要语义仍由owner核对。原文过时或已不符合意愿时，Subject选择放弃。

已采用候选由只接受Subject/brief选择的`heptalogos.expression.send`读取Host正式receipt，调用公开`sendDurableMessageBatch`并传入原preparedBatch、nativeIntentId和Agency custody。原生队列、实际网络发送与回执仍只有原出口；uncertain按原身份保留。恢复不重新调用renderer、媒体或worker。

发送前检查当前听众、权限、取消及与本候选相关的条件。相对时间失效时只处理相关表达，不改历史。网络、模型、Nous请求均在事务外；同一发送身份重放复用原结果，uncertain不自动重发。直接message/cron/worker announce也经同一出口。

已知重要冲突、严肃承诺或明确新世界事实，只让相关候选等待一次有界局部语义处理。需要采用的新世界细节和承诺先由对应owner处理，再渲染。无关世界或配置变化不撤销全部候选，普通格式/分类错误停在未完成的语义工作，原模型结果与原文保留。

## 后台索引、冲突与听众

Claim抽取、相关对象/时段对比、概括、反思和Nous补交使用既有owner待办与结果身份在后台推进。Narrative沿原`narrative_commit`记录保存`pending/indexed/blocked`语义状态，`pendingSemanticWork`只读待办；获得运行和预算授权的既有机会逐项调用`indexPending`。待原生结果解消的工作保持pending，解析、来源和晚到冲突保留blocked及实际问题。当前追问、世界细化和反思同时读取尚未索引的原文尾部，不因全局索引积压阻塞所有会话。

提案只返回本候选实际原文中的精确quote/sourceIndex，程序解析唯一位置与引用类型；缺失或歧义留在相关索引失败记录。Claim保留实体、肯否/条件/语气、时间域/区间、听众、意图及来源。按相关性读取，不默认塞入最新64条或完整发送批次。

后台索引不改已发原文、不覆盖生活事实、不自动补发。晚到冲突形成可见纠正/澄清工作。renderer意外加入的生活细节保留“确实说过”及真实来源；兼容未定细节可由世界owner追加，不兼容时保留错误和后续纠正。

conceal/fabricate必须在候选生成前已明确采用，保存真正世界版本、范围与听众。无意矛盾不在事后补成说谎意图；隐瞒不改真实机器、支付或发送结果。兼容虚拟细节不升级为现实外部事实。

## 历史与回流

lifeAt/claimsTo/explainStatement关联世界、当时认识、已采用意图、原文和实际效果；未发、已发与uncertain分开。原话与原世界版本保留，追加更正有自己的recordedAt。已采用承诺具有正式未来条件，不以说过作为履约证据。

Nous分别接收实际感知和generated statement；原话证明说过，自我重复不增加独立支持。旧聊天不升级为虚构过去，worker原文不直接成为人格或专业经验。

参见[WorldLife](world-life.md)、[行为与发送](reaction-behavior.md)、[Reactor](reactor.md)。
