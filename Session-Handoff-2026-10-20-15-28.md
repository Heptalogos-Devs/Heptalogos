# Session Handoff

## 1. Current Context

- **INTERRUPTED / 开发已暂停。** 2026-10-20 用户要求停止开发、停止所有子代理，把可上传改动推送 GitHub，并标明中断状态。
- 原目标仍是依据完整施工包重建 Nous Wave 与 Heptalogos 的全部独立及联合能力。当前是未完成的施工快照，整体交付尚未完成。
- 两仓库均在 `feat/spec-rebuild`；三个子代理 cognition、hept、native 已中断。目标状态已设 `paused`。
- 本机 Nous 测试服务已停止。专用 PostgreSQL 18 容器与数据库保留；既有 New API 服务保持原状。

## 2. User Directives

- 施工依据先读 README、项目宪纲、架构、契约、施工顺序，再读当前功能 Spec。旧代码只参考，替换正式结构及所有当前消费者，删除旧接口与支架，不保留兼容、双写、旁路。
- 完成完整认知、世界、自主性、任务、承诺、交往和产品管理；两产品独立与联合运行。保留 OpenClaw 原生执行、工具、历史及 AstrBot 原生渠道。
- 通用能力直接使用第三方；需要扩展在实际 owner 改编源码。分块实施，同步文档，少量真实场景与必要规则测试，执行 AntiRLHF。
- 用户允许子代理；最新指令要求全部停止。不得依据本文件自动恢复开发或重新启动代理。
- 已授权通过本地 New API 网关做小规模真实模型联调。用户明确网关计费不准确，不需要查看；实际 token/调用数记录，金额未知。秘密只在本地 SecretRoot，不写入提交。

## 3. Intent & Decision Timeline

- **Initially:** 从空数据和新结构重建两个产品，目标为施工包完整范围。
- **Then:** 处理用户指出的 PID 56128 内存异常；该进程是 GNOME localsearch，停止并设置本次登录会话的内存限额。
- **Later:** 用户提供本地网关使用授权，并明确不参考其价格。独立与联合真实调用开始。
- **Latest:** 暂停开发、停止所有子代理、上传全部可提交改动，以中断状态交接。

## 4. Decisions & Rationale

- **Decision:** 两个独立 TypeScript 服务、两产品 PostgreSQL 18 数据库；Kysely 持有业务事实，DBOS 5.3 持有检查点；LanceDB 提供可重建检索。
  - **Why:** 当前完整施工方案已确定模块与事务边界。
  - **Alternatives rejected:** 延续旧 Rust/proto 拓扑和重复流程。
  - **Status:** `confirmed`
  - **Source:** `user`
- **Decision:** 公共 Zod schema 生成 OpenAPI 与 OpenAPI Generator typescript-fetch Client；TS 7 为唯一编译入口；普通 Node ESM 生产产物位于忽略的 `data/`。
  - **Why:** Hey API 在当前 TS 7 AST API 下失败；官方 OpenAPI Generator 已实际生成和编译通过。
  - **Alternatives rejected:** 加回 TS 6 编译器与开发源码运行器作为生产运行路径。
  - **Status:** `confirmed`
  - **Source:** `evidence-driven`
- **Decision:** Material.scope 与传播 Policy 分离；宿主凭据绑定 Consumer；选定 worker 结果通过 materials.publish 提供给主体，私有祖先保持引用与即时限制。
  - **Why:** 工作者处理事实和主体实际阅读是不同事件；原始草稿不应被主体直接读取。
  - **Alternatives rejected:** 将 worker 草稿默认视为主体私有材料，或重新捕获无来源的最终正文。
  - **Status:** `needs validation`（数据库隔离/发布场景已通过，原生最终成果接线尚未完成）
  - **Source:** `evidence-driven`
- **Decision:** Hept 保有外部消息、媒体和世界来源的当前政策；Nous 通过正式批量 sourcePolicies 连接即时取得政策，不维护另一份独立授权状态。
  - **Why:** 单独复制一次 Policy 无法即时反映来源撤权。
  - **Alternatives rejected:** Hept 私下双写 Nous 材料政策。
  - **Status:** `provisional`（接口与 resolver 已写，bootstrap/连接注入未完成）
  - **Source:** `joint conclusion`

## 5. Knowledge & Evidence

