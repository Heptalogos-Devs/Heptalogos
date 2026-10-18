// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Independent WorldProfile, derived living state and device contracts.
 * @module world-profile-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import {
  worldDefinitionSchema,
  worldRoutineRuleSchema,
  worldCalendarExceptionSchema,
} from "./world-contracts.js";
import { worldEnergyProfileSchema } from "./world-energy-contracts.js";
import { worldPointSchema } from "./contracts.js";
const object = { additionalProperties: false } as const;
const id = worldDefinitionSchema.properties.worldId;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
/** Independent environment input uses actor keys resolved by trusted Identity, with self reserved for the Subject. */
export const worldProfileSchema = Type.Object(
  {
    name: ref,
    timeDomainRef: ref,
    timezone: ref,
    offlinePolicy: worldDefinitionSchema.properties.offlinePolicy,
    clock: Type.Object(
      {
        onlineRate: Type.Number({ minimum: 0 }),
        offlineRate: Type.Number({ minimum: 0 }),
      },
      object,
    ),
    entry: Type.Object(
      {
        role: ref,
        description: Type.String({ minLength: 1, maxLength: 16384 }),
        placeRef: ref,
        at: worldPointSchema.properties.at,
      },
      object,
    ),
    places: worldDefinitionSchema.properties.places,
    actors: Type.Array(
      Type.Object(
        {
          actorKey: ref,
          name: ref,
          description: Type.String({ minLength: 1, maxLength: 16384 }),
        },
        object,
      ),
      { maxItems: 128 },
    ),
    rules: worldDefinitionSchema.properties.rules,
    creationScope: worldDefinitionSchema.properties.creationScope,
    informationSourceRefs: worldDefinitionSchema.properties.informationSourceRefs,
    schoolCalendar: Type.Optional(
      Type.Object(
        {
          template: Type.Literal("jci-2025"),
          startsOn: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
          validThrough: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
          weekdays: Type.Array(
            Type.Union([
              Type.Literal("MO"),
              Type.Literal("TU"),
              Type.Literal("WE"),
              Type.Literal("TH"),
              Type.Literal("FR"),
              Type.Literal("SA"),
              Type.Literal("SU"),
            ]),
            { minItems: 1, uniqueItems: true, maxItems: 7 },
          ),
          slots: Type.Array(
            Type.Object(
              {
                slot: Type.Integer({ minimum: 1, maximum: 11 }),
                title: ref,
                placeRef: ref,
                actorRefs: Type.Array(ref, {
                  minItems: 1,
                  maxItems: 128,
                  uniqueItems: true,
                }),
                attendancePolicy: Type.Optional(
                  worldRoutineRuleSchema.properties.attendancePolicy,
                ),
              },
              object,
            ),
            { minItems: 1, maxItems: 11 },
          ),
        },
        object,
      ),
    ),
    routineRules: Type.Array(worldRoutineRuleSchema, { maxItems: 256 }),
    calendarExceptions: Type.Array(worldCalendarExceptionSchema, { maxItems: 1024 }),
    energy: worldEnergyProfileSchema,
    planning: Type.Object(
      {
        horizonHours: Type.Number({ exclusiveMinimum: 0, maximum: 744 }),
        detailHours: Type.Number({ exclusiveMinimum: 0, maximum: 744 }),
      },
      object,
    ),
    actionPolicy: Type.Optional(
      Type.Object({ restMinutes: Type.Integer({ minimum: 1, maximum: 1440 }) }, object),
    ),
    travelEdges: Type.Array(
      Type.Object(
        {
          from: ref,
          to: ref,
          durationMinutes: Type.Integer({ minimum: 1, maximum: 10080 }),
        },
        object,
      ),
      { maxItems: 1024 },
    ),
    publicCalendar: Type.Union([Type.Literal("none"), Type.Literal("busy")]),
  },
  object,
);
/** Adopts one profile on the explicitly selected stable Subject; Seed is an independent Nous operation. */
export const adoptWorldProfileSchema = Type.Object(
  {
    operationId: id,
    subjectId: id,
    worldId: id,
    expectedRevision: Type.Integer({ minimum: 0 }),
    profile: worldProfileSchema,
  },
  object,
);
/** An adopted profile retains the original input and exact entry source without inventing past biography. */
export const adoptedWorldProfileSchema = Type.Object(
  {
    subjectId: id,
    worldId: id,
    revision: Type.Integer({ minimum: 1 }),
    operationId: id,
    profile: worldProfileSchema,
    subjectActorRef: ref,
    actorBindings: Type.Array(Type.Object({ actorKey: ref, entityRef: ref }, object)),
    entrySourceRef: ref,
    entryRecordedAt: worldPointSchema.properties.at,
    policyEffectiveAt: worldPointSchema,
    adoptedAt: worldPointSchema.properties.at,
  },
  object,
);
/** Device view has its own CAS revision, independent of energy integration and unrelated world events. */
export const worldDeviceViewSchema = Type.Union([
  Type.Object({ kind: Type.Literal("stowed") }, object),
  Type.Object({ kind: Type.Literal("notifications") }, object),
  Type.Object({ kind: Type.Literal("conversations") }, object),
  Type.Object({ kind: Type.Literal("conversation"), conversationRef: ref }, object),
  Type.Object({ kind: Type.Literal("page"), materialRef: ref }, object),
]);
/** Only already-realized intervals change energy; no planned sleep or worker count changes it. */
export const worldLivingStateSchema = Type.Object(
  {
    subjectId: id,
    worldId: id,
    revision: Type.Integer({ minimum: 1 }),
    profileRevision: Type.Integer({ minimum: 1 }),
    energy: Type.Number({ minimum: 0, maximum: 100 }),
    integratedThrough: worldPointSchema,
    coverage: Type.Union([Type.Literal("complete"), Type.Literal("limited")]),
    currentPlaceRef: ref,
    currentActivityRefs: Type.Array(ref),
    energyExplanation: Type.String({ maxLength: 16384 }),
    device: Type.Object(
      { revision: Type.Integer({ minimum: 1 }), view: worldDeviceViewSchema },
      object,
    ),
    updatedAt: worldPointSchema.properties.at,
  },
  object,
);
/** A trusted action changes device view after its actual semantic operation, not merely after dispatch. */
export const adoptWorldDeviceViewSchema = Type.Object(
  {
    operationId: id,
    subjectId: id,
    worldId: id,
    expectedRevision: Type.Integer({ minimum: 1 }),
    view: worldDeviceViewSchema,
  },
  object,
);
/** Public schema-derived profile type. */
export type WorldProfile = Static<typeof worldProfileSchema>;
/** Public schema-derived adopted profile. */
export type AdoptedWorldProfile = Static<typeof adoptedWorldProfileSchema>;
/** Public schema-derived living state. */
export type WorldLivingState = Static<typeof worldLivingStateSchema>;
/** Public schema-derived device mutation. */
export type AdoptWorldDeviceView = Static<typeof adoptWorldDeviceViewSchema>;
/** Public schema-derived profile mutation. */
export type AdoptWorldProfile = Static<typeof adoptWorldProfileSchema>;
