# WorldLife：世界、日程与已实现生活

## 实施合同与边界

WorldLife 是 subject 产品包内的独立 owner，沿现有 Activity、Host fence 与 PostgreSQL短事务实现。当前 `createWorldLifeService` 已提供定义/日程配置、prepareAdvance、realize/同事务realizeIn、world/subject视角与双cutoff查询、coverage及待接触交接。固定日历规律经Temporal按IANA/DST展开、确定性实现并给出下一自然节点；choice规律留给planner/主体选择。真实Pg回归覆盖并发幂等、冲突、视角、历史截点、兼容细化与重复规则推进。正式HTTP hook已定义；安装组合、原生scheduler、多角色消费者与Nous接触还须完整贯通后报告完成。Activity/进展仍分别保存技术投入。认知时钟与长期认识仍由Nous拥有。

WorldDefinition 保存 worldId、Subject、timeDomainRef、IANA时区、稳定地点/world-scoped actor、生活规律、创作范围、现实信息来源与offline policy。worldId不等于时间域；无Seed不自动生成童年、性格、价值或专业履历。既有Subject采用学校角色/回溯背景须显式来源采用。

ScheduleItem保存计划区间、参与者、目的、归属Activity、规律、可调整性和取消/替代。RealizedEvent保存稳定eventId/revision、世界时段、地点/参与者、事实、实际规则/producer、因果与父事件引用、实际recordedAt。计划到期只触发realize，不自动证明完成。场景投影、未定细节和持续情境由正式事件更新，不每次重置NPC。

## 读取、推进与采用

prepareWorldAdvance读取clock、定义、已实现范围、有限日程和相关历史，返回有限WorldFrame。默认主要日程24世界小时、近期细节2小时。规则确定的日常段直接展开，未定场景才调用world.planner；长离线按自然段合并，不补跑每分钟模型或物理工具。

realizeWorld采用operationId、expectedRevision、目标范围和WorldPatch。在同Subject短叙事锁下核对版本/域、actor/place身份、因果与已定事实，保存事件/计划结果/推进范围。operationId重放返回原结果，改变内容拒绝；相关版本改变后有限重拟，不能最后写覆盖。模型与Nous网络都在事务外。

WorldLife提供同事务realizeIn供NarrativeCommit采用WorldPatch，不能另借pool连接。锁顺序为Subject叙事锁→world/scene→Activity→behavior；所有相关路径一致，不跨模型持锁。地点/身体排他资源按区间检查；上课时短暂看手机可有显式父事件/可重叠模式，不能以重叠掩盖冲突。自由文本因果冲突由一次窄语义核对补足。

已实现课程可追加兼容的被点名细节，须引用原事件与自身recordedAt；不能把同一时段改成异地旅行。管理纠正追加revision/supersession和原因，历史对外说法保留。

## 视角与认知交接

世界作者可见规则、幕后NPC状态、正式事件和实际现实素材；主体只取得自己seen/heard/recall的可见投影。隐藏事实先于检索/rerank/摘要过滤，不靠末段Prompt补救。每个NPC有world-scoped EntityRef；名字相似不合并真实QQ人物。

正式world_realized来源来自认证owner已采用事件，保存event/revision、发生/世界感知点、实际realized/recorded/released时间及生成谱系。world草稿保持execution_only；可见投影经明确release才进入subject_experience。交接失败保留稳定待回流引用，重试同事件不重造经历。

虚拟课程/娱乐是合法世界经历；真实平台成绩、网页操作和夜间QQ发送分别依实际效果记录。现实新闻/产品/真实人物言论必须来自实际材料；世界可安排怎样遇到资料，不能编造其现实内容。

## 时间、离线与查询

使用Nous CognitiveClockService与正式DomainStamp；真实记录采用UTC、超时使用monotonic duration。默认simulate_elapsed：按持久现实锚点推进，offline默认1倍；pause_with_host显式暂停，异常退出从最后高水位恢复，不伪造精确关机时刻。离线事件可以早晨实现昨夜世界生活，recordedAt仍是早晨；预算不足保留未实现范围。

knowledgeAtWorldTime读取已实现故事中角色截至该世界点的见闻；asRecordedAt另限制现实提交截点。晚实现不得违背已对外确定的知情/不知情，必要时成为当前发现/回忆或拒绝。真实QQ/工具observed不允许回填。跨域无映射返回未知，不比较裸timestamp。相对日期在理解/采用时绑定域与区间。

管理API/Client/CLI提供世界定义采用/修订、计划与规则、prepare/realize、任意范围lifeAt、coverage、世界/主体视角、事件解释/纠正。内部机会为world_event/schedule/activity_result/cognition_change/explicit_subject_intent；仅message机会和真正外发要求会话。内部session按Subject/world/Activity/role构成，不能伪造canonical conversation。

下一自然节点投影到已有OpenClaw scheduler，只有一个实际唤醒者，无第二运行循环。QQ完全关闭时仍应推进课程、休息、娱乐和内部审议；QQ接入后只有实际查看才接触正文。

参见[主体活动](subject-base.md)、[叙事与陈述](narrative-claims.md)、[时间](../execution/time.md)。

日历规律保留localStart、durationMinutes、weekdays、validFrom/validUntil、地点/人物和fixed/choice。IANA跳过时间向后平移、重复时间取较早项，均由Temporal处理；发生身份由world/rule/local-date经uuid库固定。prepareAdvance投影前2小时场景与后24小时日程，advanceRules每批最多128事件，未设定/未选择区间保留limited；重复机会读取既有event而不重复实现。

当前`createWorldOpportunity`串联固定规则实现、必要world.planner和Subject审议；世界作者frame与Subject可见材料分开。候选contact构造不代表主体感知；只有真实deliberation provider admission及accepted contact receipt成立才ack世界待接触事件，失败/uncertain保留pending。planner事件producer绑定实际RoleRun，不能由模型自报。后续选择交给Life/Agency的adoptDeliberation消费者。原生cron.command helper投影同Subject唯一声明job，wake按当前安装discovery调用service机会；正式安装组合与真实模型/跨日结果仍需按活动计划验收。

虚拟人物由Identity `resolveWorldActor(worldId,actorKey)`取得稳定canonical EntityRef，跨世界同key不合并，`linkAccount`拒绝为虚拟人物绑定真实协议账号。Subject本人使用ensureSubjectEntity；世界采用adapter需分别核对本人self与其余actor的exact world scope。
