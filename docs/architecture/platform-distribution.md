# 跨平台产品运行与分发

## 安装身份与数据

安装 locator 保存 InstallationId、InstanceId 和独立 lifecycle roots。PROGRAM、DATA、CONFIGURATION、SECRET、BLOB、BACKUP、LOG、CACHE、TEMP、RUN 分别承担代码、事实和运行材料；不能根据调用 cwd 或源仓布局猜测位置。显式 roots 和已有身份在重复初始化时保留。

程序代次的替换不等于实例、配置、数据或秘密的删除。初始化由安装器、Host init 与 portable launcher 共用同一入口，使用成熟文件锁和原子发布，禁止部分写入覆盖旧 locator。

## 当前安装闭包

Nx prune/copy-workspace-modules 生成 Host/CLI 生产产物。装配在产物内完成生产依赖物化，将正式 Nous Client tarball 按内容哈希收进产物；运行不引用 Nous 源文件。发布闭包包含私有 Node、完整 PostgreSQL 工具链、应用、原生依赖和许可材料；运行时无需开发环境、Git 或在线 npm 安装。

Product Host 仅启动独立管理所需组合，已移除旧内置 OpenClaw、Subject Chat 和旧 AIRuntime 主体路径。保留的独立库不自动进入管理生产闭包。

构建与安装的当前版本、参数和命令见 [Product Host](../../packages/application/product-host/README.md)。Node/pnpm 的精确版本由根 package.json 声明，npm 包由 catalog/lockfile 声明；文档不另设版本来源。

## Linux 服务

Linux 安装器接受新目标目录，携带私有 Node/PostgreSQL，注册按安装身份派生的 systemd 用户服务。CLI 从任意 cwd 定位该安装，提供启动、停止、重启和服务状态。正常停止关闭接纳并有限等待，释放管理 HTTP 和自有 PostgreSQL；重启复用身份、数据和配置。

Subject Gateway 和 maintenance Gateway 使用分开的 profile、端口、状态与秘密。当前安装槽未配置时返回 unconfigured，不将其推定为已运行。完整 QQ 产品的停止、历史补拉及跨日恢复随当前计划另行验证，管理服务的停止检查不能替代它们。

## Windows 与其他平台

Windows portable 继续保留本机 launcher、私有 runtime、前台 Host、CLI 和相同初始化合同。装配及资格检查使用当前 Management 合同。Linux 实机结果不证明 Windows 实机安装，历史 Windows 候选结果也不覆盖本次改动；未经当前实际执行的部分标为 NOT_RUN。

macOS、Windows 服务安装与其他分发方式需要各自真实验证，不由目录存在或通用代码推定支持。Domain 语义不因桌面、服务器或 OS 名称创建另一套产品模型。

## 产物验证

依赖审计同时检查开发树与实际安装的生产闭包。workspace override 必须进入装配后的 lock/manifest 并重新物化，不能仅用根审计宣称安装安全。

实际 source-less 验证在仓库外使用安装的 CLI/Host，检查认领、登录、配置冲突、依赖离线时管理可用、停止释放端口、重启保持身份与配置。QQ、媒体、工具、模型和持续主体均需独立真实使用验证。原生共享库、WASM、子进程工具和 OS keyring 属于安装合同的一部分，不能以 npm install 成功替代。

FFmpeg/ffprobe 由实际媒体部署显式配置。当前管理产物不因预留媒体或 Gateway 位置而宣称相应能力已上线。
