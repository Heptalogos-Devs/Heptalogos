# 管理权限

当前管理入口面向安装管理员，提供首次认领、登录、会话撤销、配置和 Subject 管理。精确 schema、路由、错误和 CAS 规则由 [Management Spec](../../specs/management/system-authority.md)维护。

## 管理员与会话

首次认领使用本机受保护的一次性材料。密码通过已有 Argon2id 验证，opaque session 在服务端只保存摘要，CLI 将会话秘密保存到 OS keyring。过期、撤销、auth epoch 和 Host 所有权检查保留在管理所有者中。

HTTP 不因调用者来自 loopback 就跳过认证。本机 Client 核对安装 locator、服务 endpoint 与公开 discovery 的身份，防止把凭证提交给另一安装。

## 配置与 Subject

产品配置通过 Configuration 所有者产生 revision 并以期望修订激活。管理先验证输入，再在短事务中保存事实；网络查询和模型调用不进入写事务。更换正在启用的 Subject 或其 Nous 来源前，必须先暂停当前绑定。

Host 通过官方 Nous Client 查询或创建独立 Subject，支持无 Seed 和显式 Seed。创建不自动绑定，也不替换已有 Subject。认知服务离线时管理仍可使用，但依赖该服务的操作明确失败。

subject.enabled 表示产品意图，不能作为模型、QQ、工具或认知已可用的证明。当前依赖探测展示其实际检查范围。

## 主体与机器维护

普通主体对话不使用管理员 session，“记住/忘记”等话语不获得认知管理权限。产品对真实工具和发言的授权将在原生实际执行入口检查，不能以提示词代替。

本机服务启动、停止、重启由安装对应的 OS 服务入口控制；Host 不接受任意服务名或通用机器命令。maintenance Gateway 独立于 Subject Gateway。操作方法见 [CLI](../../packages/application/cli/README.md)，长期权限边界见 [Architecture-Vault 合同](https://github.com/Heptalogos-Devs/Architecture-Vault/blob/main/docs/integration/cognition-agency.md)。

旧 SystemAction plan/execute、通用运行图管理和旧 AIRuntime 管理路径已退出当前公开合同，不提供兼容别名。
