# Heptalogos 项目与工程宪法

本文件保存实现便利、短期重构和框架选择不能随意改变的长期原则。长期产品目标由 Architecture-Vault 的 Heptalogos 目标设计进一步定义。

## 一、Subject 与权威

### C1. Subject 身份独立

Subject 与模型、Provider、Prompt、会话、消息账号、Host、安装实例和运维助手分别拥有身份。替换任何执行条件都不会自动产生新的 Subject。

### C2. 长期状态有正式所有者

持久产品状态由领域所有者维护。Heptalogos 保存世界定义、日程、已实现生活、行为、陈述、承诺、消息、外部效果和系统管理状态；Nous Wave 保存长期认知。世界事实、主体认识、向特定听众说过的内容与真实派发结果分别维护。Prompt 和 Context 只是一次调用的投影。Reactor以现有运行身份组织同Subject唯一前台，不增加通用运行平台；世界、专业任务与压缩可并行。关键进展同步保存，固定前缀摘要由单一原生owner发布并保留新尾部，摘要不是长期认知。

### C3. 认知与主动性分别提交

Nous Wave 可以表达主体的认知、愿望、关切和期望条件。Heptalogos 决定是否形成 Pursuit、是否采取具体行为、是否承担承诺以及怎样产生外部效果。

### C4. Proposal 不获得 Authority

模型输出、检索结果、认知结果、工具建议、扩展推断和 AI review 默认是信息或提案。正式产品状态由拥有者通过明确提交操作产生。

### C5. 三类 Authority 分离

Subject 行为、产品 System Authority、机器与部署运维分别使用独立权限来源。跨域请求可以携带 intent、context、reason 和 principal；权限本身不随上下文自动转移。

### C6. 行为提交集中、推理可以分布

消息摄入、检索、模型调用和候选推理可以并行。行为决定、承诺和 consequential effect 经过明确 Authority fence。

### C7. 沉默属于合法行为

Subject 可以观察、等待、延迟、审议后沉默、受策略抑制或无法回应。沉默有正式语义。

### C8a. 主体表达与生活连续

Subject 自然表达和具有人格含义的表现动作经过独立可配置的 renderer，并在正式采用前核对重要陈述。生成式世界可以实现虚拟经历；普通模型输出和计划本身不是已实现事件。主体允许明确隐瞒或说谎，其事先意图、实际世界和听众版本分别保存，不改写真实外部效果。

### C8. 外部世界允许不确定

外部请求发出后，结果可以是 succeeded、failed 或 uncertain。恢复、重试和超时不能伪造确定结果。

### C9. 产品真值可追溯

重要输入、行为决定、承诺、SystemAction、Effect、认知影响和恢复操作保留适合其语义的 Evidence 与 Execution Lineage。

### C10. 可移植状态跟随语义所有权

需要迁移的 Subject 状态存在于正式领域状态中，不能只存在于进程内存、cache、workflow 私有 checkpoint 或 Provider 私有对象。

## 二、运行与工程

### E1. Semantic Ownership First

领域所有者决定语义；成熟依赖提供通用机制。框架对象和存储实现不获得产品 Authority。

### E2. Library First

通用机制依次检查标准/OS 能力、当前已采用路线、成熟库或框架、薄适配与组合。自研需要具体不足证据。

依赖决定账本标为 `ADOPTED` 的通用机制或 Provider 必须使用已选路线；`project/dependencies/dependency-routing.json` 是相应的机器可读 route 与 `USE` 指令。实现必须通过声明的适配边界；若需要替换已采用路线，先更新有权威的依赖决定或授权 Plan。

### E3. Canonical Truth Before Async Work

外部输入先形成 canonical fact，再形成 durable work obligation。Signal 只用于唤醒和变化提示。

### E4. Desired State 与 Actual State 分离

长期意图和当前运行结果分别记录。失败和 Safe Mode 不静默改写长期 Desired State。

### E5. Reconciliation 驱动长期运行

