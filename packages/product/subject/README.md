# @heptalogos/subject

Product Life 和 Agency 的语义所有者。Nous 拥有主体身份与长期认知，OpenClaw 执行模型、工具、子 Agent 和唯一 durable send；本包保存活动采纳、实际进展与行为结果。

`createLifeService` 提供 propose/adopt、生命周期 CAS、日程分页和低成本注意选择。未采纳提案不能启动，采用的来源、工具、受众和运行预算必须在当前可信权限内。活动带明确世界域；未知映射不能启动。休息期间不选择原始来信，积压按实际等待时间保持公平。重启标记需要重新判断的继续工作，保留实际成果。

已采纳 work 活动的 `nextOpportunity` 到期后，可以在没有新消息时继续。原生渠道的处理机会触发 Host 判断；世界时刻在写事务外读取，到期点和实际原生输入在同一个活动行锁与事务内消费，因此并发机会只建立一次运行。没有到期点、时间域不可比较、活动需要恢复或已取消时不会续行。无消息续行的结果留在内部，不自动外发；新的实际消息仍走原来的感知与发送路径。

`createAgencyService` 接纳完整的原生 prepared batch，以稳定 intent 和原始 sourceIndex 识别行为与发送段。发送点与活动取消通过同一个活动行锁决定；Host 持久化许可后，Channel 才执行网络发送。已接受的结果可在取消或恢复后幂等返回；uncertain 阻止自动重发，可靠回执可以解消同一次尝试。实际引用、线程、受众和正文都受检查。

本包沿用 Host-fenced Persistence 和既有执行 Lineage，不创建模型循环、网络重试 worker 或第二份认知。当前独立安装的 Host 是否已接入这些操作，取决于实际部署代际与 Gateway 配置；包构建通过不代表 QQ 上线。

语义见 [主体与活动合同](../../../specs/subject/subject-base.md) 和 [行为及真实结果](../../../specs/subject/reaction-behavior.md)。schema 与公开类型以 `src/contracts.ts`、`src/agency-contracts.ts` 为准；HTTP 和 Client 由这些 schema 生成。

开发时运行 `pnpm nx run subject:build`、`pnpm nx run subject:test`。真实事务与并发测试位于 `integration/foundation`；通过 `HEPTALOGOS_TEST_PG_BIN` 指向安装的 PostgreSQL bin 后运行 Life/Agency/Messaging 对应测试，避免把跳过的数据库测试记为通过。

`createPursuitService` 显式采纳 exact Desire/DesiredCondition revisions，并关联已经采纳的同 Subject Activity 与 open Nous WorkContext。来源修订/撤回、生命周期 epoch 或时间域改变会标记 reviewRequired、暂停该 Activity；继续前由 `guardActivity` 重新核验。`reconsider` 是明确换修订的采纳，保留旧 adoption/evaluation history，并保持执行暂停；实际执行仍走原 Life。官方 Motivation evaluator 是唯一真值与覆盖 owner，Pursuit 只保留实际 evaluationId、来源、verdict、finalConclusion、coverage 与时间域，不把任务完成等同于满足，也不创建后台 worker。

`createWorldLifeService` 拥有正式WorldDefinition、显式日程和本地日历规律、已实现事件、主体可见投影、覆盖与待回流contact。`prepareAdvance`返回前2小时/后24小时的有界世界frame及下一自然节点；`advanceRules`实现fixed规律，choice留给正式世界/主观角色。Temporal处理IANA/DST，uuid库固定规律发生身份；重启或重复机会不重造事件。`realizeIn`与NarrativeCommit复用同一个短事务和Subject叙事锁，模型与clock读取在事务外。world-author数据与Subject感知内容在查询前分开，`asRecordedAt`和`knowledgeAtWorldTime`分别处理现实提交历史和故事内知情。正式语义见[WorldLife](../../../specs/subject/world-life.md)。

`createDeliberationService` 采用真实主观角色的决定：`adopt`在Subject短锁与Activity CAS下同时保存不可变DecisionCommit和Life模式/下一节点，保留技术进展原文。Host提供actual run/admission/source核对，provider与clock在事务外读取，当前权限在同事务重查。`read`按decisionRef、`readOperation`按操作身份恢复已有receipt。明确expressionIntent可伴随任何choice；后续brief引用此实际采用来源，沉默不会自动变成表达。实际worker、新Activity与发送仍由原owner消费，不由本服务建立新运行循环。

`Life.get(subjectId, activityId, transaction?)` 与 `WorldLife.resolveSourceRefs(input, transaction?)` 在授权/发送围栏中复用调用者事务，仍由原owner SQL和解析器读取；不会持有写连接再借读连接。

