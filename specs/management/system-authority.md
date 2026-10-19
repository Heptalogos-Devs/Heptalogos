# 产品管理合同

本 Spec 拥有当前无模型管理合同。长期权限分工见 Architecture-Vault 的[共享合同](https://github.com/Heptalogos-Devs/Architecture-Vault/blob/main/docs/integration/cognition-agency.md)。HTTP schema 属于 management，Host 将其生成为唯一 OpenAPI，ManagementClient 和 CLI 只投影同一合同。

## 身份与权限

一个安装保存稳定 InstallationId/InstanceId，每次启动使用新的 BootId。locator、当前 endpoint 和 HTTP discovery 的身份必须一致；本机客户端在发现错误安装时不得选取其 keyring 会话。代码或依赖故障不改写逻辑 Subject 身份。

当前安装具有一个管理员。首次使用短期、单次、仅本机发布的高熵 claim，事务性创建管理员 verifier 并消耗 claim。密码保持 NFKC-v1、15—256 code points、Argon2id 的既有策略。数据库不保存密码、claim secret 或 session token 明文。正常 session 使用高熵 opaque bearer，按摘要、auth epoch、到期及撤销状态验证；本机 CLI 将明文保存在 OS keyring。

产品管理、普通 Subject 聊天、可信服务调用和独立机器维护不共享隐式权限。模型内容、QQ群管理员或自称操作者的消息不能直接调用管理 mutation。认证失败不得泄露底层异常、凭据或私聊内容。

## 当前公开操作

公共 `/.well-known/heptalogos-management` 返回安装、boot、`/v1` base path 和 `management.v1`。其余管理操作使用 bearer；`/readyz` 只表示管理 HTTP 可用，不证明依赖、QQ 或模型已上线。

| API                                                                 | 行为                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `POST /v1/bootstrap/claim`                                          | 消费一次 claim，创建管理员                                      |
| `POST /v1/session`、`DELETE /v1/session/current`                    | 创建、撤销当前 opaque session                                   |
| `GET /v1/overview`、`GET /v1/subject/documents`、`GET /v1/calendar` | 当前总览、确定性主体文档与默认世界日历，零模型、无业务写入      |
| `GET /v1/status`                                                    | 当前安装、Subject 意图、配置 revision、分别核对的依赖与实际能力 |
| `GET /v1/config/describe`、`GET /v1/config`                         | code-owned schema 与当前有效配置                                |
| `POST /v1/config/check`、`PUT /v1/config`                           | 无副作用校验、带 expectedRevision 的完整配置替换与 activation   |
| `GET /v1/subject`、`PUT /v1/subject`                                | 保留离线可读绑定；在实际 Nous owner 核验后显式绑定              |
| `POST /v1/subjects`                                                 | 按稳定 operationId 调 Nous 正式创建，可无 Seed；不替换已有绑定  |

`GET /v1/tasks/:activityId`按当前绑定主体读取原任务与角色登记，默认不取输入；显式 `inputs=true` 才读取一项原运行的最终provider body和单列宿主prompt，`runId`选择原运行，`before`读取更早登记。没有原生capture的旧调用保留未知。`GET /v1/calendar/template`读取可选学校时间骨架，不写身份或日程。总览分别读取H自动工作、OS自启及Nous实际生效维护策略。

`POST /v1/subject/documents/import`是显式管理员认知修订：读取文档中的`nous-revision`块，采用正式Client内容codec，并以原revision/epoch及稳定operationId调用Self/Social.revise。正文由同一Nous域renderer提供，文件编辑不自动写入；未改内容跳过，每条修订独立返回结果。原版本与采用范围保留，手工修改不沿用旧模型producer。新认知对象的采用仍走Nous既有adopt；LIFE历史只读，未来日历修改走WorldLife。

请求不做字符串/布尔/null 强制转换，不静默丢弃未知字段。配置由 Configuration 保存 revision 和 activation；激活必须再次核对 expected revision。参数无效不自动重试，陈旧写入返回冲突。当前激活为 LIVE 的产品字段由实际消费者每次取得有效 snapshot；不能只保存而无人消费。

Host 通过已安装官方 Client 和受保护 discovery 连接 Nous，按配置核验预期 instance identity。No Seed 不产生默认人格；Seed 原文的采用与模型形成分别处理。Subject 创建和认知管理仍属于 Nous owner；Heptalogos 不跨库读取或双写。

## 可用性、错误与取消

管理不等待模型初始化、Nous、QQ 或 Gateway 就绪。状态分别核对依赖，保留 unconfigured/unavailable 与下一步；HTTP 200 和保存的 enabled 意图不升级为实际模型、发送或活动成功。

错误使用稳定 Problem：code、简短解释、HTTP 类别及 recovery 信息。输入为 400，认证为 401、权限为 403，不存在为 404，冲突为 409，限流为 429，内部错误为 500，暂不可用/围栏失效为 503。基础设施异常不能被伪装成普通参数错误；异常字符串不直接回显。

调用方取消从 CLI/Client 贯穿 HTTP 和真实 SDK 等待。事务一旦提交，连接取消不使其回滚；创建等 mutation 使用稳定 operationId 核对和重试。模型、网络和人工等待不进入持久写事务。

## 安装与监督

安装入口原子发布完整 locator，有互斥；既有安装身份和显式 roots 不得覆盖。Linux 使用安装器固定发布、按 InstallationId 派生的用户 systemd unit。安装器只安装，默认不启用开机启动、不调用模型；--autostart yes|no显式选择，Gateway重配和升级保留systemd当前选择。进程启动与自主付费分别由服务命令和subject.enabled/已授权预算控制，普通启动或配置保存不唤醒主体。CLI 不接受任意 unit 名。Host 自有私有 PostgreSQL只有一个监督者；维护 Gateway 生命周期独立，产品停止不关闭它。

停止关闭新 admission，有限 drain 在途管理工作、关闭持久化并释放自有数据库；故障收尾仍尝试剩余 owned cleanup，失去所有权后不得用旧 ready handle 关闭新 owner 的数据库。启动重用数据与配置，不重新认领管理员。代码、配置、数据、秘密、blob、缓存、run 与备份分别保留。

当前管理单元没有把 QQ、持续活动、Growth 或真实可用的维护 Gateway 宣称完成。它们按当前计划扩展各自 owner 与同一管理合同；不得用空表、未消费参数或 readyz 代替真实运行。

## 验证

必须验证真实 PostgreSQL 的认领、登录/撤销、CAS 和生命周期，以及仓库外安装后的 CLI/API。并发初始化、原子发布前崩溃、身份错配、取消和关闭端口属于受影响边界。Linux 验证只证明 Linux；Windows portable 与其检查继续保持独立平台边界。操作命令唯一维护在 [CLI](../../packages/application/cli/README.md) 和 [Host 安装](../../packages/application/product-host/README.md)。

## Reactor生活操作的完整消费者

活动计划要求无模型读取范围日历（planned/lived/combined与例外）、当前生活（地点/焦点/E及原因/下一节点）、attention explain（候选/选延略/未读）、role runs（实际profile/预算/结果）、生活/陈述及owner存储/清理。新增接口尚须实际生成并接入CLI后才报告可用，不能由当前通用对象分页代替。

普通CLI使用当前绑定Subject、today或from/to、显示时区；单实例/以后系列编辑与复杂WorldProfile文件采用复用正式owner，CLI不重算课表、不要求手写内部operation UUID。GUI消费相同生成Client和变化通知，断线按正式游标/范围重读。config describe/check解释每值来源、单位、生效/消费者，发现必需输入不足、无时区/互斥课表与角色输出能力不匹配，不新增模型资格数据库。
