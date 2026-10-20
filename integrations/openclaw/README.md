# OpenClaw 专业任务

`hept-worker` 将 Hept Task 接到 OpenClaw 原生执行器。模型与工具循环、历史、压缩、子代理、浏览器和沙箱由 OpenClaw 管理。Hept 保存 runId、sessionKey、成果与原请求目标。

先安装 Nous 仓库 [源码构建的 OpenClaw 包](../../../Nous-Wave/integrations/openclaw/README.md)。在 Hept 工作区运行 `node integrations/openclaw/build.mjs`，通过原生插件安装入口安装 `data/native/plugins/hept-worker/`。认知由独立 `nous-cognition` 插件供给。

## 受信配置

`plugins.entries.hept-worker.config`：

```json
{
  "subjects": {
    "<subject-id>": {
      "agentId": "worker",
      "tools": ["read", "web_fetch"],
      "workspaces": { "research": "/absolute/path/to/authorized-workspace" }
    }
  },
  "billing": {
    "baseURL": "http://127.0.0.1:4334",
    "tokenEnv": "HEPT_SERVICE_TOKEN",
    "installationId": "local-hept",
    "modelResources": { "<provider>/<model>": "<registered-hept-model-resource-id>" }
  }
}
```

令牌只由宿主环境或 SecretRoot 供给，服务身份须有目标主体的 `models.invoke` 权限。`nous-cognition` 对应绑定采用 `billing:"external"`，专业任务实际调用统一计入 Hept。普通调用与压缩摘要复用同一 prepare/dispatch/accept，Task 根预算汇总续行和子代理调用。Task budget 是 `{maxCalls?,maxTokens?,maxUsd?,perCallUsd?}`，由正式费用 owner 执行。

配置原生 agent 的 session scoped sandbox 与工具允许表。start 使用原生 `sandbox.prepareWorkspaceAuthority` 校验工作空间与真实隔离，拒绝主机执行、危险挂载或共享会话等超范围能力；通过 `assertCurrent` 在接纳前复核配置身份。工作空间只挂载获准资料，凭据留在宿主。

## 任务操作

Hept 使用 [client.ts](client.ts) 的 `createOpenClawClient({endpoint,token})`；endpoint 是 Gateway HTTP 地址，令牌由 Gateway 验证。

| 操作 | 原生入口 | 返回 |
| --- | --- | --- |
| start | `runtime.subagent.run`，TaskId 为原生 idempotencyKey | runId、sessionKey、实际执行器 |
| locate | 由稳定 TaskId 还原原生身份，仅查询已有执行 | 原操作当前状态 |
| inspect | `waitForRun` 与 `getSessionMessages` | 进展、自然结论、可读成果 |
| cancel | Gateway `chat.abort` | 原生取消结果 |
| transcript | Gateway `chat.history` | 原生分页、游标和当前历史 |
| purge | `runtime.subagent.deleteSession` | 已删除会话与历史、待处理的工作空间及独立备份范围 |

操作使用 POST `/plugins/hept/tasks/<operation>` 和 Gateway 认证。工具范围通过原生 `toolsAllow` 与已有权限求交，路径来自预授权 workspaceRef。Task 的 traceparent 从 HTTP 原生入口传至逐模型接入。

任务使用 `deliver:false`，结果回到原 Task，由主体选择查看或分享。启动结果未知时按同一个 TaskId locate，已有 run 继续 inspect。暂停和继续采用原生支持的操作；显式续行保留成果与 WorkContext，再创建继承根预算的新 Task。
