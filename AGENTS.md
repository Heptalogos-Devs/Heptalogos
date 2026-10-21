# Heptalogos

从空数据重建，PRE_PRODUCTION。当前建设依据是同级 `Specs/README.md`、`项目宪纲.md`、`施工顺序.md` 和对应领域设计；旧源码与旧计划保留在 Git 历史供查阅。

使用已定的两个模块化 TypeScript 服务、产品数据库及模块事务边界。业务入口为 `createHept`；HTTP、CLI、工作流调用同一 owner。正式目录：`apps/server`、`apps/cli`、`packages/hept/src/{identity,communication,world,agency,work,management,platform}`、`packages/contracts`、`packages/client`、`packages/console`、`integrations`、`packages/hept/migrations`。

共享纯值从 `@nous-wave/contracts/common` 引入；长期认知只通过 Nous Client。通信保存完整有序 parts、来源身份、实际感知和逐物理调用回执。世界作者私密信息保留在 world，表达输入按实际听众组织。模型 actor、权限、时间和用途由受信宿主提供。

短修改用 Kysely；完整持久操作使用 DBOS 与官方 Kysely datasource；模型调用采用 AI SDK 和官方 durableCalls。不建立第二套队列、步骤、租约或恢复解释器。通用能力直接采用第三方。上游扩展在实际 owner 的源码改编并构建，安装不搜改 node_modules。

修改所有当前消费者并删除被替代结构。测试复用少量实际轨迹及必要规则，不为薄转发、生成代码和库机制另建支架。运行 `pnpm typecheck`、受影响测试及构建；当前文档描述实际代码。各包正常编译至 `dist/`，使用 pnpm pack/deploy；新增下载、缓存和安装试验放工作区 `temp/`，已有 `data/` 就地读取。

遵循 AntiRLHF：让用户目标决定下一步，持续保留 Objective、Decisions、Current Work；直接修正式 owner，完成授权工作。默认分支仅集成，提交使用 PR 与 squash merge。
