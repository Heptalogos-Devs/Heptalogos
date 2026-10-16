# Dependencies

This area owns the current dependency decision and implementation-routing
documentation. The machine-readable routing file is the canonical source for
adopted implementation paths; prose explains rationale and boundaries.

- [Decision ledger](decision-ledger.md)
- [Implementation routing](implementation-routing.md)
- [Dependency routing](dependency-routing.json)
- [Qualification evidence](../qualification/README.md)

`RoleDecision` and `ImplementationQualification` are separate dimensions.
An adopted generic mechanics provider still requires claim-matched
implementation or product qualification where the current architecture says so.
Do not add a second provider or custom fallback without an explicit reopening
decision.

Ordinary mature libraries and tools do not need an Architecture citizenship
process, qualification ID, or RoleDecision merely because they are external.
They use normal pnpm catalog and lockfile mechanics. Dependency count is not a
quality metric; avoiding a suitable mature dependency can transfer maintenance
burden into Heptalogos.

The Version Authority graph is split by ownership: `package.json` owns the exact
Node and pnpm baseline, `pnpm-workspace.yaml` owns exact npm catalog selections,
`dependency-routing.json` owns independent dependency policy values including
machine-readable major/optional-minor compatibility lines, and each domain owns
non-npm runtime selections. Verification reads these Authorities; qualification
records only describe what was exercised.

本地正式 SDK 发布包使用依赖清单中的相对 `file:...tgz` 与 pnpm lock integrity；npm registry 依赖继续由 catalog 统一选择。pnpm 11 不支持在 catalog 中声明 file 协议。更新本地包时使用内容固定的归档文件名，再运行正常安装、生成与独立产物验证，避免同版本路径缓存旧包。

开发时可用相对 `link:` 消费独立安装的 SDK，前提是它在同包声明 catalog peer，且实际包名与版本匹配 catalog。该链接不进入生产发布包；QQ 包的构建需另外核验 Nous 正式安装补丁，打包时将 peer 与运行依赖物化为实际确切版本。
