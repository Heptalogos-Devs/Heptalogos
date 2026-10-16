# 依赖使用与实现路由

本文件是 Foundation **已冻结 mechanics 的实现路由表**。它回答的不是“有哪些候选”，而是：

> **当代码需要某类 generic mechanics 时，应当使用什么标准/库/框架，以及该依赖允许出现在哪一层。**

机器可读路由见 `project/dependencies/dependency-routing.json`；角色状态 Authority 仍为 `project/qualification/dependency-status.json`。

---

## 1. `ADOPTED` 是实现指令

当某角色 `RoleDecision = ADOPTED`：

```text
需要该 mechanics
→ 使用本表指定的 standard/library/framework
→ 通过 Heptalogos-owned adapter/facade 暴露稳定合同
→ 执行对应 conformance/product qualification
```

不得因为以下理由另写一套平行实现：

```text
“少一个 dependency 更保守”
“自己写只有几十行”
“暂时不想改 package.json”
“标准库也能勉强做”
“先写一个简单版本以后再换”
“AI coding agent 默认不新增依赖”
```

如果既定依赖确实出现 hard blocker，正确流程是：

```text
记录具体失败性质
→ 重新打开该 RoleDecision
→ L0/L1/L2 qualification
→ 更新 dependency-status / routing / ledger
→ 再替换
```

不能在产品代码中偷偷保留一个未经批准的 custom fallback。

普通成熟库/工具只需使用 pnpm Catalog 和 pnpm-lock.yaml 的正常依赖机制。
它们不因是外部 package 就自动获得 RoleDecision、qualification ID、probe 或
matrix。Qualification 用于解决具体不确定性或证明已声明的 provider/platform/
artifact 边界，不是 npm package 的入场考试；dependency count 也不是质量指标。

### Mechanics lookup algorithm

Before adding or expanding a generic mechanic:

```text
1. search the target package for an existing owner or primitive;
2. search workspace exports and packages/INDEX.md/README files;
3. consult dependency-routing.json and the implementation route;
4. reuse the existing owner or extend it with the smallest reusable primitive;
5. otherwise use the adopted Standard/Node/OS or library route behind an adapter;
6. use custom mechanics only with explicit plan/change-rationale evidence.
```

Examples:

```text
Ajv/TypeBox validation       → schema-runtime
complex local state machine  → XState behind the owning package
repository process execution → repo-kit process helper / Execa
repository YAML parsing      → repo-kit YAML helper / yaml
read-only file discovery     → repo-kit discovery / tinyglobby
```

An existing implementation is not evidence that a duplicate is legitimate.
PRE_PRODUCTION cleanup deletes a replaced implementation and its obsolete
exports, callers, tests, and dependency declarations; it does not add a
compatibility wrapper.

---

## 2. Foundation mandatory routing

