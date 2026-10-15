# 产品形态

Heptalogos 面向真实即时通信中的持续 Subject。产品负责消息、生活和行为；Nous Wave 提供同一 Subject 的长期认知，正式 OpenClaw 提供原生模型、工具、渠道和子 Agent 循环。长期目标由 [Architecture-Vault](https://github.com/Heptalogos-Devs/Architecture-Vault/blob/main/docs/Heptalogos/TARGET_DESIGN.md)维护。

## 当前可以使用的入口

无图形 Product Host 和独立 CLI 提供管理员认领、登录、状态、配置以及 Subject 查询、创建、绑定。Host 管理可在 Nous、模型、QQ 和 Gateway 停止时继续工作。创建独立 Subject 可不提供 Seed；提供 Seed 时也不与其他 Subject 共享身份。

安装和首次使用见 [Product Host](../../packages/application/product-host/README.md)，日常管理见 [CLI](../../packages/application/cli/README.md)。安装身份、配置修订、SubjectId 和外部依赖状态分别表达，不能以管理在线推定 QQ 主体已经上线。

## 正在完成的持续主体

[当前计划](../../project/plans/qq-continuous-subject.md)按完整能力交付 QQ 接收与唯一发送、消息媒体保存、活动与注意、Self 成长、社会关系和语言惯例、Motivation/Pursuit，以及停止补拉和跨日恢复。实际运行必须操作安装的软件，并在 QQ 和真实模型/工具中验证。

产品将消息接收与主体实际接触分别记录，只让实际接触进入认知。自动回复、工具发送和主动活动共用实际发送授权，群与私聊按明确范围使用。普通聊天不取得管理权限。

Subject Gateway 与维护 Gateway 各自隔离状态、凭证和工具。当前管理安装预留两个位置，未配置时清楚显示；它们不是管理的启动前提。旧 Subject Chat HTTP 与内置旧 OpenClaw 组合已移除，后续主体消费同一正式 Nous 插件。

## 状态与合同

管理接口由 schema/OpenAPI 生成 Client，再由 CLI 消费；不会另设一套界面业务规则。当前精确合同见 [Management Spec](../../specs/management/system-authority.md)。UI、目标领域模型和运行验证各自描述其实际边界，已保留的库或历史资格记录不能替代上线结果。
