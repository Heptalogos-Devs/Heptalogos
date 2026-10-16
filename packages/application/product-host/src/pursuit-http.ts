// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Registers the service-authenticated Pursuit API from its owner schemas.
 * @module pursuit-http
 */
import { managementProblem, managementProblemSchema } from "@heptalogos/management";
import type { FastifyInstance } from "fastify";
import { Type, type Static, type TSchema } from "@heptalogos/schema-runtime/typebox";
import {
  adoptPursuitSchema,
  readPursuitSchema,
  transitionPursuitSchema,
  reconsiderPursuitSchema,
  evaluatePursuitSchema,
  pursuitSchema,
  pursuitEvaluationSchema,
  type createPursuitService,
} from "@heptalogos/subject";
/** Composes with the existing Host authentication and execution boundary; no model-facing management tools are registered. */
export interface PursuitHttpOptions {
  readonly authenticate: (token: string | undefined) => Promise<void>;
  readonly runMutation: <T>(kind: string, operation: () => Promise<T>) => Promise<T>;
  readonly pursuits: ReturnType<typeof createPursuitService>;
  readonly currentSubject: () => Promise<string>;
}
/** Exposes only schema-owned service operations; absent installation composition fails closed. */
export function registerPursuitHttp(
  app: FastifyInstance,
  options?: PursuitHttpOptions,
) {
  const owners = () =>
    options ??
    (() => {
      throw managementProblem(
        "gateway.unconfigured",
        "Pursuit is not configured",
        "Install the current Product Host composition",
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
      "/gateway/v1/pursuit/" + path,
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
          response: {
            200: output,
            400: managementProblemSchema,
            401: managementProblemSchema,
            403: managementProblemSchema,
            409: managementProblemSchema,
            503: managementProblemSchema,
            500: managementProblemSchema,
          },
          security: [{ gatewayService: [] }],
        },
      },
      async (request) =>
        owners().runMutation("gateway." + name, async () => {
          if (
            (request.body as { subjectId?: string }).subjectId !==
            (await owners().currentSubject())
          )
            throw managementProblem(
              "gateway.scope_denied",
              "Pursuit belongs to another Subject",
              "Use the current bound Subject",
              "authorization",
            );
          return operation(request.body as Static<T>);
        }),
    );
  route("adoptPursuit", "adopt", adoptPursuitSchema, pursuitSchema, (input) =>
    owners().pursuits.adopt(input),
  );
  route(
    "readPursuit",
    "read",
    readPursuitSchema,
    Type.Object(
      { pursuit: Type.Union([pursuitSchema, Type.Null()]) },
      { additionalProperties: false },
    ),
    async (input) => ({
      pursuit: (await owners().pursuits.get(input.subjectId, input.pursuitId)) ?? null,
    }),
  );
  route("recheckPursuit", "recheck", readPursuitSchema, pursuitSchema, (input) =>
    owners().pursuits.recheck(input.subjectId, input.pursuitId),
  );
  route(
    "transitionPursuit",
    "transition",
    transitionPursuitSchema,
    pursuitSchema,
    (input) => owners().pursuits.transition(input),
  );
  route(
    "reconsiderPursuit",
    "reconsider",
    reconsiderPursuitSchema,
    pursuitSchema,
    (input) => owners().pursuits.reconsider(input),
  );
  route(
    "evaluatePursuit",
    "evaluate",
    evaluatePursuitSchema,
    pursuitEvaluationSchema,
    (input) => owners().pursuits.evaluate(input),
  );
}
