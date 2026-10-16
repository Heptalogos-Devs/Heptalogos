# Heptalogos Project Charter

本文件定义 Heptalogos 代码仓库长期有效的产品姿态和工程执行原则。长期目标设计由 `Heptalogos-Devs/Architecture-Vault` 维护；本仓库负责实现、规格、计划和实际验证。

## 项目职责

Heptalogos 是持续 Subject 的产品宿主与主动行为系统。它负责频道无关的 WorldLife、世界定义与日程、已实现生活、主观选择、人格渲染、陈述与承诺、真实即时通信和其他外部效果，以及产品管理和可靠运行。生成式虚拟事件经世界 owner 采用后形成合法生活事实；它们不证明真实工具或平台效果。

Nous Wave 负责长期认知。Heptalogos 通过正式合同读取认知、接收期望条件并回传行为结果，不复制 Memory、Self、Social Cognition、Motivation 的内部模型。

## 产品不变量

1. Subject 与 Model、Provider、Prompt、Session、Host 分离。
2. 同一 SubjectId 可以跨 Nous Wave 与 Heptalogos 保持身份连续，两侧领域状态分别提交。
3. 模型、认知查询、检索、工具和扩展推断默认提供信息或提案；正式行为和系统变化经过拥有者提交。
4. Desired Condition 表示认知期望；Pursuit 表示行为侧持续主动追求；BehaviorIntent、Plan、Commitment 和 Effect 各有独立语义。
5. Subject Authority、System Authority 与 Machine Operations Authority 分离。
6. Canonical fact 先于由它产生的异步义务。
7. 外部效果允许 `uncertain`；无法证明结果时保留不确定性。
8. 重要行为、状态变化和恢复操作具有可追溯来源和执行血缘。
9. 运行代次受到 fencing；退休代次不能取得新的当前工作或提交当前结果。
10. Presentation 只投影产品合同，不持有产品 Authority。

## PRE_PRODUCTION

当前处于快速研究与原型阶段。开发历史不产生兼容义务。现有内部接口、schema、包结构、测试和文档都可以在当前设计要求下直接删除或重写。

兼容路径仅在当前实际消费者或正式合同具有明确义务时存在；开发历史本身不产生义务。

## 工程所有权

Heptalogos 自己维护产品领域语义。数据库、工作流、协议、DI、日志、网络、密码学和其他通用机制优先使用成熟库或平台能力，并放在 Heptalogos-owned adapter 后。

新增持久状态、后台 worker、恢复路径、公共抽象或安全机制需要当前语义、当前消费者、已接受故障模型或明确 Plan 的支持。

## 可靠性

优先顺序是权威事实、ownership fencing、常见故障恢复、明确降级和可检查失败。恢复能力保持有界；无法安全继续时允许 fail-stop、FENCED、BLOCKED 或人工恢复。

## 验证

测试和资格记录证明明确的合同和执行边界。一个平台不证明另一个平台，source-tree 执行不证明 source-less 分发，mock 不证明真实 provider。

## 知识职责

- Architecture-Vault：长期目标设计、设计决定、论证和跨系统合同。
- `project/governance/`：本仓库长期工程治理。
- `specs/`：当前可执行实现合同。
- `project/plans/`：当前施工授权和完成记录。
- `project/qualification/`：已经执行的验证证据。
- `docs/architecture/`：当前实现架构和跨包关系。
- Git：历史设计、旧实现和开发 chronology。

当前活动文档只描述当前有效知识。
