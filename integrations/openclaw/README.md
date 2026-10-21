# OpenClaw 专业任务

`hept-worker` 将 Hept Task 接到 OpenClaw 原生执行器。模型与工具循环、历史、压缩、子代理、浏览器和沙箱由 OpenClaw 管理。Hept 保存真实 runId、sessionKey、sessionId、Task Worker 委派与成果引用。

先安装 Nous 仓库 [源码构建的 OpenClaw](https://github.com/Heptalogos-Devs/Nous-Wave/tree/feat/spec-rebuild/integrations/openclaw)。在 Hept 工作区运行 `node integrations/openclaw/build.mjs`，默认输出为 `../temp/spec-research/native-release/plugins/hept-worker/`；用 `--output DIRECTORY` 指定目录，再通过原生插件安装入口安装。认知由 `nous-cognition` 提供，联合绑定采用 `{ "billing": "external" }`。

## 受信配置

`plugins.entries.hept-worker.config`：

```json
{
  "runtimeId": "openclaw-local",
  "subjects": {
    "<subject-id>": {
      "agentId": "worker",
      "tools": ["read", "web_fetch"],
      "workspaces": { "<workspace-ref-id>": "/absolute/path/to/authorized-workspace" }
    }
  },
  "billing": {
    "baseURL": "http://127.0.0.1:8788",
    "tokenEnv": "HEPT_SERVICE_TOKEN",
    "modelResources": { "<provider>/<model>": "<registered-hept-model-resource-id>" },
    "roles": { "assistant": "worker", "compaction": "worker" }
  }
}
```

Host 令牌只从宿主环境或 SecretRoot 供给。Host 具有对应范围的 `native.record`、`native.connect` 和模型调用检查权限。它凭真实会话来源进入 Task owner，再使用 Task 保存的有限 Worker；Task Worker 不取得安装管理权。普通调用和辅助摘要均在实际调用边界执行同一个模型预算 owner。Task 使用公共 `ModelBudget`，金额是 `{amount:decimalString,currency:ISO4217}`；原生提示词不充当硬限额。

配置 session scoped sandbox 与工具允许表。describe 使用真实 sandbox authority、发布模型配置与工作空间映射返回 `NativeExecutionScope`，不启动任务。Work 保存该 scope、创建有限 Worker 后，start 要求完整 expectedScope 与当前 scope 一致，再执行原生工作区准备与 admission。工作空间只挂载获准资料，凭据留在宿主。

## 正式操作

Hept 在 Network 与 Secret callback 内使用 [client.ts](client.ts) 的 `createOpenClawClient({endpoint,token,fetch})`。endpoint 是 Gateway HTTP 地址；纯 native schemas 由 `@heptalogos/contracts` 唯一定义。

| 操作 | 原生责任入口 | 返回 |
| --- | --- | --- |
| describe | 发布模型配置、sandbox authority | 真实执行 scope |
| start | `runtime.subagent.run`，TaskId 为原生 idempotencyKey | runId、sessionKey、已知的真实 sessionId |
| locate | 同 TaskId 查询已有执行 | 已确认状态或 waiting |
| inspect | `waitForRun` 与原生终端历史 | 进展、已保存 outputRef/选定节点 refs |
| planRecovery/recover | 原生 SessionManager、command 与 tool loop | 同一 run 的未启动同步工具恢复计划与结果 |
| cancel | Gateway `chat.abort` | 原生取消结果 |
| transcript | Gateway `chat.history` | 原生历史与分页 |
| purge | `runtime.subagent.deleteSession` | 原生删除结果及工作空间、独立备份的待处理范围 |
| readBinding/readCall/readSession | 发布模型目录、SessionManager、真实 run registry | 模型修订与精确调用/Task 来源证明 |

Task 操作使用 POST `/plugins/hept/tasks/<operation>`；事实读取使用 POST `/plugins/hept/models/<operation>`，均由 Gateway 认证。sessionKey 与实际 session UUID 分开保存。已有 run 只查询、恢复或取消；未确认创建的超时保持 waiting。

插件通过正式 Hept SDK 调用 `S/native-cognition/{materials,context-views,encounters,blobs}`；每次带实际 session/run proof，由 Work 找到 Task 保存的 Worker 和 Nous 子委派。内部 Gateway relay 不保存子密钥。`before_tool_call` 在真实工具执行前调用 `S/native-authority/check`，当前 Task/父授权/工具范围失效或请求失败时返回原生显式 block，沙箱继续拥有路径隔离。

任务使用 `deliver:false`。成果采用原生保存的选定节点引用，经正式发布边界供主体查看。取消或撤销后的终态调用仍保存真实 usage/time/cost；认知授权失效则保留待接纳状态，原生 provider 不重复发送。

`planRecovery({native,expectedScope})` 用原 Task 的执行范围读取恢复计划。仅原生已保存成功 toolUse、随后明确发生接纳失败且同步工具尚未启动时可恢复。`recover({expected:plan})` 重验当前 Task 授权、完整执行范围和终端 entry，再沿原 run/session/call 接纳回执、执行工具及下一轮模型。异步工具、已有工具结果或效果未知需先核实原生事实。已采用的计划重交不会执行新的效果。

恢复失败以正式 Problem 返回：`native.recovery_proof_unavailable` 表示缺少原生未执行证明，`native.recovery_effect_unknown` 表示分支发布后执行效果待核实，`native.recovery_plan_changed` 表示计划已失效。进展只保存 run/session 标识、原生状态、活动标志、起止时间与固定原因码；选定成果独立经过发布 owner。