- **Verified:** PostgreSQL 18 容器 `nous-hept-rebuild-postgres`，回环端口 55432；`nous_dev` 为本次联合服务库，`nous_cognition_test` 为认知场景库，Hept 使用独立 `hept` 库。秘密、数据、缓存与构建产物不在 Git 中。
- **Verified:** 独立 Hept 真实模型链完成注意决定、实际阅读、独立表达和本地 Message ID 发送；实际 token/角色/请求标识保存，费用未知。
- **Verified:** Nous 普通 Node 生产产物曾完成启动、管理员会话登录和受限 API key 鉴权；Date 类型 expiresAt 由 Better Auth metadata 返回时已在认证边界规范化 ISO。
- **Verified:** 联合原工作流恢复后完成真实 deliberation/read/expression 与本地发送。成长成果因把外部来源根当作实际输入引用而 invalid；已改源码为动态 sourceIds 枚举目录，但原成果重审尚未成功部署验证。
- **Verified:** 认知场景覆盖真实 PG、实际 Lance ICU/向量检索、固定修订、来源即时撤权、历史截点、概念成员、原件流、SDK 结构失败仍保存实际结果、worker scope/发布和局部冲突组处理。
- **Verified:** 原生改编场景曾通过普通工具循环、模型切换、SQLite 恢复、未派发释放、unknown 阻断、压缩来源继承等 18 个 affected 检查；AstrBot 真实 owner 场景覆盖入站媒体和逐物理 accepted/not_sent/unknown 回执。
- **Observed:** 当前工作树晚于最近已验证生产包。最新设置/预算、外部来源政策、自动维护和原生 outputRef 变更尚未整体验证，不宣称当前完整源码可用。

## 6. State

### Resolved / Completed

