// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Registers authenticated world operations using the world owner's schemas.
 * @module world-http
 */
import { managementProblem, managementProblemSchema } from "@heptalogos/management";
import {
  resolveWorldActorInputSchema,
  readWorldActorsInputSchema,
  entitySchema,
  type IdentityService,
} from "@heptalogos/identity";
import type { FastifyInstance } from "fastify";
import { Type, type Static, type TSchema } from "@heptalogos/schema-runtime/typebox";
import {
  worldHistoryQuerySchema,
  worldHistoryResultSchema,
  worldCoverageQuerySchema,
  worldCoverageResultSchema,
  advanceWorldRulesSchema,
  worldFrameSchema,
  configureWorldSchema,
  queryWorldSchema,
  readWorldSchema,
  realizeWorldSchema,
  worldStateSchema,
  worldRealizationResultSchema,
  worldQueryResultSchema,
  readCalendarSchema,
  calendarResultSchema,
  changeCalendarSchema,
  adoptWorldProfileSchema,
  adoptedWorldProfileSchema,
  worldLivingStateSchema,
  type createWorldLifeService,
  type createWorldProfileService,
} from "@heptalogos/subject";
import {
  worldClockConfigurationSchema,
  worldClockStatusSchema,
  type WorldClockManagement,
} from "./world-clock.js";
/** Management authorization is supplied by the existing authenticated Host boundary. */
export interface WorldHttpOptions {
  readonly authenticate: (token: string | undefined) => Promise<void>;
  readonly runMutation: <T>(kind: string, operation: () => Promise<T>) => Promise<T>;
  readonly identity?: Pick<IdentityService, "resolveWorldActor" | "readWorldActors">;
  readonly worlds: ReturnType<typeof createWorldLifeService>;
  readonly profiles: Pick<
    ReturnType<typeof createWorldProfileService>,
    "adopt" | "read"
  >;
  readonly living: ReturnType<typeof createWorldLifeService>["readLivingState"];
  readonly clock?: WorldClockManagement;
  readonly onProfileAdopted?: (
    input: Static<typeof adoptedWorldProfileSchema>,
  ) => Promise<void>;
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
      "/gateway/v1/world/" + name,
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
  route("calendarRead", readCalendarSchema, calendarResultSchema, (input) =>
    owners().worlds.readCalendar(input),
  );
  route("calendarChange", changeCalendarSchema, worldStateSchema, (input) =>
    owners().worlds.changeCalendar(input),
  );
  route(
    "profileAdopt",
    adoptWorldProfileSchema,
    adoptedWorldProfileSchema,
    async (input) => {
      const adopted = await owners().profiles.adopt(input);
      await owners().onProfileAdopted?.(adopted);
      return adopted;
    },
  );
  route(
    "profileRead",
    readWorldSchema,
    Type.Object(
      { profile: Type.Union([adoptedWorldProfileSchema, Type.Null()]) },
      { additionalProperties: false },
    ),
    async (input) => ({
      profile: (await owners().profiles.read(input.subjectId, input.worldId)) ?? null,
    }),
  );
  route(
    "living",
    readWorldSchema,
    Type.Object(
      { living: Type.Union([worldLivingStateSchema, Type.Null()]) },
      { additionalProperties: false },
    ),
    async (input) => ({ living: (await owners().living(input)) ?? null }),
  );
  const clockOwner = () => {
    const clock = owners().clock;
    if (!clock)
      throw managementProblem(
        "world.clock_unavailable",
        "Official Clock management is unavailable",
        "Use the installed Product Host Clock composition",
        "unavailable",
      );
    return clock;
  };
  route(
    "clockRead",
    Type.Pick(readWorldSchema, ["subjectId"]),
    worldClockStatusSchema,
    (input) => clockOwner().read(input.subjectId),
  );
  route(
    "clockConfigure",
    worldClockConfigurationSchema,
    worldClockStatusSchema,
    (input) => clockOwner().configure(input),
  );
  // The owner returns a discriminated view. Retain its schema source at the owner rather than duplicating DTOs here.
  route("query", queryWorldSchema, worldQueryResultSchema, (input) =>
    owners().worlds.query(input),
  );
  route("history", worldHistoryQuerySchema, worldHistoryResultSchema, (input) =>
    owners().worlds.history(input),
  );
  route("coverage", worldCoverageQuerySchema, worldCoverageResultSchema, (input) =>
    owners().worlds.coverage(
      input.subjectId,
      input.worldId,
      input.interval,
      input.asRecordedAt,
    ),
  );
  const actorOwner = () => {
    const value = owners().identity;
    if (!value)
      throw managementProblem(
        "world.identity_unavailable",
        "World actor Identity owner is unavailable",
        "Use the current installed Identity composition",
        "unavailable",
      );
    return value;
  };
  route(
    "actorResolve",
    Type.Object(
      {
        ...resolveWorldActorInputSchema.properties,
        subjectId: readWorldSchema.properties.subjectId,
      },
      { additionalProperties: false },
    ),
    entitySchema,
    (input) =>
      actorOwner().resolveWorldActor({
        worldId: input.worldId,
        actorKey: input.actorKey,
      }),
  );
  route(
    "actors",
    Type.Object(
      {
        ...readWorldActorsInputSchema.properties,
        subjectId: readWorldSchema.properties.subjectId,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        actors: Type.Array(
          Type.Object(
            { actorKey: Type.String(), entity: entitySchema },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    (input) =>
      actorOwner().readWorldActors({
        worldId: input.worldId,
        entityRefs: input.entityRefs,
      }),
  );
}
