// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only narrative management uses canonical claims and actual delivery receipts.
 * @module narrative-http
 */
import {
  gatewayBearer,
  registerGatewayPost,
  type NamedGatewayRoute,
} from "./gateway-route.js";
import type { FastifyInstance } from "fastify";
import { Type } from "@heptalogos/schema-runtime/typebox";
import {
  claimsToSchema,
  recoverExpressionCandidatesSchema,
  expressionCandidateSelectionSchema,
  expressionCandidateDeliverySchema,
  narrativeClaimSchema,
  type createNarrativeService,
} from "@heptalogos/subject";
import { managementProblem } from "@heptalogos/management";
/** Existing service credentials identify one bound installation; these operations cannot adopt reviews or claims. */
export interface NarrativeHttpOptions {
  readonly authenticate: (token: string | undefined) => Promise<void>;
  readonly currentSubject: () => Promise<string>;
  readonly runMutation: <T>(kind: string, operation: () => Promise<T>) => Promise<T>;
  readonly narrative: Pick<
    ReturnType<typeof createNarrativeService>,
    "claimsTo" | "explainStatement" | "recoverCandidates" | "candidateDelivery"
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
  const route: NamedGatewayRoute = (name, path, input, output, operation) =>
    registerGatewayPost(app, {
      path: "/gateway/v1/narrative/" + path,
      operationId: name,
      input,
      output,
      authenticate: async (request) => owners().authenticate(gatewayBearer(request)),
      operation: (input) =>
        owners().runMutation("gateway.narrative." + name, async () => {
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
    });
  route(
    "recoverExpressionCandidates",
    "recover-candidates",
    recoverExpressionCandidatesSchema,
    Type.Object(
      { recovered: Type.Integer({ minimum: 0 }) },
      { additionalProperties: false },
    ),
    (input) => owners().narrative.recoverCandidates(input),
  );
  route(
    "readExpressionCandidateDelivery",
    "candidate-delivery",
    expressionCandidateSelectionSchema,
    expressionCandidateDeliverySchema,
    (input) => owners().narrative.candidateDelivery(input),
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
