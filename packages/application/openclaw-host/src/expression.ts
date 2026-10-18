// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** The public native durable sender consumes only the Host's already adopted original.
 * @module expression
 */
import type { GatewayHostClient } from "@heptalogos/management-client/gateway";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/channel-plugin-common";
import { sendDurableMessageBatch } from "openclaw/plugin-sdk/channel-message";
/** Selection carries no caller-provided text, audience or sending authority. */
export function registerExpressionSender(
  api: OpenClawPluginApi,
  host: GatewayHostClient,
) {
  api.registerGatewayMethod(
    "heptalogos.expression.send",
    async ({ params, respond }) => {
      if (
        Object.keys(params).some((key) => !["subjectId", "briefId"].includes(key)) ||
        typeof params.subjectId !== "string" ||
        typeof params.briefId !== "string"
      ) {
        respond(false, undefined, {
          code: "INVALID_REQUEST",
          message: "Select an already adopted expression",
        });
        return;
      }
      try {
        const adopted = await host.readExpressionCandidateDelivery({
          subjectId: params.subjectId,
          briefId: params.briefId,
        });
        const prepared = adopted.prepared;
        const batch = prepared.preparedBatch as unknown as NonNullable<
          Parameters<typeof sendDurableMessageBatch>[0]["preparedBatch"]
        >;
        const result = await sendDurableMessageBatch({
          cfg: api.config,
          channel: prepared.channel,
          accountId: prepared.accountId,
          to: prepared.to,
          deliveryIntentId: prepared.nativeIntentId,
          reusePendingDeliveryIntent: true,
          completionRetention: "permanent",
          preparedBatch: {
            ...batch,
            deliveryCustody: { reference: adopted.reference },
          },
          payloads: batch.entries.flatMap((entry) =>
            entry.status === "accepted" ? [entry.payload] : [],
          ),
          ...(prepared.replyToId
            ? {
                reply: prepared.replyToMode
                  ? {
                      replyToId: prepared.replyToId,
                      source: "implicit" as const,
                      mode: prepared.replyToMode,
                    }
                  : { replyToId: prepared.replyToId, source: "explicit" as const },
              }
            : {}),
          ...(prepared.threadId ? { threadId: prepared.threadId } : {}),
        });
        respond(true, { status: result.status, reference: adopted.reference });
      } catch {
        respond(false, undefined, {
          code: "UNAVAILABLE",
          message: "The retained expression remains with its original delivery owner",
        });
      }
    },
    { scope: "operator.admin", profileAccess: "independent" },
  );
}