| Generic mechanics                      | Implementation route                                                                                                     | Integration boundary                                                                                                       | 禁止的默认替代                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| JavaScript runtime                     | Node.js 24 LTS line; exact shipping patch pinned                                                                         | Product Runtime                                                                                                            | Bun/Deno/embedded alternate runtime without reopening role                    |
| Workspace/package manager              | pnpm 11 stable line                                                                                                      | repository tooling                                                                                                         | npm/yarn lockfile coexistence                                                 |
| Monorepo task/project graph            | Nx 23.x line                                                                                                             | repository tooling / dependency-boundary gates                                                                             | hand-written recursive build orchestration                                    |
| Primary compiler                       | TypeScript 7.0.x (`tsc`)                                                                                                 | canonical build/typecheck                                                                                                  | TypeScript 6 as product compile Authority                                     |
| Compiler-API compatibility             | `@typescript/typescript6` 6.0.x, isolated compatibility lane                                                             | Nx/typescript-eslint/other API-dependent tooling only                                                                      | allowing TS6 compatibility to define product language baseline                |
| Primary JS/TS lint                     | Oxlint 1.x + oxlint-tsgolint 7.x                                                                                         | repository correctness/restriction/type-aware lint; TypeScript 7 remains canonical typecheck                               | ESLint as the general lint engine                                             |
| Nx boundary lint                       | ESLint 10.x residual `@nx/enforce-module-boundaries` lane; typescript-eslint parser only where required                  | Nx module-boundary enforcement                                                                                             | community Nx-Oxlint integration or duplicated boundary parser                 |
| Source documentation lint              | `eslint-plugin-jsdoc` 64.x behind the repository ESLint lane                                                             | package/module file overviews and public exported-contract documentation                                                   | custom TypeScript/JSDoc parser or fixer-driven documentation generation       |
| Generated API reference                | TypeDoc 0.28.x + `typedoc-plugin-markdown` 4.x from canonical `dist/*.d.ts`                                              | `docs/reference/api` generated projection; source TSDoc remains authoritative                                              | custom AST/export/JSDoc parser or hand-rendered API reference                 |
| Node ambient types                     | `@types/node` 24.x, same major as shipping Node                                                                          | compile/typecheck environment                                                                                              | global-latest Node types from a newer runtime major                           |
| Language/module baseline               | TypeScript / ESM-first / `target=ESNext` / `module=NodeNext` / `moduleResolution=NodeNext` / `verbatimModuleSyntax=true` | product source / public contracts                                                                                          | `ES2022` or CJS-first default without explicit compatibility requirement      |
| Foundation transactional DB            | PostgreSQL 18                                                                                                            | `PersistenceService` / private PostgreSQL controller                                                                       | SQLite/custom file DB as Core authority                                       |
| PostgreSQL driver                      | `pg`                                                                                                                     | persistence adapter                                                                                                        | custom PostgreSQL wire client                                                 |
| Typed SQL / migrations                 | Kysely                                                                                                                   | repository / migration adapters                                                                                            | ad-hoc string SQL as the normal application data-access layer                 |
| Durable workflow/wait/recovery         | `@dbos-inc/dbos-sdk` 4.27.6                                                                                              | `DurableExecutionService` adapter                                                                                          | custom workflow engine/scheduler                                              |
| Best-effort Signal                     | PostgreSQL `LISTEN/NOTIFY`                                                                                               | `SignalService`                                                                                                            | custom in-process event bus pretending to be durable                          |
| WorkQueue scheduling                   | `@dbos-inc/dbos-sdk` 4.27.6 DBOS Queue                                                                                   | static `dispatchWorkItem(WorkItemId, dispatchRevision)` adapter                                                            | custom queue / second durable scheduler                                       |
| Trusted in-process lifecycle mechanics | `cordis` active 4.x package line                                                                                         | `RuntimeSubstrate`                                                                                                         | custom DI/lifecycle as parallel production substrate                          |
| Runtime DAG algorithms                 | `@dagrejs/graphlib` 4.x                                                                                                  | runtime graph mechanics adapter                                                                                            | handwritten DFS/toposort/cycle engine as Foundation default                   |
| JSON Schema authoring                  | `typebox` package 1.x                                                                                                    | schema-definition layer                                                                                                    | hand-written parallel TS type/schema drift                                    |
| JSON Schema validation                 | Ajv 8 / draft 2020-12 profile                                                                                            | `SchemaRuntime`                                                                                                            | custom validator / Fastify defaults as Authority                              |
| RFC 8785 canonical JSON                | `canonicalize` 4.x                                                                                                       | `CanonicalJson` adapter                                                                                                    | custom recursive key-sort/stringifier                                         |
| Cryptographic hash                     | Node `node:crypto`                                                                                                       | digest/crypto adapter                                                                                                      | handwritten crypto implementation                                             |
| Generated UUIDv7 IDs                   | maintained `uuid` ESM line                                                                                               | identity primitive                                                                                                         | home-grown UUID implementation                                                |
| HTTP structured error projection       | RFC 9457 Problem Details + Heptalogos canonical `Problem` adapter                                                        | HTTP/error projection                                                                                                      | ad-hoc per-route error envelopes or another error framework                   |
| Management HTTP server                 | Fastify 5.x                                                                                                              | HTTP transport adapter                                                                                                     | custom Node HTTP router/framework                                             |
| HTTP cookie mechanics                  | `@fastify/cookie` Fastify-5-compatible line                                                                              | Management HTTP cookie adapter                                                                                             | hand-written cookie parser/serializer                                         |
| HTTP security headers                  | `@fastify/helmet` Fastify-5-compatible line                                                                              | Management HTTP security-header adapter                                                                                    | hand-written security-header middleware set                                   |
| HTTP rate limiting                     | `@fastify/rate-limit` Fastify-5-compatible line                                                                          | Management admission adapter                                                                                               | per-route ad-hoc counters as generic rate-limit infrastructure                |
| HTTP CSRF mechanics                    | `@fastify/csrf-protection` Fastify-5-compatible line                                                                     | Management CSRF adapter                                                                                                    | custom CSRF token/check framework                                             |
| HTTP SSE mechanics                     | `@fastify/sse` Fastify-5-compatible line                                                                                 | Management streaming adapter                                                                                               | custom SSE framing/heartbeat/replay plumbing                                  |
| Managed outbound HTTP                  | Node/Undici                                                                                                              | `NetworkAccess`                                                                                                            | direct arbitrary provider `fetch` bypass / second HTTP stack                  |
| Core OpenAPI → TS client               | Hey API                                                                                                                  | build-time generated `ManagementClient`                                                                                    | handwritten duplicate client DTO/request layer                                |
| Reference CLI                          | oclif                                                                                                                    | CLI projection over `ManagementClient`                                                                                     | hand-written parser/command framework                                         |
| Password hashing                       | Node `node:crypto` Argon2id (`Node >= 24.7`)                                                                             | credential adapter                                                                                                         | third-party native Argon2 binding unless role is reopened                     |
| HTTP session state                     | opaque token + PostgreSQL state                                                                                          | auth/session service                                                                                                       | client-side encrypted session as canonical auth state                         |
| AI provider/tool mechanics             | AI SDK 7 + `@ai-sdk/openai-compatible` + `@ai-sdk/open-responses` + `@ai-sdk/provider-utils`                             | `AIRuntime` adapter                                                                                                        | custom provider abstraction stack duplicating AI SDK                          |
| MCP client/protocol mechanics          | official MCP TypeScript v2 SDK                                                                                           | MCP adapter                                                                                                                | custom MCP protocol implementation                                            |
| OneBot/Milky interop                   | direct thin protocol anti-corruption adapters                                                                            | Messaging Driver boundary; reuse NetworkAccess/schema/runtime mechanics                                                    | mandatory Satori runtime or a second messaging Authority                      |
| Authorization model                    | Cedar                                                                                                                    | `PolicyService`                                                                                                            | scattered `if (role)` authorization logic                                     |
| Cedar JS/WASM binding                  | `@cedar-policy/cedar-wasm`                                                                                               | `PolicyService` adapter                                                                                                    | broader/parallel authorization runtime or raw Cedar types in domain contracts |
| npm artifact acquisition               | `pacote`                                                                                                                 | package acquisition adapter                                                                                                | `npm install`/`pnpm install` as product Extension install                     |
| Process execution                      | Execa                                                                                                                    | process adapter                                                                                                            | ad-hoc shell interpolation / raw `exec` for structured subprocesses           |
| Repository YAML parsing                | `yaml` 2.x                                                                                                               | repo-kit YAML helpers                                                                                                      | line-oriented pseudo-YAML parser                                              |
| Read-only repository discovery         | `tinyglobby` 0.2.x                                                                                                       | repo-kit discovery helpers                                                                                                 | repeated recursive walkers in scripts                                         |
| Repository Markdown AST parsing        | `mdast-util-from-markdown` 2.x                                                                                           | repo-kit Markdown adapter                                                                                                  | hand-rolled Markdown link/heading parser                                      |
| Copy/paste detection                   | `jscpd` 5.x                                                                                                              | repository static gate                                                                                                     | baseline/ignore registry hiding clones                                        |
| Media type detection                   | `file-type`                                                                                                              | media/content adapter                                                                                                      | extension-based MIME guessing as canonical type                               |
| Image mechanics                        | `sharp`                                                                                                                  | media adapter                                                                                                              | hand-written image codec/transforms                                           |
| Audio/video mechanics                  | external operator-managed FFmpeg executable                                                                              | media/process adapter                                                                                                      | custom codec pipeline                                                         |
| Update trust                           | TUF model + `tuf-js`                                                                                                     | UpdateService trust adapter                                                                                                | custom signature/update metadata protocol                                     |
| Operational logging                    | Pino                                                                                                                     | scoped observability facade                                                                                                | direct `console.*` as normal production logging                               |
| Traces/metrics                         | OpenTelemetry                                                                                                            | observability adapter                                                                                                      | custom tracing context/protocol                                               |
| AI telemetry conventions               | OpenInference conventions                                                                                                | OTel projection                                                                                                            | custom incompatible LLM span vocabulary without reason                        |
| In-process execution context           | Node `AsyncLocalStorage` + OTel Context                                                                                  | `ExecutionContext` propagation                                                                                             | custom async-hooks context framework                                          |
| Scoped path/file primitives            | Node `node:path` + `node:fs/promises`                                                                                    | `StorageWorkspaceService`                                                                                                  | Extension/domain constructing platform persistent paths itself                |
| Atomic file replacement                | `write-file-atomic` 8.x                                                                                                  | `AtomicFileStore` / config-file adapter; Bootstrap owns the current crash-durability and ownership semantics for V1 state. | ad-hoc temp+rename copies scattered across modules                            |
| Cross-platform file watching           | Chokidar 5.x                                                                                                             | bounded WorkspaceWatch adapter                                                                                             | raw `fs.watch` normalization duplicated per subsystem                         |
| Bootstrap single-instance lock         | `@bybrave/proper-lockfile2` 5.x package line; exact selection is owned by the pnpm Catalog                               | pre-PostgreSQL bootstrap ownership adapter                                                                                 | second long-lived Host ownership system / ad-hoc stale-lock protocol          |
| Bootstrap process liveness             | Node `process.kill(pid, 0)` + `pidusage` 4.x package line; exact selection is owned by the pnpm Catalog                  | abandoned-owner process identity adapter                                                                                   | PID existence alone / UNKNOWN-to-dead fallback                                |
| Secret backend                         | platform-composed OS credential/keyring providers; `@napi-rs/keyring` preferred where applicable                         | `SecretBackend` providers                                                                                                  | plaintext fallback / one user-session keyring assumed universal               |
| Foundation-owned TOML codec            | `js-toml` 2.x                                                                                                            | `ConfigurationCodec` for bootstrap/declarative TOML                                                                        | hand-written TOML parser/serializer                                           |
| Foundation-owned JSON codec            | Node JSON primitives + SchemaRuntime                                                                                     | `ConfigurationCodec` for declarative JSON                                                                                  | adding another JSON parser without role evidence                              |
| Test runner                            | Vitest                                                                                                                   | test infrastructure                                                                                                        | parallel Jest/Mocha test stack for Foundation by default                      |
| Property/state testing                 | fast-check                                                                                                               | verification                                                                                                               | bespoke random-loop testing when properties fit fast-check                    |
| Browser E2E                            | Playwright                                                                                                               | Presentation/API E2E                                                                                                       | Selenium/Puppeteer parallel stack without role review                         |
| Real dependency integration            | Testcontainers                                                                                                           | integration tests                                                                                                          | mocks as proof for real PostgreSQL/process semantics                          |
| SBOM                                   | Syft                                                                                                                     | release evidence                                                                                                           | custom package inventory script as SBOM authority                             |
| Vulnerability evidence                 | OSV-Scanner                                                                                                              | release evidence                                                                                                           | custom vulnerability database/client                                          |