`createNarrativeService`在实际DecisionCommit基础上保存ExpressionBrief，采用独立原生review后的完整renderer payload。兼容场景细节、Claim、承诺到期点与唯一Agency行为在同一Host事务提交，实际平台结果继续由Agency保存；`claimsTo`按听众及实际发送状态分页，`pendingCommitments`将尚未履约的采用记录供后续Life审议。模型、认知服务与网络始终在事务外。正式合同见[叙事与陈述](../../../specs/subject/narrative-claims.md)。

## 世界 Profile、日历和生活状态

`createWorldProfileService` 通过 `adopt/read` 保存独立 WorldProfile 及实际入场来源，Identity 的 `self` 和虚拟 actor key 由可信组合解析。可选 Seed 由原 Nous 操作单独采用。结构见 `worldProfileSchema`；[学生文件](examples/student-world-profile.json) 是同一 schema 可验证的输入示例。它不含生产 SubjectId；操作者须明确选择目标 Subject/world，并由初始化组合核对正式 Clock 的域与入场点。示例通勤路程由 `travelEdges` 定义，Subject 实际选择 `move` 才产生移动。

Profile 的课表保存原采用输入来源；当前可写课表只有 WorldDefinition 中的规则/修订。`changeCalendar` 改当前日历，不能通过重新导入旧 Profile 覆盖它。再次采用同一入场资料时可明确修改运行参数；初始角色、初始精力及当前精力不重置，原入场 source/ref/recordedAt 保留。能量费率带 `policyEffectiveAt`，跨修订的实际区间分段使用当时参数。

`readCalendar` 接受任意有限世界区间，按 planned/lived/combined、展示时区、角色/活动和 continuation 读取；查询不调用模型、不推进时钟、不创建多年实例。RRULE/RDATE/EXDATE 由 [rrule](https://github.com/jkbrzt/rrule) 处理，Temporal 将本地重复坐标按明确 IANA/DST policy 转为世界区间。`RECURRENCE-ID` 原始本地坐标决定实例 ID，单次移动和未来有效修订保留身份。已实现实例保留原安排，Subject 只能修改 adjustable 规则；缺席不能删除学校规则。

`readLivingState` 返回已实现区间导出的精力、积分点、覆盖、地点、当前世界动作及独立 device revision。一个时段只计一个主活动速率；附属活动只计最大正负担的配置比例。休息/睡眠恢复必须已有实际 realized 区间，计划与 worker 数量不提供恢复或额外扣减。迟到细化从此前保留状态重算，重复 operation 不重复积分。`adoptDeviceViewIn` 复用 Reactor 的同一事务；设备 CAS 不因无关精力变化而失败。

`adoptAction` 接受 move、participate、rest 和真实 Reaction 来源，可信前台校验在同一短事务内执行。动作时长由已采用 route、日程或 rest policy 决定，不能由模型调用改钟。`completeActions` 只实现当前正式时钟已经走过的部分；未到终点仍为 pending，移动不会提前到达目标。当前原生唤醒者读取 `nextOpportunity`；本包没有 timer。`advanceRules` 先处理已采用动作的实际进展，再分段实现规律；离开教室后的课程段记录 missed，不强制主体瞬移，也不把睡眠与主动学习同时计入精力。

世界接触先由 `selectContact` 为一个稳定 native run 独占；selected 不是已感知。实际 admitted projection 与 exact official occurrence 回执成立后，原 run 才能 `acknowledgeContact` 置 released。未知发布状态不换随机 observation ID；只有可信 Reactor 已证明原 run 从未 prepare/publish 且已撤销时，才可同事务 CAS 转移 selection，并保留依据。`pendingContact` 精确读一个事件，分页按实际 recordedAt/eventId，而不是 UUID 大小或故事发生时间推进。

以上是当前 owner 操作与本地 PostgreSQL 证据，正式安装、真实角色/QQ、跨日运行仍由整体活动计划完成；不能将本包测试当作已上线。

Reactor 的 action 收据可保存有界 `problem`。表达 owner 在 brief/render/effect 前明确拒绝的引用或听众问题以 rejected 完成，下一主观步骤读取实际问题和可用引用；未知或已可能产生效果的异常不因此改判，实际收据仍不可重写。

前台 claim 在 Subject 短事务中用实际 focus revision 区分每次取得的 Reaction；原请求及并发合流请求均由 `subject_reactor_claim` 指向同一结果，终态后重放不产生另一次机会。候选身份本身不锁死后续正常尝试。

独立 Narrative review 在采用前明确引用超出 brief 时，owner 仅在同一短锁内证明尚无 NarrativeCommit/Agency 行为后保留有界 rejection；同 brief 重放读取原结果，不重复 review。Host 据此完成 rejected action 并将实际问题交下一主观步骤。未知或可能已产生效果的异常仍保留原所有权。
