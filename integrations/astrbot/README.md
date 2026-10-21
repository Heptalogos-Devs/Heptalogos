# AstrBot 渠道插件

该插件将明确配置的 OneBot 账号与会话交给 Hept。AstrBot 保留平台连接、消息组件、媒体处理和插件生命周期，QQ 由 NapCat 连接。管理范围内的入站事件立即停止默认聊天流程，完整原始消息按 parts 保存到 Hept。

## 安装

[upstream/source.json](upstream/source.json) 固定 AstrBot 版本。[physical-receipts.patch](upstream/physical-receipts.patch) 在原生 `_dispatch_send`、普通发送、文件与转发发送中保留每个物理调用结果。先构建正常 wheel，再安装到 AstrBot 环境：

```sh
python integrations/astrbot/build_upstream.py
uv pip install data/native/astrbot/astrbot-4.29.1-py3-none-any.whl
```

运行 `python integrations/astrbot/build_plugin.py` 生成 `data/native/plugins/hept-astrbot.zip`，通过 AstrBot 插件安装入口安装。配置 `_conf_schema.json` 对应的字段：

```json
{
  "heptURL": "http://127.0.0.1:8788",
  "heptTokenEnv": "HEPT_SERVICE_TOKEN",
  "controlTokenEnv": "HEPT_ASTRBOT_TOKEN",
  "host": "127.0.0.1",
  "port": 8790,
  "maxMediaBytes": 52428800,
  "scopes": [{ "subjectId": "<subject-id>", "platformId": "qq", "selfId": "<bot-qq>", "conversations": ["group:<group-id>"] }]
}
```

服务令牌与控制令牌从运行环境供给。Hept 侧先调用 `POST /v1/subjects/{id}/channels` 离线配置渠道：`host:astrbot`、`adapterId:astrbot:<platformId>`、`accountId:<platformId>:<selfId>`、会话列表与 `expectedRevision:0`。用返回的真实 Channel 身份登记控制 SecretRef，再以当前 `id/expectedRevision` 更新凭据，最后调用 `POST /channels/{channelId}/connect` 核验原生账号。配置变更需要重新连接。

入站服务凭据通过现有委派接口签发，使用有限到期时间、`principalKind:service`、`operations:[messages.receive]`、`purposes:[ingress]`、唯一 Subject audience 和精确 conversation targets。每次使用都检查渠道当前接收开关与会话范围。媒体上传同时携带账号、会话来源；插件统一发送 `x-purpose:ingress`。Hept 暂停主体时继续收件，服务停止后沿平台公开历史补读。

## 正式边界

入站 `channelAccount` 为 `<platformId>:<selfId>`，`conversationKey` 为 `group:<id>` 或 `private:<id>`。发送者、平台消息身份、真实平台时间、嵌套转发、引用、未识别分段与原事件一起保留。临时媒体在入站处理结束前流式提交至 Hept `/media`，用账号、会话、来源事件与 part 路径构成稳定幂等键；保存正式返回对象的 ref，失败保留缺失状态和原来源。编辑、撤回和回应通过正式 `message-changes` 来源寻址操作进入新版本，旧接触继续引用原修订。

插件控制端使用 `Bearer HEPT_ASTRBOT_TOKEN`：

| 路径 | 用途 |
| --- | --- |
| POST `/v1/sendExpression` | 发送已采用的完整 parts，返回每个物理调用的 DeliveryPart |
| GET `/v1/accounts` | 读取所管理账号的原生身份 |
| GET `/v1/capabilities` | 查询消息与回执能力 |
| POST `/v1/history` | 通过 OneBot 公开历史接口补读可取得的范围 |

出站媒体由 Hept 解析 materialRef，提供受授权的 URL。插件只进行一次 Hept parts 到原生组件的转换，使用 AstrBot 原有 CQHttp 客户端发送。每次物理调用返回 accepted、not_sent 或 unknown，并保留组件与表达部分的对应关系；返回值不会触发自动重发。

`accepted` 表示平台确认接纳这次物理操作。文件上传等操作可以没有平台消息 ID；回执保留实际操作事实，不创建虚构消息。后续送达、阅读、回应或撤回由各自平台事实继续进入交往记录。补读结果带可取得范围，平台没有返回的历史仍显示缺口。

连续场景 `test_channel.py` 使用实际 AstrBot CQHTTP 组件与发送 owner，验证媒体保存、稳定重投、撤回来源、四次物理发送及成功/失败/未知结果；平台客户端与 Hept HTTP 在场景内受控。实际 QQ 账号联调需要已启用的 NapCat 连接。
