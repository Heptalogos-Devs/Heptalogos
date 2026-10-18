# WorldLife：世界、日程与已实现生活

## 实施合同与边界

WorldLife 是 subject 产品包内的独立 owner，沿现有 Activity、Host fence 与 PostgreSQL短事务实现。当前 `createWorldLifeService` 已提供定义/日程配置、prepareAdvance、realize/同事务realizeIn、world/subject视角与双cutoff查询、coverage及待接触交接。日历规律经Temporal按IANA/DST展开；履约政策集中区分自主、通常遵循和严格，分别决定默认参与、可中断条件和明确偏离，不能用fixed/choice或adjustable同时承担这些含义。真实Pg回归覆盖并发幂等、冲突、视角、历史截点、兼容细化与重复规则推进。正式HTTP hook已定义；安装组合、原生scheduler、多角色消费者与Nous接触还须完整贯通后报告完成。Activity/进展仍分别保存技术投入。认知时钟与长期认识仍由Nous拥有。

WorldDefinition 保存 worldId、Subject、timeDomainRef、IANA时区、稳定地点/world-scoped actor、生活规律、创作范围、现实信息来源与offline policy。worldId不等于时间域；无Seed不自动生成童年、性格、价值或专业履历。既有Subject采用学校角色/回溯背景须显式来源采用。

ScheduleItem保存计划区间、参与者、目的、归属Activity、规律、可调整性和取消/替代。RealizedEvent保存稳定eventId/revision、世界时段、地点/参与者、事实、实际规则/producer、因果与父事件引用、实际recordedAt。计划到期只触发realize，不自动证明完成。场景投影、未定细节和持续情境由正式事件更新，不每次重置NPC。

## 读取、推进与采用

prepareWorldAdvance读取clock、定义、已实现范围、有限日程和相关历史，返回有限WorldFrame。默认主要日程24世界小时、近期细节2小时。规则确定或已采用意图保持的日常段直接推进，空白可作为合法自主时间；近期缺口或交互确需细化时才调用world.planner；长离线按自然段合并，不补跑每分钟模型或物理工具。

`WorldLife.advance`组合到时动作和日历规律，一次返回进展引用、可感知变化、当前frame与下一条件。没有新增可感知变化时Host只更新原scheduler，不唤醒付费前台。已采用Profile中的空白是自主时间，沿下一日历节点或规划范围终点继续。没有Profile且尚未建立任何场景的首次机会，才由world.planner完成初始细化；已保存的realization抑制重复初始化。

world.planner只输出提案，工具集合为空。RoleExecution统一解析正式结构并还原来源键，Host直接消费structuredOutput，绑定实际Subject/World、实现游标至当前时刻的区间和producer。未来安排进入schedule；过去安排和正在发生的前缀在WorldLife统一保护。

模型侧合同从正式WorldPatch派生，只生成events、coverage及必要schedule变更。正式responseFormat保存schema，文本指令只说明语义和来源目录。角色模板版本进入原生历史范围，合同变化使用新Session并保留原付费结果。

realizeWorld采用operationId、expectedRevision、目标范围和WorldPatch。在同Subject短叙事锁下核对版本/域、actor/place身份、因果与已定事实，保存事件/计划结果/推进范围。operationId重放返回原结果，改变内容拒绝；相关版本改变后有限重拟，不能最后写覆盖。模型与Nous网络都在事务外。

WorldLife提供同事务realizeIn供NarrativeCommit采用WorldPatch，不能另借pool连接。锁顺序为Subject叙事锁→world/scene→Activity→behavior；所有相关路径一致，不跨模型持锁。地点/身体排他资源按区间检查；上课时短暂看手机可有显式父事件/可重叠模式，不能以重叠掩盖冲突。自由文本因果冲突由一次窄语义核对补足。

已实现课程可追加兼容的被点名细节，须引用原事件与自身recordedAt；不能把同一时段改成异地旅行。过去安排和已实现事实只读；纠正以当前recordedAt追加说明或解释，原事件、原版本和已表达原话保留。

## 视角与认知交接

世界作者可见规则、幕后NPC状态、正式事件和实际现实素材；主体只取得自己seen/heard/recall的可见投影。隐藏事实先于检索/rerank/摘要过滤，不靠末段Prompt补救。每个NPC有world-scoped EntityRef；名字相似不合并真实QQ人物。

正式world_realized来源来自认证owner已采用事件，保存event/revision、发生/世界感知点、实际realized/recorded/released时间及生成谱系。world草稿保持execution_only；可见投影经明确release才进入subject_experience。交接失败保留稳定待回流引用，重试同事件不重造经历。

虚拟课程/娱乐是合法世界经历；真实平台成绩、网页操作和夜间QQ发送分别依实际效果记录。现实新闻/产品/真实人物言论必须来自实际材料；世界可安排怎样遇到资料，不能编造其现实内容。

## 时间、离线与查询

使用Nous CognitiveClockService与正式DomainStamp；真实记录采用UTC、超时使用monotonic duration。默认simulate_elapsed：按持久现实锚点推进，offline默认1倍；pause_with_host显式暂停，异常退出从最后高水位恢复，不伪造精确关机时刻。离线事件可以早晨实现昨夜世界生活，recordedAt仍是早晨；预算不足保留未实现范围。

knowledgeAtWorldTime读取已实现故事中角色截至该世界点的见闻；asRecordedAt另限制现实提交截点。晚实现不得违背已对外确定的知情/不知情，必要时成为当前发现/回忆或拒绝。真实QQ/工具observed不允许回填。跨域无映射返回未知，不比较裸timestamp。相对日期在理解/采用时绑定域与区间。

