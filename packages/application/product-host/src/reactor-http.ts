// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Authenticated reads of actual foreground, saved attention choices and effective policy.
 * @module reactor-http
 */
import { gatewayBearer, registerGatewayPost } from "./gateway-route.js";
import type { FastifyInstance } from "fastify";
import { Type, type Static, type TSchema } from "@heptalogos/schema-runtime/typebox";
import {
  subjectReactionSchema,
  reactorActionReceiptSchema,
  attentionSelectionSchema,
  readWorldSchema,
  type createSubjectReactorService,
  type createSubjectAttentionService,
} from "@heptalogos/subject";
import {
  effectiveReactorPolicy,
  reactorPolicySchema,
  subjectRoleBindingSchema,
  managementProblem,
  type ProductSettings,
} from "@heptalogos/management";
const object = { additionalProperties: false } as const;
const id = readWorldSchema.properties.subjectId;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
/** Last actual lifecycle projection attempt; a projected opportunity is not model execution. */
export const reactorProjectionSchema = Type.Object(
  {
    state: Type.Union([
      Type.Literal("not_requested"),
      Type.Literal("projected"),
      Type.Literal("unavailable"),
      Type.Literal("disabled"),
    ]),
    operationRef: Type.Optional(ref),
    attemptedAt: Type.Optional(Type.String({ format: "date-time" })),
  },
  object,
);
/** Scheduling metadata remains independent from configuration activation. */
export type ReactorProjection = Static<typeof reactorProjectionSchema>;
/** Management never acquires a foreground qualification or adopts a model decision. */
export interface ReactorHttpOptions {
  readonly authenticate: (token: string | undefined) => Promise<void>;
  readonly currentSubject: () => Promise<string>;
  readonly settings: () => Promise<ProductSettings>;
  readonly foreground: Pick<
    ReturnType<typeof createSubjectReactorService>,
    "current" | "readReaction" | "lastAction" | "history"
  >;
  readonly attention: Pick<ReturnType<typeof createSubjectAttentionService>, "explain">;
  readonly runMutation: <T>(kind: string, operation: () => Promise<T>) => Promise<T>;
  readonly wake: (input: {
    subjectId: string;
    operationRef: string;
    activityId?: string;
  }) => Promise<void>;
  readonly projection: () => ReactorProjection;
}
/** Schema-only construction is available without any model or running native Gateway. */
export function registerReactorHttp(
  app: FastifyInstance,
  options?: ReactorHttpOptions,
) {
  const owners = () =>
    options ??
    (() => {
      throw managementProblem(
        "reactor.unconfigured",
        "Reactor is unavailable",
        "Use the installed Product Host composition",
        "unavailable",
      );
    })();
  const route = <T extends TSchema>(
    name: string,
    input: T,
    output: TSchema,
    operation: (input: Static<T>) => Promise<unknown>,
  ) =>
    registerGatewayPost(app, {
      path: "/gateway/v1/reactor/" + name,
      operationId: "reactor" + name[0]!.toUpperCase() + name.slice(1),
      input,
      output,
      authenticate: async (request) => owners().authenticate(gatewayBearer(request)),
      operation: async (input) => {
        if (
          (input as { subjectId: string }).subjectId !==
          (await owners().currentSubject())
        )
          throw managementProblem(
            "reactor.scope_denied",
            "Another Subject was requested",
            "Use the current bound Subject",
            "authorization",
          );
        return operation(input);
      },
    });
  route(
    "status",
    Type.Object({ subjectId: id, reactionId: Type.Optional(id) }, object),
    Type.Object(
      {
        reaction: Type.Union([subjectReactionSchema, Type.Null()]),
        lastAction: Type.Union([reactorActionReceiptSchema, Type.Null()]),
        policy: reactorPolicySchema,
        roles: Type.Array(subjectRoleBindingSchema),
        opportunityProjection: reactorProjectionSchema,
      },
      object,
    ),
    async (input) => {
      const reaction = input.reactionId
        ? await owners().foreground.readReaction(input.subjectId, input.reactionId)
        : await owners().foreground.current(input.subjectId);
      const settings = await owners().settings();
      return {
        reaction: reaction ?? null,
        lastAction: reaction
          ? ((await owners().foreground.lastAction(
              input.subjectId,
              reaction.reactionId,
            )) ?? null)
          : null,
        policy: effectiveReactorPolicy(settings),
        roles: settings.roles ?? [],
        opportunityProjection: owners().projection(),
      };
    },
  );
  route(
    "history",
    Type.Object(
      {
        subjectId: id,
        limit: Type.Integer({ minimum: 1, maximum: 128 }),
        afterReactionId: Type.Optional(id),
      },
      object,
    ),
    Type.Object(
      {
        reactions: Type.Array(subjectReactionSchema),
        more: Type.Boolean(),
        nextReactionId: Type.Union([id, Type.Null()]),
      },
      object,
    ),
    (input) => owners().foreground.history(input),
  );
  route(
    "attentionExplain",
    Type.Object({ subjectId: id, explanationRef: Type.Optional(ref) }, object),
    Type.Object(
      { selection: Type.Union([attentionSelectionSchema, Type.Null()]) },
      object,
    ),
    async (input) => ({
      selection:
        (await owners().attention.explain(input.subjectId, input.explanationRef)) ??
        null,
    }),
  );
  route(
    "wake",
    Type.Object(
      { subjectId: id, operationRef: ref, activityId: Type.Optional(id) },
      object,
    ),
    Type.Object({ projected: Type.Literal(true) }, object),
    (input) =>
      owners().runMutation("management.reactor.wake", async () => {
        await owners().wake(input);
        return { projected: true };
      }),
  );
}
