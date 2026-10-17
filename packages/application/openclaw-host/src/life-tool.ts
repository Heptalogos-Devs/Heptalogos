// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Native tool identity comes exclusively from the current SDK factory context.
 * @module life-tool
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/channel-plugin-common";
import { nativeLifeActionSchema } from "@heptalogos/management-client/gateway";
import type { createGatewayHostClient } from "@heptalogos/management-client/gateway";
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { compileSchema } from "@heptalogos/schema-runtime";
const object = { additionalProperties: false } as const;
const uuid = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});
const bindingSchema = Type.Object(
  { nativeRunId: Type.String({ minLength: 1, maxLength: 2048 }), activityRef: uuid },
  object,
);
const actions =
  Type.Unsafe<
    Parameters<ReturnType<typeof createGatewayHostClient>["nativeLife"]>[0]["request"]
  >(nativeLifeActionSchema);
// Providers require an object at the tool root; the exact action variant is checked before Host access.
const variants = nativeLifeActionSchema.anyOf;
const properties = Object.assign({}, ...variants.map((variant) => variant.properties));
const parameters = Type.Unsafe({
  type: "object",
  properties: {
    ...properties,
    action: {
      type: "string",
      enum: variants.flatMap((variant) => variant.properties.action.enum),
    },
  },
  required: ["action"],
  additionalProperties: false,
});
/** Registers one tool; absent context never falls back to the most recent run or Session. */
export function registerLifeTool(
  api: OpenClawPluginApi,
  host: Pick<ReturnType<typeof createGatewayHostClient>, "nativeLife">,
): void {
  api.registerTool(
    (ctx) => {
      const binding = compileSchema<{ nativeRunId: string; activityRef: string }>(
        bindingSchema,
      ).validate(ctx.toolBindings?.heptalogos);
      if (!binding.ok || !ctx.agentId || !ctx.sessionKey || !ctx.sessionId) return null;
      const native = {
        nativeRunId: binding.value.nativeRunId,
        activityRef: binding.value.activityRef,
        nativeAgentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
        sessionId: ctx.sessionId,
      };
      return {
        name: "heptalogos_life",
        label: "Activity life",
        description:
          "Inspect your adopted Activity; read actual Subject-visible life with lifeAt, your prior claims to this actual audience with claimsTo, explain one platform message with explainStatement, or inspect the latest admitted epistemic view. Reads retain existing source references and do not create new witnesses. progress records only your own progress statement and next world opportunity. Never invent a Subject, audience, past event or learned expertise.",
        parameters,
        async execute(toolCallId, args) {
          const parsed = compileSchema<Static<typeof actions>>(actions).validate(args);
          if (!parsed.ok || !toolCallId) throw Error("native_life_arguments_invalid");
          const result = await host.nativeLife({
            ...native,
            toolCallId,
            request: parsed.value,
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            details: result,
          };
        },
      };
    },
    { name: "heptalogos_life" },
  );
}
