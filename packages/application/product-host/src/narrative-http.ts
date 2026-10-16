// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only narrative management uses canonical claims and actual delivery receipts.
 * @module narrative-http
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static, type TSchema } from "@heptalogos/schema-runtime/typebox";
import {
  claimsToSchema,
  narrativeClaimSchema,
  type createNarrativeService,
} from "@heptalogos/subject";
import { managementProblem, managementProblemSchema } from "@heptalogos/management";
/** Existing service credentials identify one bound installation; these operations cannot adopt reviews or claims. */
export interface NarrativeHttpOptions {
  readonly authenticate: (token: string | undefined) => Promise<void>;
  readonly currentSubject: () => Promise<string>;
  readonly runMutation: <T>(kind: string, operation: () => Promise<T>) => Promise<T>;
  readonly narrative: Pick<
    ReturnType<typeof createNarrativeService>,
    "claimsTo" | "explainStatement"
  >;
}
const ref = Type.String({ minLength: 1, maxLength: 2048 });
const claim = Type.Object(
  {
    ...narrativeClaimSchema.properties,
    claimId: claimsToSchema.properties.subjectId,
    briefId: claimsToSchema.properties.subjectId,
    behaviorRef: ref,
    conversationRef: ref,
    recordedAt: Type.String(),
    status: Type.Union([
      Type.Literal("adopted"),
      Type.Literal("expressed"),
      Type.Literal("uncertain"),
      Type.Literal("not_sent"),
    ]),
    platformMessageIds: Type.Array(ref),
  },
  { additionalProperties: false },
);
/** Adds only owner reads; final statement adoption stays inside the real renderer/review chain. */
export function registerNarrativeHttp(
  app: FastifyInstance,
  options?: NarrativeHttpOptions,
) {
  const owners = () =>
    options ??
    (() => {
      throw managementProblem(
        "narrative.unconfigured",
        "Narrative owner is not configured",
        "Use the current Product Host composition",
        "unavailable",
      );
    })();
  const route = <T extends TSchema>(
    name: string,
    path: string,
    input: T,
    output: TSchema,
    operation: (value: Static<T>) => Promise<unknown>,
  ) =>
    app.post(
      "/gateway/v1/narrative/" + path,
      {
        onRequest: async (request) => {
          const header = request.headers.authorization;
          await owners().authenticate(
            header?.startsWith("Bearer ") ? header.slice(7) : undefined,
          );
        },
        schema: {
          operationId: name,
          body: input,
          security: [{ gatewayService: [] }],
          response: {
            200: output,
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
        owners().runMutation("gateway.narrative." + name, async () => {
          const input = request.body as Static<T>;
          if (
            (input as { subjectId: string }).subjectId !==
            (await owners().currentSubject())
          )
            throw managementProblem(
              "narrative.scope_denied",
              "Statement belongs to another Subject",
              "Use the current bound Subject",
              "authorization",
            );
          return operation(input);
        }),
    );
  route(
    "claimsTo",
    "claims",
    claimsToSchema,
    Type.Object(
      { claims: Type.Array(claim), more: Type.Boolean() },
      { additionalProperties: false },
    ),
    (input) => owners().narrative.claimsTo(input),
  );
  route(
    "explainStatement",
    "explain",
    Type.Object(
      { subjectId: claimsToSchema.properties.subjectId, platformMessageId: ref },
      { additionalProperties: false },
    ),
    Type.Object({ claims: Type.Array(claim) }, { additionalProperties: false }),
    (input) =>
      owners().narrative.explainStatement(input.subjectId, input.platformMessageId),
  );
}
