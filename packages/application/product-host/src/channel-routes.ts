// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Actual native routing facts, checked against current operator grants.
 * @module channel-routes
 */
import type { PersistenceService } from "@heptalogos/persistence";
import {
  executeRepositorySql,
  readRepositorySql,
  useRepositoryMutationTransaction,
} from "@heptalogos/persistence/repository";
import { compileSchema } from "@heptalogos/schema-runtime";
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { managementProblem } from "@heptalogos/management";
import type { GatewayScope } from "./gateway-contracts.js";
const key = Type.String({ minLength: 1, maxLength: 2048 });
/** Provider facts returned by the actual public OpenClaw account binding resolver. */
export const channelRouteSchema = Type.Object(
  {
    accountId: key,
    conversation: Type.Object(
      { kind: Type.Union([Type.Literal("direct"), Type.Literal("group")]), id: key },
      { additionalProperties: false },
    ),
    nativeAgentId: key,
    sessionKey: key,
    mainSessionKey: key,
    matchedBy: Type.Literal("binding.account"),
  },
  { additionalProperties: false },
);
/** This mapping records provider routing; it is not a grant or a model proposal. */
export type ChannelRoute = Static<typeof channelRouteSchema>;
/** Creates a current-generation route cache without deriving or manufacturing native session keys. */
export function createChannelRouteStore(options: {
  persistence: PersistenceService;
  scope: () => Promise<GatewayScope>;
  now: () => string;
}) {
  const codec = compileSchema<ChannelRoute>(channelRouteSchema);
  const allowed = async (route: ChannelRoute) => {
    const scope = await options.scope();
    if (
      route.accountId !== scope.accountId ||
      route.nativeAgentId !== scope.nativeAgentId ||
      !scope.conversations.some(
        (c) =>
          c.kind === route.conversation.kind &&
          c.conversationId === route.conversation.id &&
          c.receive,
      )
    )
      throw managementProblem(
        "gateway.scope_denied",
        "Native route is outside current scope",
        "Resolve the actual explicitly bound account route for this installation",
        "authorization",
      );
    return scope;
  };
  return {
    async register(input: ChannelRoute) {
      const checked = codec.validate(input);
      if (!checked.ok)
        throw managementProblem(
          "gateway.invalid_input",
          "Invalid native route",
          "Use the public account binding resolver facts",
          "validation",
        );
      const route = checked.value;
      const scope = await allowed(route);
      await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, (tx) =>
          executeRepositorySql(
            tx,
            "INSERT INTO heptalogos.life_native_route(account_id,conversation_kind,conversation_id,subject_id,configuration_revision,document,recorded_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(account_id,conversation_kind,conversation_id) DO UPDATE SET subject_id=excluded.subject_id,configuration_revision=excluded.configuration_revision,document=excluded.document,recorded_at=excluded.recorded_at",
            [
              route.accountId,
              route.conversation.kind,
              route.conversation.id,
              scope.subjectId,
              scope.revision,
              JSON.stringify(route),
              options.now(),
            ],
          ),
        ),
      );
      return { registered: true as const };
    },
    async read(conversation: ChannelRoute["conversation"]) {
      const scope = await options.scope();
      const rows = await readRepositorySql<{ document: ChannelRoute }>(
        options.persistence,
        "SELECT document FROM heptalogos.life_native_route WHERE account_id=$1 AND conversation_kind=$2 AND conversation_id=$3 AND subject_id=$4",
        [scope.accountId, conversation.kind, conversation.id, scope.subjectId],
      );
      const route = rows[0]?.document;
      if (!route)
        throw managementProblem(
          "gateway.route_unavailable",
          "Actual native route is unavailable",
          "Start the configured Channel and register its real public route",
          "unavailable",
        );
      await allowed(route);
      return route;
    },
  };
}
