# Heptalogos 管理所有者

管理 owner 提供管理员认领、Argon2id 登录、opaque session、稳定 Problem，以及产品配置、状态和 Subject 管理操作。模型、Nous、QQ 与 Subject Gateway 不构成管理启动前提。

`authentication.ts` 通过已有 canonical PostgreSQL repository 保存管理员、claim 和 session，保留所有权围栏、密码规范化、到期、撤销和 auth epoch。秘密明文只存在于调用边界；数据库保存摘要或 verifier。

`product.ts` 拥有产品管理 schema 和配置操作，复用 Configuration 的 revision/activation CAS。它通过 Host 注入的官方 Nous Client 操作读取或创建 Subject，不访问 Nous 数据库，不复制认知。安装、Host boot、配置修订、Subject 和依赖状态分别表达；`subject.enabled` 是产品意图，不能证明模型或 QQ 已准备好。

HTTP/OpenAPI 在 Product Host，生成客户端和 CLI 在 application 范围；OS 服务管理不在模型或该服务中运行。已被替换的 SystemAction 通用计划、运行图读模型和旧 AIRuntime 管理路径不再是本包接口。

运行包测试、构建及 type-aware lint；涉及鉴权、配置事务或恢复的变更还需真实 PostgreSQL 和独立安装闭环。精确规则见 [管理合同](../../../specs/management/system-authority.md)。

`ProductManagement.configuration(transaction?)` 在原生准入和发送检查中沿 Configuration owner 复用当前事务，使用同一份产品配置解析器。
