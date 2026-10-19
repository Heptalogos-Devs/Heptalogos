// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Composes native durable ingress and Host owners without starting a cognitive runtime.
 * @module runtime
 */
import { createGatewayHostClient } from "@heptalogos/management-client/gateway";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/channel-plugin-common";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { createQqAccountRuntime } from "./account-runtime.js";
import { createQqChannel, type QqChannelOptions } from "./channel.js";
import {
  parseNativePluginConfig,
  readConnectionFile,
  readServiceToken,
} from "./config.js";
import { createQqMessageAdapter } from "./delivery.js";
import { createQqIngress } from "./ingress.js";
import { createNativeEnvelope, inspectNativeEnvelope } from "./parser.js";
import { QqScopePolicy } from "./policy.js";
import { OneBotPresence } from "./presence.js";
import { OneBotTransport } from "./transport.js";
import { createQqResourcePump } from "./resources.js";
import { synchronizeQqHistory, type HistoryEnvelope } from "./history-sync.js";
import { registerExpressionSender } from "./expression.js";
import { registerLifeTool } from "./life-tool.js";
import { resolveQqNativeRoute } from "./routing.js";

type StartContext = Parameters<QqChannelOptions["startAccount"]>[0];

/** Host tools are unconditional; a configured QQ account retains its strict transport boundary. */
export function registerQqChannel(api: OpenClawPluginApi): void {
  const config = parseNativePluginConfig(api.pluginConfig);
  const host = createGatewayHostClient({
    hostAnchorRoot: config.hostAnchorRoot,
    serviceToken: readServiceToken(config.serviceTokenFile),
  });
  registerLifeTool(api, host);
  registerExpressionSender(api, host);
  if (!("connectionFile" in config)) return;
  const connection = readConnectionFile(config.connectionFile);
  const report = (code: string) => api.logger.warn(`QQ channel: ${code}`);
  const receivePolicy = (scope: Awaited<ReturnType<typeof host.gatewayScope>>) =>
    new QqScopePolicy(
      new Set(
        scope.conversations
          .filter((c) => c.receive)
          .map((c) => `${c.kind}:${c.conversationId}`),
      ),
      new Set(),
    );
  const account = createQqAccountRuntime<ReturnType<typeof createQqMessageAdapter>>(
    config.hostAnchorRoot,
    connection.accountId,
  );
  const requireDelivery = () => account.adapter();
  const channel = createQqChannel({
    accountId: connection.accountId,
    maxTextBytes: config.maxTextBytes,
    message: {
      durableFinal: {
        capabilities: { text: true, media: true, replyTo: true, batch: true },
        automaticUnknownSendReconciliation: false,
      },
      deliveryCustody: {
        adopt: (context) => requireDelivery().deliveryCustody!.adopt(context),
        authorize: (context) => requireDelivery().deliveryCustody!.authorize(context),
      },
      send: {
        text: (context) => requireDelivery().send!.text!(context),
        media: (context) => requireDelivery().send!.media!(context),
      },
    },
    startAccount: account.ownLifecycle(async (context: StartContext, ownership) => {
      if (context.accountId !== connection.accountId)
        throw Error("QQ native account lifecycle is already owned or mismatched");
      const controller = new AbortController();
      const signal = AbortSignal.any([context.abortSignal, controller.signal]);
      const current = await host.gatewayScope();
      if (current.accountId !== connection.accountId)
        throw Error("QQ Host account does not match protected connection file");
      const scope = new QqScopePolicy(
        new Set(
          current.conversations
            .filter((c) => c.receive)
            .map((c) => `${c.kind}:${c.conversationId}`),
        ),
        new Set(
          current.conversations
            .filter((c) => c.effects.includes("send"))
            .map((c) => `${c.kind}:${c.conversationId}`),
        ),
      );
      for (const conversation of current.conversations.filter((c) => c.receive)) {
        const route = resolveQqNativeRoute(
          context.cfg,
          connection.accountId,
          { kind: conversation.kind, id: conversation.conversationId },
          current.nativeAgentId,
        );
        await host.registerChannelRoute({
          accountId: connection.accountId,
          conversation: { kind: conversation.kind, id: conversation.conversationId },
          nativeAgentId: route.agentId,
          sessionKey: route.sessionKey,
          mainSessionKey: route.mainSessionKey,
          matchedBy: "binding.account",
        });
      }
      await host.bindSubjectAccount({
        platform: "qq",
        accountId: connection.accountId,
        subjectId: current.subjectId,
      });
      const queue = api.runtime.state.openChannelIngressQueue<string>({
        accountId: connection.accountId,
      });
      let pump: ReturnType<typeof createQqResourcePump> | undefined;
      const opportunities = new Set<string>();
      const wake = (conversation: {
        kind: "group" | "direct";
        conversationId: string;
      }) => {
        const key = `${conversation.kind}:${conversation.conversationId}`;
        if (signal.aborted || opportunities.has(key)) return;
        opportunities.add(key);
        void host
          .takeActivityOpportunity({
            accountId: connection.accountId,
            conversation: {
              kind: conversation.kind,
              id: conversation.conversationId,
            },
          })
          .catch(() => {
            if (!signal.aborted) report("activity_opportunity_unavailable");
          })
          .finally(() => opportunities.delete(key));
      };
      const commit = async (envelope: HistoryEnvelope) => {
        const latest = await host.gatewayScope();
        if (latest.accountId !== connection.accountId)
          throw Error("QQ account binding changed");
        const latestScope = receivePolicy(latest);
        if (!inspectNativeEnvelope(envelope, connection.accountId, latestScope))
          return undefined;
        const source = await host.archiveEnvelope({
          kind: "envelope",
          value: envelope.originalResponseRef
            ? {
                format: "qq-history-event-v1",
                event: envelope.raw,
                originalResponseRef: envelope.originalResponseRef,
                originalMessageIndex: envelope.originalMessageIndex,
              }
            : envelope.raw,
        });
        const parsed = inspectNativeEnvelope(
          envelope,
          connection.accountId,
          latestScope,
          source.reference,
        );
        if (!parsed) return undefined;
        for (const fact of parsed.facts) {
          if (fact.conversation.kind === "group")
            await host.resolveGroup({
              platform: "qq",
              groupId: fact.conversation.conversationId,
            });
          const author = fact.kind === "message" ? fact.author : fact.actor;
          if (author) {
            const identity = await host.resolveAccount({
              platform: "qq",
              accountId: author.accountId,
              ...(author.uid ? { uid: author.uid } : {}),
            });
            author.entityRef = identity.entityRef;
          }
        }
        const accepted = await host.acceptFacts({ facts: parsed.facts });
        pump?.request();
        for (const fact of parsed.facts)
          if (fact.kind === "message") wake(fact.conversation);
        return accepted;
      };
      const monitor = createQqIngress({
        queue,
        accountId: connection.accountId,
        scope,
        commit: async (envelope) => {
          await commit(envelope);
        },
        signal,
        onError: report,
      });
      let presence: OneBotPresence;
      let connected = false;
      let history: Promise<void> | undefined;
      const reconcile = () => {
        if (history || signal.aborted) return;
        history = (async () => {
          const status = await presence.probe(signal);
          context.setStatus({
            ...context.getStatus(),
            connected: status.online,
            running: true,
          });
          if (!status.online) return;
          const latest = await host.gatewayScope();
          for (const conversation of latest.conversations.filter((c) => c.receive)) {
            if (signal.aborted) break;
            await synchronizeQqHistory(
              host,
              transport,
              scope,
              {
                platform: "qq",
                accountId: connection.accountId,
                kind: conversation.kind,
                conversationId: conversation.conversationId,
              },
              async (envelope) => {
                await commit(envelope);
              },
              config,
              signal,
            );
          }
          pump?.request();
          for (const conversation of latest.conversations.filter(
            (c) => c.receive && c.observe,
          ))
            wake(conversation);
        })()
          .catch(() => report("history_or_login_unavailable"))
          .finally(() => {
            history = undefined;
          });
      };
      const transport = new OneBotTransport({
        endpoint: connection.url,
        accessToken: connection.token,
        scope,
        requestTimeoutMs: config.requestTimeoutMs,
        reconnectMinMs: config.reconnectMinMs,
        reconnectMaxMs: config.reconnectMaxMs,
        signal,
        onError: report,
        onEvent: async (raw) => {
          const envelope = createNativeEnvelope(raw);
          const latest = await host.gatewayScope();
          if (latest.accountId !== connection.accountId) return;
          const receive = receivePolicy(latest);
          if (!inspectNativeEnvelope(envelope, connection.accountId, receive)) return;
          presence.observe(raw);
          await monitor.admit(envelope);
        },
        onConnection: (value) => {
          connected = value;
          presence.setConnected(value);
          if (value) reconcile();
          else context.setStatus({ ...context.getStatus(), connected: false });
        },
      });
      presence = new OneBotPresence(transport, connection.accountId, scope);
      pump = createQqResourcePump({
        host,
        transport,
        config,
        accountId: connection.accountId,
        state: api.runtime.state,
        signal,
        onError: report,
        acceptReply: async (envelope) => {
          const accepted = await commit(envelope);
          const result = accepted?.results.find((item) => item.kind === "message");
          if (!result) throw Error("Reply parent was not accepted in current scope");
          return result.factId;
        },
      });
      account.activate(
        ownership,
        createQqMessageAdapter({
          host,
          transport,
          presence,
          accountId: connection.accountId,
          maxTextBytes: config.maxTextBytes,
          mediaMaxBytes: config.mediaMaxBytes,
          onError: report,
        }),
      );
      monitor.start();
      transport.start();
      const timer = setInterval(() => {
        if (connected) reconcile();
        // Native account opportunities also advance adopted work when QQ is
        // quiet or offline. Host decides whether a due Activity may run.
        void host
          .gatewayScope()
          .then((latest) => {
            for (const conversation of latest.conversations.filter(
              (c) => c.receive && c.observe,
            ))
              wake(conversation);
          })
          .catch(() => {
            if (!signal.aborted) report("activity_opportunity_unavailable");
          });
      }, 60000);
      timer.unref();
      try {
        if (!signal.aborted)
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
      } finally {
        account.deactivate(ownership);
        controller.abort();
        clearInterval(timer);
        await transport.stop();
        await monitor.stop();
        await history;
        await pump.stop();
        context.setStatus({
          ...context.getStatus(),
          connected: false,
          running: false,
        });
      }
    }),
  });
  defineChannelPluginEntry({
    id: "heptalogos-qq",
    name: "Heptalogos QQ",
    description: "Host-governed first-party QQ channel",
    plugin: channel,
  }).register(api);
}
