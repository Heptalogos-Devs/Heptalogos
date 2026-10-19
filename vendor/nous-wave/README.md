# 官方 Nous 输入

本目录接收由 Nous 正式 Client pack 和原生 installer pack 产出的原样归档，随 Heptalogos checkout 保留。`manifest.json` 记录准确来源提交、包身份与 SHA256；pnpm lock 继续保存 npm 包完整性。升级时同时替换归档、来源记录和正常生成的 lock，不覆盖同一文件名。

Client 是 Product Host 的官方依赖。原生 installer 仅作为开发/CI 工具运行，在本 checkout 的 `.cache/native-sdk/<artifact-hash>/<platform-arch>` 准备独立受控 OpenClaw；它不创建 Subject、配置模型或连接 QQ。生产安装继续使用相同官方 installer 与外部原生运行时，不把认知实现或 OpenClaw 打入 Host。

Host prepare 的字段与完整响应分支由官方 Client 的 `hostPrepareResponseFields` 和 `hostPrepareResponseSchema` 提供。后台 review 以 `continuationSourceRef` 绑定已保留的原任务，WorkContext 分支继续使用实际上下文身份。

pnpm 关闭自动 peer 安装。OpenClaw peer 由正式 installer 准备的宿主提供，插件声明保留运行时 peer，开发源码通过已校验 SDK 链接编译。Knip 将这个宿主提供的 peer 单独登记，并明确列出实际动态调用的原生 CLI 入口。

归档内包含各自 LICENSE、NOTICE 与第三方声明；未将它们改成 Heptalogos 源码。来源：[Nous Wave](https://github.com/Heptalogos-Devs/Nous-Wave)。开发入口和依赖规则见 [Dependencies](../../project/dependencies/README.md)。