当前 Foundation mandatory routing 不包含 `PRIMARY_CANDIDATE` / `UNRESOLVED`。WinSW 仅保留为 Windows L3 的首个 comparator；WASM sandbox 等明确 DEFERRED 角色不得提前进入 Catalog。所有 `ImplementationQualification=REQUIRED` 项仍必须在对应产品 claim 前完成真实实现/平台/source-less 资格。

---

### Toolchain route rules

The repository toolchain follows `../engineering/repository/toolchain.md`:

```text
TypeScript 7 = canonical compiler
TypeScript 6 compatibility package = compiler-API tooling only
ESNext / NodeNext / ESM-first = product default
@types/node major = shipping Node major
skipLibCheck=false = authoritative dependency/type compatibility gate
```

Do not choose exact versions from model memory. At first Catalog freeze and every toolchain/dependency upgrade, refresh registry dist-tags/current upstream support and pin the selected exact direct version in pnpm Catalogs. The lockfile owns the exact transitive closure.

A prerelease/RC/beta/0.x candidate is not prohibited by label. It may be selected when current evidence shows it is the best capable line and its maintenance, tests, blast radius, exact-pin and rollback properties are acceptable. Conversely, do not move to a prerelease merely because it is newer when the stable line already satisfies the role.

Numeric compatibility lines are machine-readable on the same Authority: a route
uses `versionConstraint` for a single package/runtime selection and
`packageVersionConstraints` when package identities on one route have different
lines. The dependency gate compares exact Node/Catalog selections with these
major and optional-minor constraints; it never parses a line out of this prose.

