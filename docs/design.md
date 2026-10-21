# 应用与事务

`createHept()` 组成 identity、communication、world、agency、work、management。每个模块提供完整操作，platform 只承担数据库、模型、配置与认证接线。HTTP 位于 `/v1`；输入由 Zod 校验，OpenAPI 在 `/v1/openapi.json`。

产品使用一个 PostgreSQL 业务库、一个 Kysely datasource 和 DBOS 官方 system schema。模块记录、对象修订与 subject changes 在短事务中保存。收件、主体前台、表达发送、原生任务和自然节点注册为 DBOS workflow。主观前台按 SubjectId 分区并发 1；等待下一节点的工作流独立运行。

模型按角色读取资源、参数和预算。每次调用先准备本次输入及可选 Nous ContextView，由官方 durableCalls 保存响应，再提交实际接触和用量。结果已保存而内部交接未完成时复用同一响应。提供方结果未知保留 unknown，停止自动再次付费。金额未知保存 null，调用数量和 token 按实际记录显示。

收件保存原始来源身份、有序 parts、转发作者与时间，编辑和撤回追加修订。通知只给出可见元数据；主体选择阅读后才取得正文，成功模型输入产生实际接触。表达模型取得对外意图和已经阅读的会话内容。发送使用本地消息 owner 或 AstrBot 的原生发送 owner，逐物理调用保留 accepted、not_sent、unknown。

WorldClock 持有精确微秒坐标、Clock 修订、不可变 Segment、离线政策与持久捕获；日历复用 Temporal 和 rrule 计算当地 recurrence 身份、DST 与例外。实际经过的区间形成 RealizedEvent，并根据实际活动更新精力与疲劳。旅行需要经过路线时长；到达前保持原地点。作者私密人物资料不会进入主体局部视角。

Pursuit 保存持续投入，Activity 保存生活活动，Task 保存原生执行及原目标，Commitment 保存向听众承担的责任。承诺意向在相关发送实际接受后生效。模型内部理由属于私密决定，普通未回复解释从已有通知、活动和决定读取。

认证使用 Better Auth 会话、管理员与 API key，当前授权沿实际 authorityRef 重读。Subject runtime 绑定实际用户的持续委派，Task 使用有限 Worker 委派；Host 逐次读取真实原生调用事实。SecretRegistry 持有独立 PG 元数据与 OS、环境、受保护文件后端，实际使用进入回调；Network 的 fetch 注入 SDK、原生桥与下载消费者。

Operation 入口提供状态、关联范围与安全错误；内容通过相应领域 owner 重新检查当前授权后读取。人工恢复错误工作流使用 DBOS 的同 ID rewind，从首个失败步骤继续；原调用的预算与外部效果记录仍约束后续派发。

主体导出采用暂停后的产品一致快照和内容字节，导入保留逻辑身份并暂停外部发送。分支的新 Subject、时钟与历史来源计划仍待完成，当前入口不可用。产品历史与实际外部效果通过各自正式记录保存；备份、原生历史和外部平台的删除结果按实际能力分别返回。