管理API/Client/CLI提供世界定义采用/修订、计划与规则、prepare/realize、任意范围lifeAt、coverage、世界/主体视角、事件解释/纠正。内部机会为world_event/schedule/activity_result/cognition_change/explicit_subject_intent；仅message机会和真正外发要求会话。内部session按Subject/world/Activity/role构成，不能伪造canonical conversation。

下一自然节点投影到已有OpenClaw scheduler，只有一个实际唤醒者，无第二运行循环。QQ关闭时世界规律和已采用活动仍可确定性推进；无新变化不触发付费审议。WorldLife一次返回进展、可感知变化与下一节点，continue保存实际下一条件；QQ接入后只有实际查看才接触正文。

参见[主体活动](subject-base.md)、[叙事与陈述](narrative-claims.md)、[时间](../execution/time.md)。

日历规律采用成熟RFC5545重复集，原始本地RECURRENCE-ID固定实例身份；单次例外和未来有效修订保留旧安排/来源。rrule负责RRULE/RDATE/EXDATE，Temporal按明确IANA/DST policy转换，不手写weekday日期循环。prepareAdvance默认前2小时/后24小时并读取实际profile参数；advanceRules每批最多128事件，未实现部分保持limited。

世界机会由唯一Reactor组织，不为每个World或Activity另开一条主观链。World contact构造或select均不代表感知；同Subject事件只能由一个稳定run交接，只有真实provider admission及exact accepted occurrence回执成立才released。失败/uncertain保留selection。仅在正式证明原run未prepare/publish且其Reaction已撤销后允许CAS转移，保留原选择和撤销依据。

虚拟人物由Identity `resolveWorldActor(worldId,actorKey)`取得稳定canonical EntityRef，跨世界同key不合并，`linkAccount`拒绝为虚拟人物绑定真实协议账号。Subject本人使用ensureSubjectEntity；世界采用adapter需分别核对本人self与其余actor的exact world scope。

## 独立WorldProfile、课表例外与范围日历

当前owner已提供WorldProfile采用、RFC重复规则与例外、范围日历、LivingState积分、设备CAS及到时实现的世界动作。对应PostgreSQL回归与真实安装行为分别记录，旧Life列表不代替范围日历。

结构化WorldProfile与可选Seed分别采用。无Seed创建不调用模型、不补人格或旧传记；学校/角色仅是明确入场事实，可按实际启用领域形成认识。新profile不倒退既有世界或覆盖原Subject身份。跨owner步骤复用稳定operation及真实回执，失败续未完成，不建通用创建引擎。

规则使用成熟RFC5545语义：RRULE重复、RDATE增加、EXDATE排除、RECURRENCE-ID原实例身份。单次移动保留原实例，修改只作用于未来实例或正在发生活动的未来尾部；按世界当前时刻和事实检查边界，已过去但未实现的安排也不能改期抹除。时区参与本地展开，DST规则显式，不用UTC每周加固定小时。主体缺席/违反规则的行为与修改学校规则分别处理。

规则的可选attendancePolicy由WorldLife集中解析：mode为autonomous/usual/strict，startToleranceMinutes、earlyMinutes、lateMinutes为开始容忍与移动范围，minimumContinuationMinutes为最短继续时间，interruptAfterMinutes指定相对开始的可中断节点，interruptEvents列出social/important/emergency/official_change。严格政策使用零开始偏移，普通社交与一般重要消息不打断；明确紧急例外或正式改期由对应操作采用。frame.currentPolicy返回实际policy与nextInterruptAt；前台用实际世界时刻和事件类别选择。adjustable仅管理环境修改权，既有持久fixed/choice输入只在集中policy解析处归一。

WorldProfile可选schoolCalendar采用`jci-2025`时间骨架，必须明确startsOn、validThrough、weekdays和slots选择。官方课次只提供Asia/Shanghai的十一节时间；标题、地点、参与者与周几来自明确配置。预览函数返回选定规则，模板同时保留预备、午休、晚餐、自习和熄灯时点供查看；未选择的时间不生成主体活动。来源为2025-07-15公布、2025-09-08执行的[官方作息表](https://www.jci.edu.cn/info/1055/49762.htm)，采用模板不赋予学校身份。

readCalendar按Subject/world/from-to/domain/展示时区、planned/lived/combined、人物/活动及cursor有界展开和合并规则、例外、计划、已实现事件；显示原/现安排、修订来源、真实状态/时段/recorded和coverage。只读不模型、不推进世界、不登记接触。作者、Subject已知安排和公开忙闲各自视角。

LivingState保留当前焦点/地点/活动、精力E、积分到的world stamp及profile revision。E在0..100；新增已实现区间分成不重叠段，每段一个主活动rate，附属活动仅加最大正负担比例，不按worker/message/token重复扣除。幂等事件不重复积分，跨域无映射未知，未实现段不能提供恢复；纠正已积分段按owner历史有限重算。

工程初值：新profile E=80，学习-8/世界小时、普通社交-4、休息+12、睡眠+16，附属正负担比例0.25，事件delta默认0且配置最多±10；娱乐负担或恢复由profile明确。在线rate默认1，offline simulate_elapsed默认1、规划24世界小时/细化2世界小时。配置不重启复位，不覆盖已有明确policy，未经心理校准。精力为审议提供可解释负担，真实费用/网络期限独立，不能固定阈值拒绝全部交流。

世界向唯一[Reactor](reactor.md)提供机会，语义手机/浏览/世界动作来自其同一操作合同；导演幕后和未释放资料不能进入Subject情境。正常CLI支持今日/范围、只改本次/以后系列及profile导入，GUI消费同一生成Client。
