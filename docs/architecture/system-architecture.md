# 总体系统架构

## 当前产品宿主

Product Host 直接组合安装所有权、私有 PostgreSQL、持久化、配置、管理员鉴权和管理 HTTP。它不启动 RuntimeKernel、DBOS、旧 Subject Executor 或模型。Nous、QQ 和两个 Gateway 均不构成管理启动前提；独立安装后的 CLI 通过同一管理合同操作产品。

管理状态分别展示安装、当前 boot、配置修订、Subject 绑定和外部依赖。配置中的运行意图与真实依赖可用性分别表达，避免用管理 HTTP 正常推定主体可以行动。启动、停止与恢复的当前入口见 [Product Host](../../packages/application/product-host/README.md)。

## 认知与原生执行

长期认知由独立 Nous Wave 保存。Host 使用独立发布的官方 Client 查询实际服务、创建或绑定 Subject；两侧共享 SubjectId，产品不读取 Nous 私有表或复制认知。

活动计划正在接入正式 OpenClaw 原生循环和 QQ Channel。OpenClaw 拥有模型、工具、子 Agent、durable ingress/send；Heptalogos 拥有消息、实际接触、活动、注意、行为采纳和结果。当前管理接入与后续主体运行的区别见 [认知接入](cognition-integration.md)。

## 保留的领域和机制

仓库保留独立有效的 Foundation、Subject、Messaging 等库。它们可供新产品组合复用，但包存在或其测试通过不表示已接入当前 Host。旧 AIRuntime/proposal-only 主体组合和 Subject Chat HTTP 路径已从宿主移除。

生活、社会语言、Motivation/Pursuit 及连续运行按 [活动计划](../../project/plans/qq-continuous-subject.md)推进。长期领域模型由 [Architecture-Vault](https://github.com/Heptalogos-Devs/Architecture-Vault/blob/main/docs/Heptalogos/TARGET_DESIGN.md)维护。

## 管理与维护

CLI、HTTP 和外部界面消费同一 Management Contract，业务事实保留在其所有者。管理员身份不自动授予普通主体消息以管理权限。

Subject Gateway 与 maintenance Gateway 使用独立 profile、端口、状态和秘密。当前安装器预留其位置，未配置时明确显示 unconfigured；维护控制不依赖主体健康，也不取得主体的发言权限。当前管理权限见 [管理合同](../../specs/management/system-authority.md)。
