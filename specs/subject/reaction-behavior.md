# 行为采纳、唯一发送与真实结果

## 正式行为

Agency 接收当前原生 producer run、账号、受众、引用和线程，以及通过原生 policy/hook 后的完整 prepared batch。每个 accepted payload 保留原始 sourceIndex；相同正文的两项也是不同的 payload，不能靠文本匹配关联。正式输入及结果见 [agency-contracts.ts](../../packages/product/subject/src/agency-contracts.ts)。

Host 保存完整采纳事实与稳定 nativeIntentId，重复同一 intent 只能得到同一行为；改变内容或受众会被拒绝。新的发送许可必须绑定实际采用的主观决定、renderer/review结果和当前RoleRun权限；main/worker机械标签不授予产品发言权。专业执行者不能借用主线程账号直接发言。

当前 QQ 发送每个完整采纳的 source payload 为一段。实际正文和媒体必须与采纳内容一致，不接受 substring 许可。引用和线程按原生 first/all 与逐 payload 显式引用语义核对。

## 发送点

所有最终回复、message 工具、主动/定时消息、子 Agent 通知和媒体经同一个正式 Channel adapter。OpenClaw 持有 durable send queue；Heptalogos 保存采纳与实际每段回执，不运行第二个网络发送 worker。

`authorizeDelivery` 检查当前 actor、账号、受众、具体来源与活动；`beginDelivery` 在 Host 短事务内锁定行为和活动，决定返回旧 accepted 结果或允许唯一新 attempt。取消先提交时不得再取得新发送点；已取得发送点的实际结果即使在取消后返回，仍须保存。

许可还依赖当前安装的外部效果范围。仅观察会话在 adapter 实际网络边界拒绝发送、媒体、编辑、撤回、反应和管理等效果，不能依赖 prompt 或会超时放行的 hook。

## 结果

| 事实                            | 结果                                 |
| ------------------------------- | ------------------------------------ |
| 明确尚未越过网络发送点          | not_sent，可在原预算内重试或取消     |
| 平台接受且返回稳定 message id   | accepted，幂等返回原回执，不再次发送 |
| 平台明确拒绝                    | failed，新的发送需要新的正式操作     |
| 越过发送点后断线、超时或退出    | uncertain，禁止自动重发              |
| 同 attempt 后来获得可靠平台回执 | 可将 uncertain 解消为 accepted       |

accepted 保留首次可靠回执的本机 `acceptedAt`，用于原生 receipt 恢复；它不冒充 QQ 平台发送时间。取消、服务恢复或诊断失败不能覆盖已知 accepted，也不能阻断其幂等回传。文本相似或历史中未查到消息都不能消解 uncertain。多 payload 保留各自结果，不能把部分成功整体重发。

## 认知回流

原生模型/工具实际结果、行为采纳、平台接纳和外部反馈分别保存，引用原始 Invocation、Activity、MessageFact 和行为身份。后端暂时不可用时保留第一份 canonical Observation 与实际结果，随后按同一 requestId 补交；不重跑外部动作。

来源包含实际作者、时间、generated/external 归属和原始来源范围。选入上下文不等于 acted_on；模型自行列出的引用不能证明行为因果。普通群成员不能通过聊天获得管理连接。

真实 PostgreSQL 测试保护采纳幂等、原始索引、引用/线程、已知结果、uncertain、取消锁交错和受限 worker。上线还须操作独立安装的 OpenClaw、实际 QQ 与收件客户端，确认没有重复发送或误报成功。

## 人格与叙事采用

所有Subject自然文字及人格表现动作经独立[原生renderer](../system/ai-runtime.md)。[Communication/Narrative](narrative-claims.md)先处理明确的新世界事实和严肃承诺；普通候选保存原文、实际听众、来源、意图与唯一待派发身份后发送，Claim索引后台推进。已知重要冲突只同步处理相关候选一次。world/worker/child结果仅作为任务资料，不能原生announce到QQ。系统机械通知保持系统归属。

原生producer使用的派生来源（正式world-event、精确RoleResult release）须由Host沿原Activity、canonical owner记录和当前权限核验，再以authorizedDerivedSourceRefs交Agency。字符串前缀本身不能授予读取或发送权。普通消息仍沿实际听众的Messaging来源检查。
