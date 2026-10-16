# 人格表达、Claim与NarrativeCommit

## 合同与状态

当前代码由 Host 的主观决定消费者、独立原生 render/review 和 Narrative owner 接通到既有唯一发送；安装代际与真实模型/渠道验证按活动计划单独确认。世界事实归WorldLife，主观认识归Nous，听众说法和派发关联归Agency；四者分别保存。

ExpressionBrief来自已采用主观决定，包含actor/受众、目的/姿态、世界/认知exact refs、当前知识立场、必须保留限定、允许虚拟细化范围、旧Claim关系、承诺和表达格式。worker完整专家推理不直接变成主体立场。

所有Subject自然表达与人格表现动作经subject.render；机械状态和原文件保留系统/工具归属。renderer只能提出自然文本/获准表现槽位，不能改变听众、技术结果或工具权限。

## 正文读回与采用

每份自由生成的主体表达经一次narrative.review窄读回，覆盖实际正文新增的生活/身份/能力/经验/关系/知识归属/外部结果/承诺。每项保留原文区间、实体、肯否/条件/语气、原话与解析后的时间域/区间、听众、brief key及world/claim/cognition ref。礼貌、隐喻与玩笑按语用处理，不用关键词触发全库扫描或人格评分。

已定事实绑定原事件；兼容虚拟细节先由WorldLife验证并采用；未来承诺写入可执行Commitment/机会而非completed event；不确定或无意冲突有限修正。conceal/fabricate必须是brief已有的明确决定，不能事后为矛盾补谎言意图。世界游戏事实与向朋友说复习分别保留，belief/lie/uncertain不能压成confidence。

renderer使用与审议相同EpistemicView，后台新资料不能渲染成既有从业经验。只允许一次带具体差异的修正，仍失败保留草稿与原因，不外发。完全不变的采用payload可复用读回，相对时间/听众/依赖变化必须重核。

## 本地事务与真实发送

NarrativeCommit接受operationId、brief/候选/读回、可选WorldPatch与相关expected versions。在同Subject短叙事锁下，依world/scene→Activity→behavior次序核对并采用世界细化、保存最终payload/Claim、登记实际承诺及一份待派发意图。WorldLife.realizeIn复用传入事务。模型、Nous和QQ网络均在事务外。

幂等重放返回原canonical event/claim/behavior；同ID换内容拒绝。Claim初态adopted，平台accepted后关联message ID并成为实际表达记录；uncertain保留可能已表达，禁止自动重发。取消且确定未发送不记已告诉，但独立实现事件不回滚。

发送前复核实际听众、相对时间、权限及相关事实；过期“刚刚”需重新渲染/采用而非替换历史。唯一channel消费完整采用payload，原sourceIndex、reply/thread与媒体保持exact。直接message/cron/child announce均不能绕过。真实Effect失败不因主观说法被改写。

## 历史与回流

lifeAt按世界区间查询，claimsTo按听众/所指时段/状态查询，explainStatement关联message与世界/认知/意图/真实结果。无关场景变化不使候选全部失效，兼容细节追加自身recordedAt。已发原话永远作为当时行为保留，可追加澄清。

Nous分别接收实际感知world event和generated statement；statement证明说过，不证明内容真实。自我重复不增加独立支持。旧聊天不批量升级为已实现虚拟史；旧progress仍是当时进展陈述。

参见[WorldLife](world-life.md)、[行为与发送](reaction-behavior.md)、[原生角色](../system/ai-runtime.md)。

ExpressionBrief的decisionRef必须解析到同Subject/Activity的不可变DecisionCommit。saveBrief核对完整intent/stance/限定、deception和event/cognition/priorClaim refs，来源不能扩大。实际采用的限定不能由renderer或评审事后更改。

worldDetailScope只从已正式释放、明确引用的当前世界场景派生，保留相应区间、人物、地点和环境允许的creationScope。新细节必须引用已知父事件；Narrative owner将source.kind固定为narrative、producer固定为实际renderer，并保留实际reviewer谱系，不接受模型自报环境传感器或world planner身份。

承诺的due必须在实际当前世界域的未来；NarrativeCommit在同一事务用Life.progressIn将最早due与尚有的nextOpportunity合并，不新建timer。pendingCommitments按实际Activity查询尚未解决的采用记录，交给主体后续审议；该记录本身不证明履约。claimsTo支持oldest/newest，以afterClaimId沿所选方向分页，status先按真实发送结果计算再过滤/限量。当前受众的最近说法直接提供给主体，不等待下轮反思。
