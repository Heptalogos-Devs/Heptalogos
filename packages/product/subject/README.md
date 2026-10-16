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
