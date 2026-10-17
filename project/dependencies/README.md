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

正式 Nous Client 与原生 installer 的原始 sealed 包保存在 [vendor/nous-wave](../../vendor/nous-wave/README.md)，字节哈希和来源提交由同目录 manifest 记录。开发不依赖同级私有 checkout 或 `link:` 声明。`pnpm prepare:native-sdk` 使用同一官方 installer 在本 checkout 的 `.cache/native-sdk` 准备隔离运行时，再校验补丁文件并建立开发链接；生产包仍使用确切 external peer，不嵌入 OpenClaw。首次相关构建/验证的 Nx 依赖与现有手动 CI 使用同一准备入口。
