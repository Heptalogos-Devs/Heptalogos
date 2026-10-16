// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Service-only native scheduler entry; ordinary chat has no management authority. @module world-opportunity-http */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { readWorldSchema } from "@heptalogos/subject";
import { managementProblem, managementProblemSchema } from "@heptalogos/management";
import type { FastifyInstance } from "fastify";
/** Scheduler caller supplies identities only; role, prompts, world contents and permissions come from owners. */
export const worldOpportunityInputSchema = Type.Object(
  {
    ...readWorldSchema.properties,
    activityId: readWorldSchema.properties.subjectId,
    requestId: readWorldSchema.properties.subjectId,
  },
  { additionalProperties: false },
);
/** Existing service authentication and execution lineage surround the owned operation. */
export function registerWorldOpportunityHttp(
  app: FastifyInstance,
  options: {
    authenticate: (token: string | undefined) => Promise<void>;
    currentSubject: () => Promise<string>;
    runMutation: <T>(kind: string, operation: () => Promise<T>) => Promise<T>;
    advance: (input: Static<typeof worldOpportunityInputSchema>) => Promise<unknown>;
  },
) {
  app.post(
    "/gateway/v1/world/advance",
    {
      onRequest: async (request) => {
        const header = request.headers.authorization;
        await options.authenticate(
          header?.startsWith("Bearer ") ? header.slice(7) : undefined,
        );
      },
      schema: {
        operationId: "advanceWorldOpportunity",
        body: worldOpportunityInputSchema,
        security: [{ gatewayService: [] }],
        response: {
          200: Type.Object({
            status: Type.String(),
            plannerRunId: Type.Optional(Type.String()),
            deliberationRunId: Type.Optional(Type.String()),
            nextOpportunity: Type.Optional(
              Type.Union([
                Type.Object({ timeDomainRef: Type.String(), at: Type.String() }),
                Type.Null(),
              ]),
            ),
          }),
          400: managementProblemSchema,
          401: managementProblemSchema,
          403: managementProblemSchema,
          409: managementProblemSchema,
          503: managementProblemSchema,
          500: managementProblemSchema,
        },
      },
    },
    async (request) =>
      options.runMutation("gateway.world.opportunity", async () => {
        const input = request.body as Static<typeof worldOpportunityInputSchema>;
        if (input.subjectId !== (await options.currentSubject()))
          throw managementProblem(
            "world.scope_denied",
            "World opportunity belongs to another Subject",
            "Use the current installation Subject",
            "authorization",
          );
        return options.advance(input);
      }),
  );
}
