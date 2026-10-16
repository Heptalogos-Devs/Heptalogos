// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Registers authenticated world operations using the world owner's schemas. @module world-http */
import { managementProblem, managementProblemSchema } from "@heptalogos/management";
import type { FastifyInstance } from "fastify";
import { Type, type Static, type TSchema } from "@heptalogos/schema-runtime/typebox";
import {
  advanceWorldRulesSchema,
  worldFrameSchema,
  configureWorldSchema,
  queryWorldSchema,
  readWorldSchema,
  realizeWorldSchema,
  worldStateSchema,
  worldRealizationResultSchema,
  worldQueryResultSchema,
  type createWorldLifeService,
} from "@heptalogos/subject";
/** Management authorization is supplied by the existing authenticated Host boundary. */
export interface WorldHttpOptions {
  readonly authenticate: (token: string | undefined) => Promise<void>;
  readonly runMutation: <T>(kind: string, operation: () => Promise<T>) => Promise<T>;
  readonly worlds: ReturnType<typeof createWorldLifeService>;
  readonly currentSubject: () => Promise<string>;
}
/** No model-facing world management capability is created here. */
export function registerWorldHttp(app: FastifyInstance, options?: WorldHttpOptions) {
  const owners = () =>
    options ??
    (() => {
      throw managementProblem(
        "world.unconfigured",
        "WorldLife is not configured",
        "Use the current installed Product Host composition",
        "unavailable",
      );
    })();
  const route = <T extends TSchema>(
    name: string,
    input: T,
    output: TSchema,
    operation: (value: Static<T>) => Promise<unknown>,
  ) =>
    app.post(
      "/management/v1/world/" + name,
      {
        onRequest: async (request) => {
          const header = request.headers.authorization;
          await owners().authenticate(
            header?.startsWith("Bearer ") ? header.slice(7) : undefined,
          );
        },
        schema: {
          operationId: "world" + name[0]!.toUpperCase() + name.slice(1),
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
        },
      },
      async (request) =>
        owners().runMutation("management.world." + name, async () => {
          const body = request.body as {
            subjectId?: string;
            definition?: { subjectId?: string };
          };
          if (
            (body.subjectId ?? body.definition?.subjectId) !==
            (await owners().currentSubject())
          )
            throw managementProblem(
              "world.scope_denied",
              "World belongs to another Subject",
              "Use the current bound Subject",
              "authorization",
            );
          return operation(request.body as Static<T>);
        }),
    );
  route("configure", configureWorldSchema, worldStateSchema, (input) =>
    owners().worlds.configure(input),
  );
  route(
    "read",
    readWorldSchema,
    Type.Object(
      { world: Type.Union([worldStateSchema, Type.Null()]) },
      { additionalProperties: false },
    ),
    async (input) => ({
      world: (await owners().worlds.read(input.subjectId, input.worldId)) ?? null,
    }),
  );
  route("prepare", readWorldSchema, worldFrameSchema, (input) =>
    owners().worlds.prepareAdvance(input.subjectId, input.worldId),
  );
  route(
    "advanceRules",
    advanceWorldRulesSchema,
    worldRealizationResultSchema,
    (input) =>
      owners().worlds.advanceRules(input.subjectId, input.worldId, input.interval),
  );
  route("realize", realizeWorldSchema, worldRealizationResultSchema, (input) =>
    owners().worlds.realize(input),
  );
  // The owner returns a discriminated view. Retain its schema source at the owner rather than duplicating DTOs here.
  route("query", queryWorldSchema, worldQueryResultSchema, (input) =>
    owners().worlds.query(input),
  );
}