产品根据 Desired State、Actual State、依赖、可用能力、健康和运行模式持续决定业务准入及处理机会。进程监督使用 OS 服务管理器，模型/工具循环和通用渠道持久机制使用 OpenClaw，不重复建立通用运行图。

### E6. Failure Isolation

非关键组件故障只影响相关 Capability 和 Readiness。管理、恢复以及不依赖故障组件的功能继续工作。

### E7. Derived View 不替代 Authority

索引、cache、telemetry、read model 和 Presentation 都可以重建，不能成为 canonical truth 的唯一来源。

### E8. Contract 优先于 Provider

业务依赖稳定 Service/Capability/Domain contract。具体 Provider、Driver、framework 和 storage engine 位于适配层后。

### E9. Cognition 通过合同接入

产品通过 Nous 官方 SDK 和同一独立 OpenClaw 集成获得认知查询、Context contribution、proposal/receipt、availability、configuration、Evidence 和 lifecycle。Memory、Self、Social Cognition、Motivation 等内部数据模型由 Nous Wave 维护。Heptalogos 自己维护 Pursuit、Commitment 和行为 Authority。

### E10. Presentation 是投影

CLI、HTTP 和外部 GUI 消费 Management/Subject contracts。Presentation 技术不拥有后端 Authority。

### E11. Machine Operations 独立

机器和部署运维拥有独立运行域、凭据和故障域。正常情况下通过 Management Contract 工作；break-glass 操作仍不会自动变成产品 canonical fact。

### E12. Network 与 consequential effect 受治理

网络访问具有 requester、目标、预算、超时、TLS/proxy 和 Evidence/telemetry 语义。真正具有外部后果的写操作继续经过 EffectOperation。

### E13. 持久合同显式版本化

跨进程、跨代次、可持久化或可回放的数据具有 contract/schema/protocol version。版本化不自动产生历史兼容义务。

### E14. 删除使用生命周期工作流

逻辑 tombstone、canonical purge、派生数据清理、Blob 清理和 backup/export retention 分别处理，由实际 DataOwner 协调。

### E15. 存储治理与存储引擎分离

产品组合各 owner 的 identity、workspace、backup/restore、purge/retention、portability、resource accounting 和 Lineage，不要求通用 Foundation 运行框架。领域可以选择符合自身需要的数据库、文件和索引。

### E16. 配置语义与配置存储分离

ConfigurationDefinition 描述 schema、scope、Authority、visibility、manageability 和 activation。不同 namespace 可以采用文件、管理修订、owner-native 或派生只读来源，同一 namespace 同时只有一个写入 Authority。

### E17. Background Work 有明确所有者

后台工作要么属于 activation/resource scope 并随生命周期取消与等待，要么成为 durable obligation。无 owner 的长期 task、timer 和 child process 不构成产品语义。

### E18. Recovery 保持有界

恢复不能依赖正在被替换或已经损坏的正常系统。越过不可逆点后优先进入明确的恢复、重启或人工处理状态，避免构造无法证明正确的回滚链。

### E19. 复杂度需要当前理由

新增持久状态、worker、公共抽象、恢复分支、security mechanism 或 generic framework，需要当前语义、当前消费者、已接受故障模型或当前安全威胁支持。

### E20. Executable Truth 独立验证

语义设计正确不代表产品可执行。重要 capability 在实际 boot、compose、work、stop、restart/recover 边界运行之前，其 executable claim 保持未验证。

### E21. Resource Pressure Is Explicit Product State

资源压力及由压力触发的 admission、degradation 和 load shedding 必须具有可观察的产品语义，不能由 Provider、队列或数据库的私有阈值暗中决定。相关架构使用 `NORMAL`、`THROTTLED`、`SHEDDING` 和 `BLOCKED` 表达不同压力状态；状态变化服从 Authority 与 Readiness。

## 三、优先级

发生冲突时依次检查 Architecture-Vault 的目标设计、本宪法中的 Authority/Truth/Safety 原则、当前 Specs、技术选择和实现便利。需要改变产品语义时先修改上游设计决定。