## 3. Adapter / import discipline

已采用 dependency 不等于允许全库任意 import。

```text
domain / public contract
    ↓ must not import implementation dependency
Heptalogos-owned adapter / infrastructure boundary
    ↓ may import selected dependency
selected library/framework
```

典型规则：

```text
Fastify              → HTTP adapter only
pg/Kysely            → persistence/repository adapter only
DBOS                  → DurableExecution/WorkQueue mechanics layer only
Cordis               → runtime substrate only
Graphlib             → runtime graph algorithms only
Pino/OTel             → observability adapter only
Cedar WASM            → PolicyService adapter only
Fastify plugins       → Management HTTP adapter only
pacote                → package acquisition only
write-file-atomic     → Foundation file mechanics adapter only
Chokidar              → bounded watch adapter only
```

公共 Extension SDK、领域 contracts、canonical schemas 和 Subject/System Authority contracts 不暴露这些实现对象。

---

## 4. Agent implementation algorithm

实现任何 generic mechanics 前按以下顺序：

```text
1. 查询 `project/dependencies/dependency-routing.json`。
2. 查询 `project/qualification/dependency-status.json`。
3. ADOPTED：直接走 selected route；缺 adapter 就实现 adapter。
4. 当前 baseline 不应出现 PRIMARY_CANDIDATE / UNRESOLVED；若新 role 临时进入该状态，必须在 Implementation Plan 接受前收敛或明确 DEFERRED。
5. REJECTED_FOR_ROLE：不得用于该角色。
6. DEFERRED：不得因“以后可能需要”提前引入。
7. 只有 routing 没有覆盖的新 generic role，才执行 Library-First inventory。
```

