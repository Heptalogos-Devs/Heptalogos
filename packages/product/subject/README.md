# @heptalogos/subject

Product Life 和 Agency 的语义所有者。Nous 拥有主体身份与长期认知，OpenClaw 执行模型、工具、子 Agent 和唯一 durable send；本包保存活动采纳、实际进展与行为结果。

`createLifeService` 提供 propose/adopt、生命周期 CAS、日程分页和低成本注意选择。未采纳提案不能启动，采用的来源、工具、受众和运行预算必须在当前可信权限内。活动带明确世界域；未知映射不能启动。休息期间不选择原始来信，积压按实际等待时间保持公平。重启标记需要重新判断的继续工作，保留实际成果。

`createAgencyService` 接纳完整的原生 prepared batch，以稳定 intent 和原始 sourceIndex 识别行为与发送段。发送点与活动取消通过同一个活动行锁决定；Host 持久化许可后，Channel 才执行网络发送。已接受的结果可在取消或恢复后幂等返回；uncertain 阻止自动重发，可靠回执可以解消同一次尝试。实际引用、线程、受众和正文都受检查。

本包沿用 Host-fenced Persistence 和既有执行 Lineage，不创建模型循环、网络重试 worker 或第二份认知。当前独立安装的 Host 是否已接入这些操作，取决于实际部署代际与 Gateway 配置；包构建通过不代表 QQ 上线。

语义见 [主体与活动合同](../../../specs/subject/subject-base.md) 和 [行为及真实结果](../../../specs/subject/reaction-behavior.md)。schema 与公开类型以 `src/contracts.ts`、`src/agency-contracts.ts` 为准；HTTP 和 Client 由这些 schema 生成。

开发时运行 `pnpm nx run subject:build`、`pnpm nx run subject:test`。真实事务与并发测试位于 `integration/foundation`；通过 `HEPTALOGOS_TEST_PG_BIN` 指向安装的 PostgreSQL bin 后运行 Life/Agency/Messaging 对应测试，避免把跳过的数据库测试记为通过。

`createPursuitService` 显式采纳 exact Desire/DesiredCondition revisions，并关联已经采纳的同 Subject Activity 与 open Nous WorkContext。来源修订/撤回、生命周期 epoch 或时间域改变会标记 reviewRequired、暂停该 Activity；继续前由 `guardActivity` 重新核验。`reconsider` 是明确换修订的采纳，保留旧 adoption/evaluation history，并保持执行暂停；实际执行仍走原 Life。官方 Motivation evaluator 是唯一真值与覆盖 owner，Pursuit 只保留实际 evaluationId、来源、verdict、finalConclusion、coverage 与时间域，不把任务完成等同于满足，也不创建后台 worker。
