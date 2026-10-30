# Heptalogos 主体架构

Heptalogos 在 MaiBot 的通信、消息与多模态、学习、插件和 WebUI 基础上发展持续主体。[项目宪纲](https://github.com/Heptalogos-Devs/Architecture-Vault/blob/main/项目宪纲.md)定义完整目标；[跨产品架构](https://github.com/Heptalogos-Devs/Architecture-Vault/blob/main/设计/整体架构与模块合同.md)定义与 Nous 的责任。

- **Reactor 与 Attention**：将世界、日程、设备、消息、任务结果和内部动机组织为活动机会；一个主体拥有统一主观前台，可扫视、中断和恢复。后台任务与多平台会话可并行。
- **World、Calendar、Living**：Hept 持有世界设定、客观 NPC、世界时钟及映射、日历和已实现生活历史。生活可在没有消息时推进，重要事件分段形成经历。
- **Agency**：主体依据情境与长期认知选择注意、交往、探索、休息、委派或行动；Hept 持有已采用的计划、承诺及实际结果。表达角色表达已采用的意图，工具与平台执行。
- **Communication 与身份**：MaiBot 继续提供平台接入、原始多模态消息、插件和事件接口。Hept 保存真实账号、会话、消息、附件及发送回执；跨平台、跨群聊和执行者共享稳定逻辑 Subject ID。
- **Nous 与实际感知**：Nous 持有记忆、知识、人格、社会关系、语言惯例和动机。Hept 通过受限正式接口提交主体实际接触的消息、已实现经历、工具结果、发言与反馈，并按用途和听众取得认知。消息保存、通知、扫视、阅读、模型接触、认知形成、行动采用与物理发送分别记录。世界时钟由 Hept 持有，认知五轴时间由 Nous 按来源与时域保存。

以上主体内核、世界、统一注意和 Nous 连接尚未实现。当前 `main` 是未改造的 MaiBot Fork；后续改造保留第三方插件可调用的接口、角色与事件语义。