如果代码评审发现某个 `ADOPTED` mechanics 被项目内 custom implementation 取代，默认判定为架构偏离，除非同一提交同时包含经过批准的 role reopening/decision update。

---

## 5. Repository Materialization and Mechanical Enforcement

`ADOPTED` route must become visible in the repository, not only in prose. The implementation repository MUST materialize selected npm dependencies in `pnpm-workspace.yaml` Catalogs and enable:

```yaml
catalogMode: strict
```

Workspace `package.json` files consume catalog-managed dependencies through `catalog:` references instead of independently choosing versions. The Catalog MUST exact-pin selected direct toolchain/Foundation dependency versions after current registry/upstream evidence is refreshed; `pnpm-lock.yaml` pins the resolved closure. Architecture line names are not permission to guess an exact patch.

The repository MUST also establish a dependency-route gate using Nx/ESLint and a small project-governance check driven by `project/dependencies/dependency-routing.json`:

```text
package dependency declared
→ classified role exists
→ ADOPTED state is required for current Foundation mandatory routes
→ dependency appears in approved Catalog
→ import originates only from allowed infrastructure/adapter boundary
→ known competing provider for same frozen role is absent
```

The physical package paths for allowed imports belong to the Implementation Plan because package layout is not frozen in this document. The invariant is frozen here: **selected mechanics may not leak into arbitrary packages, and a new dependency may not silently create a second provider for an existing role.**

This gate is project governance logic, not a replacement package manager or generic dependency resolver. pnpm/Nx/ESLint continue to own the generic mechanics.

---

## 6. Extension / Domain 自主依赖

本路由约束 Foundation 自己拥有的 generic mechanics，不把 Extension/高级 Domain 的内部实现全部锁死。

Extension/Domain 在其 owner-native boundary 内可以选择 TOML/YAML/SQLite/LMDB/vector DB/其他库，但必须：

```text
不替代 Foundation Authority contracts
不绕过 StorageWorkspace/DataOwner/Backup/Purge/Lineage
不污染 Foundation public contracts
不把局部依赖偷偷提升成全局 substrate
```

例如未来 Memory subsystem 可以选择自己的数据库/索引库；这不改变 Core PostgreSQL、Kysely、DBOS 等 Foundation 路由。

WorldLife 在 subject owner 内使用普通成熟库 `rrule` 处理 RFC 5545 重复集，复用 `@js-temporal/polyfill` 处理 IANA/DST 和本地时刻转换；精确版本由 catalog/lock 固定。这不是新的 Foundation 运行时或日历同步平台，采用/历史/实例身份仍由 WorldLife 决定。