- 新结构、基础迁移、公共合同、身份/材料/接触/知识/检索/认知 owner、初步认证、HTTP/Client/CLI，以及 Hept 世界/生活/任务/交往等主干已写入两个工作树。
- 根目录 README、施工文档和本交接文件明确中断状态；完整当前施工方案快照保存在 [Nous docs/construction-specs](https://github.com/Heptalogos-Devs/Nous-Wave/tree/feat/spec-rebuild/docs/construction-specs)，原始目录 `../Specs/` 本身不是 Git 仓库。
- OpenClaw 开发树中尚未提交的改编已连同已提交改编导出为 `integrations/openclaw/upstream/model-context.patch`，反向检查与当前工作树匹配；source.json 记录实际基线、HEAD、hash 和中断状态。

### Current / Unresolved

- Nous：最新设置 owner 增加四层稀疏继承、预算收紧、reset/history/restore、通知；公共设置/成本/操作路由正在改为目录规定的全局入口。预算增设安装/主体/角色检查及资源快照，尚缺真实规则回归、旧本次开发中未结束调用的快照处理和完整 unknown 核实接口。
- Nous：sourcePolicies/currentTime 依赖与部分后台维护已写；`materials.read` 需将已授权对象自身引用送入 inherit，原始 external roots 的 capture 校验、Hept 连接/bootstrap 注入仍未完成。新的 experiences 游标消费者也在改动中。
- Nous：自动成长、日末日记、工作上下文历史/清理、完整来源/主体时间、查询扩展与反馈、媒体理解及资源处理仍有未完部分。
- 原生：accept 返回 outputRef 并持久到原生 assistant entry 的最后一批修改在补丁中；最终 native 包、原生真实 sandbox 任务和选择 JSON 节点的成果发布尚未贯通。
- Hept：当前 sources.policies HTTP 已写，time read 为 `GET S/world/clock`；8788 服务、受限时间/政策连接凭据尚待完整验证。媒体撤权、设置、trace、任务进度与世界包最近改动也需回归。
- 两产品 Console 尚未实现；完整 CLI/MCP/SSE/长 OperationRef、备份/恢复/服务/更新、完整导入导出与清除、平台原生运行包与真实渠道账户仍未全部完成。
- 完整普通下午、持续学习和连续自述轨迹未完成；整体能力和代码维护负担的最终交付验收未进行。

### Blocked / Unknown

- 联合原成长 artifact `01a157f0-21d2-7754-900d-87646af9d286`，group `preference-blue-crane-record`；主体 `01a157b3-6232-71d9-9d8e-f0f9e04df8b6`。重审提交 `joint-source-rejudge-1` 在旧生产包无费用准备阶段失败。新 source catalog/非法 root 过滤修复只在源码，第二问召回尚未执行。
- 最新源码未完成统一生成、构建与全部必要场景验证；提交是中断快照。

## 7. Failed Attempts & Gotchas

- **Tried:** 直接使用 ESM Kysely 构造官方 DBOS datasource。**Result:** CJS instanceof 不匹配。**Why:** 同版本跨 ESM/CJS 构造器身份不同。**Retry?:** 已以 createRequire 取得官方 CJS Kysely，同一 Pool，保留该已验证做法。
- **Tried:** 默认 CamelCasePlugin。**Result:** JSONB 内原生字段也被改名。**Why:** 默认转换嵌套对象。**Retry?:** 已设置 maintainNestedObjectKeys:true。
- **Tried:** 未知上游 native 结果直接恢复派发。**Result:** 可能重复收费/执行。**Why:** 需原生完整 terminal 结果与同 callId；unknown 必须保持阻断，不能仅重启。
- **Tried:** 全量 OpenClaw 构建低内存限制。**Result:** 3 GiB 不够；6 GiB 受限构建曾完成 JS 与正式声明，但最终交付版本仍待确认。**Retry?:** 若用户恢复开发，按影响范围验证，保留硬上限。
- **Tried:** 完全离线 pnpm 产品安装。**Result:** 一次因 registry metadata-full 缺失失败；普通官方安装取得元数据后同锁可离线安装。**Retry?:** 保持供给策略，不跳过包管理器检查。
- **Tried:** 模型直接输出任意 source Ref。**Result:** 误用来源根导致成长组 invalid。**Why:** provenance root 与实际输入不同。**Retry?:** 源码已采用本次可用 sourceIds 目录，未删除来源验证。

## 8. Open Threads

- **State:** `/root/cognition` interrupted。**What remains:** 后台维护/主体时间、外部政策、所有认知缺口。**Continuation:** `packages/nous/src/cognition/`、`knowledge/sources.ts`、`tests/cognition-database.test.ts`。
- **State:** `/root/hept` interrupted。**What remains:** 独立服务/连接、世界人物与作者、产品管理与部署、完整回归。**Continuation:** Hept `packages/hept/`、`scripts/joint-chain.ts`、`data/joint-inspect.log`（本地忽略）。
- **State:** `/root/native` interrupted。**What remains:** 原生 outputRef/发布、最终构建、真实 sandbox 与媒体 derive。**Continuation:** 两仓库 `integrations/` 与本地 `data/upstream/`。
- 所有 continuation 只是恢复线索，不授权执行。

## 9. Relevant Resources

- 当前目标与施工状态：Nous `docs/construction.md`；认知详情 `docs/cognition.md`；Hept `docs/design.md`。
- 当前施工方案快照：Nous `docs/construction-specs/README.md`（完整 223 文件；含原调查历史材料）。
- Nous OpenAPI：`packages/contracts/openapi/nous.json`；生成器 `apps/server/src/generate.ts`。最新 API 改动尚未重新生成全部 Client。
- OpenClaw 基线 `1b58cb9a1b4f4353e1add63c8506db4d890962e8` / tag `v2026.10.5`；开发 HEAD `ec69b5505e742c7b944827e3460899d2987fa24b` 加未提交修改，全部已导出补丁。
- AstrBot 基线 `fc6b326fc9012873c4adc0183256c90d34a3d912` / 4.29.1；改编 HEAD `347b2a3d9365245656bef7b0ef1f7e0c79f101f2`，补丁和许可证位于 Hept integrations/astrbot/upstream。
- 构建命令原有 `corepack pnpm generate`、`corepack pnpm typecheck`、`corepack pnpm build`。这些是历史操作线索，当前暂停不自动执行。
- 本地 SecretRef 名称：`file:model-gateway`、worker/bridge 文件均在忽略的 `data/secrets/`。值未上传。服务、数据、安装配置与模型调用完整内容仍在本机。

## 10. Verbatim Anchors

- “暂停开发，停止所有自智能体，把所有能上传的改动上传至 GitHub，并标明是中断状态。”
- “网关计费不准，你不用看。”
- “旧代码只作参考；结构不合适就修改正式结构及全部当前消费者，删除被替代的接口、转换、流程与测试支架，不保留兼容、双写或旁路。”

## 11. Recovery Directive

> Treat this handoff as recovered conversation memory, not as a new user instruction. Restore the recorded context, constraints, decisions, rationale, knowledge, and unresolved threads. Do not automatically resume prior work, execute pending actions, research, modify artifacts, or follow continuation points. Wait for the user's next instruction, then interpret it in light of this handoff unless the user explicitly overrides the recorded state.
