# 持续主体、世界与 QQ 上线

状态：ACTIVE。本计划是本系列唯一活动施工授权；2026-10-16 完整纠偏包替代此前 QQ 包。用户已授权完整实施、语义分支/PR/既有检查/Squash Merge及现有 Linux 安装续建，不能在文档 PR 或首次 QQ 回声后结束。

## 目标与决定

交付同一 Subject 的独立虚拟生活、主观选择、多角色执行、人格表达、认知成长和真实 QQ 交往。长期语义由 Architecture-Vault 的[目标设计](https://github.com/Heptalogos-Devs/Architecture-Vault/blob/main/docs/Heptalogos/TARGET_DESIGN.md)和[共享合同](https://github.com/Heptalogos-Devs/Architecture-Vault/blob/main/docs/integration/cognition-agency.md)拥有；当前实现与待实施合同在所属 Spec 明确区分。

- WorldLife 保存世界定义、规律、日程、场景、虚拟 actor 和 realized events，沿现有 Activity 与 PostgreSQL 短事务实现，不用 progress.note 替代生活史。无 QQ、account 或 conversation 时也能推进和审议。
- 同 Subject 的 world planning、deliberation、execution、render、narrative review 使用正式原生 role/purpose/视角；Nous reflection 与独立 maintenance 各有边界。替换旧 AIRuntime 和固定 main/worker 产品角色，不另造 Agent Runtime。
- 所有 Subject 自然表达与人格动作经独立 renderer；目标模型 doubao-seed-character-260628，实际配置由已授权原生 profile 决定。未配置时暂停相关表达，不能执行模型直接发言。机械状态通知保留系统归属。
- NarrativeCommit 在同 Host 短事务采用兼容 WorldPatch、最终表达/Claim、Commitment及唯一待派发意图。实际网络在事务外，保持 accepted/failed/uncertain 与禁止自动重发。
- Nous EpistemicView 交付主体已知、经验、局限和新资料。后台专家知识不自动成为个人知识；worker 成果经显式有界 handoff 才产生 Subject contact。
- 管理 API/Client/CLI 在模型、Nous、QQ故障时仍能工作；主体与维护 OpenClaw 独立 profile、端口、workspace、状态与秘密。保留已交付身份、消息/媒体、来源、Activity/Pursuit、Self/Social/Motivation及依赖修复。
- 保全原 Subject、data、密钥、付费结果及全部 staged/unstaged/untracked、未推送工作后才整合。无跨 Nous 私有表、无双写/shim、无新增资格门禁；普通 CI 不成为新增执行路线，pnpm verify 保持。

## 施工与当前状态

1. 正式设计纠偏：Vault、共享合同、本计划、治理和所属 Spec 原位更新。该步骤本身不证明功能已实现。
2. 世界纵向消费者：正式定义/规律、时钟、日程/realization、角色视角、无 conversation 的内部机会与原生 scheduler；Nous 带域时间与 world provenance 同步贯通。
3. 角色链与叙事：可信 RoleRun、用途/接触隔离、独立 render/review、NarrativeCommit/Claim、统一外发。原生 child 终态仅为 execution_only；显式释放成果后才进入审议。
4. 知识与成长：EpistemicView、学习、Self/Social/语言/Motivation的世界消费者，复用 shared reflection、正式来源和模型成果恢复。
5. 操作与部署：正式 CLI/API 配置角色/世界/历史/陈述；全新独立产物、安全依赖、原安装切换、实际 QQ 媒体、停止/下一运行日恢复。

已交付基础以当前代码为准：Activity/Pursuit、原生 Life 进展、可信消息接触、唯一发送和管理已有实现。WorldLife、强制 renderer、NarrativeCommit、角色用途及完整世界认知接线在相关功能落地前均为待实施；不能把本计划或类型出现当作完成记录。每个单元完成后同步 owner Spec 的实现范围并继续下一单元。

## 验证与结束

沿用 pnpm verify 和必要聚焦检查，测试真实 PostgreSQL 并发/事务与独立安装。用正常公开 CLI/API 采用明确测试 Subject 的高中世界，QQ关闭时实现课程/课间/娱乐；接入真实 QQ 后在自然节点查看来信，重复询问同一生活时段、知识范围和实际学习。实际调用 world/deliberation/worker/render/review，核对隐瞒与听众版本、延迟/取消/uncertain及媒体接收端。操作者不预填理想 event/claim 或替主体决定是否参与。

至少实际停止并于下一实际运行日恢复原 Subject/任务，分别验证离线虚拟 realization 与真实QQ历史缺口。内部 fixture、readyz、加速世界钟均不能替代实际上线边界。缺凭据、扫码或时间窗口仅暂停相应操作并如实保留未完成项，其他施工继续。不新增付费服务或扩大授权会话。完成尺度为已安装可正常生活与交往的实例、正式操作入口、当前文档与真实结果。
