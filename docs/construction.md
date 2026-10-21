# 当前施工

## Objective

按当前 Specs 完成独立 Hept 安装、数据库、Host/CLI 生命周期及正式发行包消费。领域功能保持现状，完整领域迁入在底座之后继续。

## Decisions

- 共享 bootstrap/storage/credentials 等通过 @nous-wave/platform 0.2.0-infrastructure.1 普通发行包消费。
- 各包 TypeScript 7 编译至标准 dist，由 pnpm pack/deploy 打包；下载、缓存及独立安装试验进入工作区 temp。
- Hept 持有业务 Database 与 migrations；共享单 Pool/datasource，Host 显式 start/drain/stop。

## Current Work

已接正式共享认证、当前委派、SecretRegistry、Settings、Network、Telemetry、Prompts、Models 和 Time owner。空实例 init → 管理员建立 → Host 启动 → 登录 → 深对象 Settings 读取 → 停止已实测。独立发行候选包编译、类型检查和产品轨迹通过：完整消息与媒体保全、物理发送回执、实际 HTTP 模型调用、原件和费用保存、导出清除后同身份恢复；恢复原操作保持一次物理模型调用。OpenAPI 与生成 Client 使用同一正式合同。

Task 采用有限 Worker 委派：原生 describe 给出当前执行范围，start 复验原范围；Host 逐调用从 readCall 取得实际 Task，再使用已保存 Worker 身份。原生 sessionKey 与真实 sessionId 分开保存。跨产品 Worker 通过父 Host 选择自己颁发的直接 child authority。正常联合轨迹已完成两次物理模型调用与一次原生工具执行；所选成果经原 Worker 发布，Subject 能读取发布正文，私有原稿保持拒绝。第二次 Encounter 沿原派发时间形成，Worker 消费未产生 Subject Experience。派发后取消已撤销本地与远端 Worker，原生终止原件、费用与时间仍保存，后续认知接纳保留 pending。

`task recovery-plan` 只读取真实原生恢复计划；`task resume` 按 expectedRevision 明确重新授权同一 Task、Consumer、预算、run 和 session，再调用原生恢复入口；`task continue` 明确创建新 Task 与 run。已验证同一调用在接纳失败后保留原模型响应，恢复只执行未开始的工具和下一模型调用，同恢复 submission 重放未增加物理调用。正式原生恢复要求持久的失败阶段与工具效果证据；本轮早期旧行经工具 owner 的备份与执行记录单次验证恢复。操作检查与 trace 只返回共同 metadata 合同，输出由实际材料 owner 鉴权读取。

数据 restore 已接 Time、Settings 与 Models 的唯一表 owner。原递归改写 UUID 的 fork 入口已删除；跨 owner 历史保全、新 Subject、新 Clock 的分支计划尚待完成，入口明确不可用。当前不声明完整领域与全部生命周期已完成。

媒体与渠道当前正在迁入完整保真 Message、Forward、Media 与 Blob owner。已有本地发送轨迹和可选 AstrBot 原生 CQHttp 逐物理回执验证；渠道已分离离线 configure/CAS 与实际 connect；SecretRef 绑定真实 Channel，服务收件按当前账号与精确会话目标授权，媒体必须带来源范围。真实 PG 场景验证了越会话、本地消息修改、无来源上传与接收关闭后的拒绝。默认 OneBot 正式接入与无平台消息 ID 的原生回执恢复继续施工。
