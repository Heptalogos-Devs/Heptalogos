// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adopts independent world inputs and initial role facts without changing Subject Seed or biography.
 * @module world-profile
 */
import { Temporal } from "@js-temporal/polyfill";
import { v5 as uuidv5 } from "uuid";
import { createSubjectSchemaReader } from "./checked-schema.js";
import { readSubjectRows } from "./subject-read.js";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import {
  executeRepositorySql,
  type PersistenceInternalTransaction,
  readRepositorySql,
  useRepositoryMutationTransaction,
} from "@heptalogos/persistence/repository";
import type { PersistenceService } from "@heptalogos/persistence";
import { lockSubjectNarrative, type createWorldLifeService } from "./world-life.js";
import {
  adoptWorldProfileSchema,
  adoptedWorldProfileSchema,
  type AdoptedWorldProfile,
  type AdoptWorldProfile,
  type WorldLivingState,
  type WorldProfile,
} from "./world-profile-contracts.js";
import type { WorldDefinition } from "./world-contracts.js";
import type { LifeActivity } from "./contracts.js";
import { subjectProblem } from "./problems.js";
import { subjectLineage } from "./subject-lineage.js";
function conflict(detail: string): never {
  throw subjectProblem(
    "world.profile_conflict",
    "World profile cannot be adopted",
    detail,
    "conflict",
  );
}
const parse = createSubjectSchemaReader(() =>
  conflict("Use the single canonical WorldProfile JSON contract"),
);
/** Official public time slots; adopting these times creates no school identity or course biography. */
export const schoolCalendarTemplate = {
  id: "jci-2025",
  timezone: "Asia/Shanghai",
  publishedOn: "2025-07-15",
  effectiveFrom: "2025-09-08",
  source: "https://www.jci.edu.cn/info/1055/49762.htm",
  lessons: [
    ["08:00", "08:40"],
    ["08:45", "09:25"],
    ["09:45", "10:25"],
    ["10:30", "11:10"],
    ["11:15", "11:55"],
    ["14:00", "14:40"],
    ["14:45", "15:25"],
    ["15:45", "16:25"],
    ["16:30", "17:10"],
    ["19:00", "19:40"],
    ["19:45", "20:25"],
  ],
  otherTimes: [
    { title: "上午预备", start: "07:50" },
    { title: "午餐和午休", start: "11:55", end: "13:50" },
    { title: "下午预备", start: "13:50" },
    { title: "晚餐", start: "17:10", end: "18:50" },
    { title: "晚自习时段", start: "19:00", end: "22:30" },
    { title: "教室熄灯", start: "22:30" },
    { title: "就寝和宿舍熄灯", start: "23:00" },
  ],
} as const;
/** Pure import preview: only explicitly selected dates, weekdays, classes and participants become rules. */
export function previewSchoolCalendar(
  worldId: string,
  selection: NonNullable<WorldProfile["schoolCalendar"]>,
) {
  const startsOn = Temporal.PlainDate.from(selection.startsOn),
    through = Temporal.PlainDate.from(selection.validThrough);
  if (
    startsOn.toString() < schoolCalendarTemplate.effectiveFrom ||
    Temporal.PlainDate.compare(startsOn, through) > 0
  )
    conflict(
      "Choose a finite school template range after its published effective date",
    );
  if (new Set(selection.slots.map((slot) => slot.slot)).size !== selection.slots.length)
    conflict(
      "Select each lesson slot once; course and weekday choices come from the operator",
    );
  return selection.slots.map((selected) => {
    const times = schoolCalendarTemplate.lessons[selected.slot - 1];
    if (!times) conflict("Select a published lesson slot");
    return {
      ruleId: uuidv5(`school-template:${selection.startsOn}:${selected.slot}`, worldId),
      revision: 1,
      title: selected.title,
      content: selected.title,
      subjectPerception: selected.title,
      startsAtLocal: `${selection.startsOn}T${times[0]}:00`,
      timezone: schoolCalendarTemplate.timezone,
      rrule: `FREQ=WEEKLY;BYDAY=${selection.weekdays.join(",")}`,
      rdates: [],
      exdates: [],
      validThrough: selection.validThrough,
      effectiveFrom: null,
      effectiveUntil: null,
      startShiftSeconds: 0,
      disambiguation: "compatible" as const,
      durationMinutes: 40,
      actorRefs: selected.actorRefs,
      placeRef: selected.placeRef,
      activityId: null,
      kind: "study" as const,
      visibility: "subject" as const,
      adjustable: false,
      mode: "fixed" as const,
      attendancePolicy: selected.attendancePolicy ?? {
        mode: "usual" as const,
        startToleranceMinutes: 5,
        earlyMinutes: 0,
        lateMinutes: 5,
        minimumContinuationMinutes: 10,
        interruptAfterMinutes: 40,
        interruptEvents: [
          "important" as const,
          "emergency" as const,
          "official_change" as const,
        ],
      },
    };
  });
}
/** Identity and official Clock calls occur outside the local adoption transaction. */
export function createWorldProfileService(options: {
  persistence: PersistenceService;
  now: () => string;
  worldNow: (subjectId: string) => Promise<LifeActivity["world"]>;
  worlds: Pick<ReturnType<typeof createWorldLifeService>, "configureIn" | "read">;
  resolveActor: (input: {
    subjectId: string;
    worldId: string;
    actorKey: string;
  }) => Promise<string>;
}) {
  const read = async (
    subjectId: string,
    worldId: string,
    transaction?: PersistenceInternalTransaction,
  ): Promise<AdoptedWorldProfile | undefined> => {
    const statement =
      "SELECT document FROM heptalogos.world_profile WHERE subject_id=$1 AND world_id=$2";
    const parameters = [subjectId, worldId];
    const rows = await readSubjectRows<{ document: unknown }>(
      options.persistence,
      statement,
      parameters,
      transaction,
    );
    return rows[0]
      ? parse<AdoptedWorldProfile>(adoptedWorldProfileSchema, rows[0].document)
      : undefined;
  };
  return {
    read,
    /** Metadata notice is an opportunity to read, never evidence of Subject perception. */
    async entryNotice(subjectId: string, worldId: string) {
      const rows = await readRepositorySql<{
        source_ref: string;
        recorded_at: string;
        time_domain_ref: string;
      }>(
        options.persistence,
        `SELECT document->>'entrySourceRef' AS source_ref,
          document->>'entryRecordedAt' AS recorded_at,
          document#>>'{profile,timeDomainRef}' AS time_domain_ref
         FROM heptalogos.world_profile WHERE subject_id=$1 AND world_id=$2`,
        [subjectId, worldId],
      );
      const row = rows[0];
      return row
        ? {
            worldId,
            entrySourceRef: row.source_ref,
            entryRecordedAt: row.recorded_at,
            timeDomainRef: row.time_domain_ref,
          }
        : undefined;
    },
    async adopt(value: AdoptWorldProfile): Promise<AdoptedWorldProfile> {
      const input = parse<AdoptWorldProfile>(adoptWorldProfileSchema, value),
        profile = input.profile;
      const digest = digestCanonicalJson(
        "world.operation.v1",
        input as unknown as CanonicalJsonValue,
      ).hex;
      const previous = await readRepositorySql<{
        request_digest: string;
        document: unknown;
      }>(
        options.persistence,
        "SELECT request_digest,document FROM heptalogos.world_realization WHERE subject_id=$1 AND operation_id=$2",
        [input.subjectId, input.operationId],
      );
      if (previous[0]) {
        if (previous[0].request_digest !== digest)
          conflict("This profile operation already binds different input");
        return parse<AdoptedWorldProfile>(
          adoptedWorldProfileSchema,
          previous[0].document,
        );
      }
      const world = await options.worldNow(input.subjectId);
      const existingWorld = await options.worlds.read(input.subjectId, input.worldId);
      if (
        world.timeDomainRef !== profile.timeDomainRef ||
        Date.parse(world.at) < Date.parse(profile.entry.at)
      )
        conflict(
          "Select this profile's actual clock domain and entry point before adoption; do not rewind an existing Subject",
        );
      if (!profile.places.some((place) => place.placeRef === profile.entry.placeRef))
        conflict("Entry requires an adopted place");
      if (
        profile.actors.some((actor) => actor.actorKey === "self") ||
        new Set(profile.actors.map((actor) => actor.actorKey)).size !==
          profile.actors.length
      )
        conflict("Use distinct actor keys; self is reserved for the actual Subject");
      for (const edge of profile.travelEdges)
        if (
          !profile.places.some((place) => place.placeRef === edge.from) ||
          !profile.places.some((place) => place.placeRef === edge.to)
        )
          conflict("Travel routes must use adopted places");
      const keys = ["self", ...profile.actors.map((actor) => actor.actorKey)];
      const actorBindings = await Promise.all(
        keys.map(async (actorKey) => ({
          actorKey,
          entityRef: await options.resolveActor({
            subjectId: input.subjectId,
            worldId: input.worldId,
            actorKey,
          }),
        })),
      );
      const actor = (key: string) => {
        const found = actorBindings.find((binding) => binding.actorKey === key);
        if (!found) conflict("A calendar rule names an unknown profile actor key");
        return found.entityRef;
      };
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, input.subjectId);
          const saved = await executeRepositorySql<{
            request_digest: string;
            document: unknown;
          }>(
            tx,
            "SELECT request_digest,document FROM heptalogos.world_realization WHERE subject_id=$1 AND operation_id=$2",
            [input.subjectId, input.operationId],
          );
          if (saved[0]) {
            if (saved[0].request_digest !== digest)
              conflict("This profile operation already binds different input");
            return parse<AdoptedWorldProfile>(
              adoptedWorldProfileSchema,
              saved[0].document,
            );
          }
          const profiles = await executeRepositorySql<{ document: unknown }>(
            tx,
            "SELECT document FROM heptalogos.world_profile WHERE subject_id=$1 ORDER BY world_id",
            [input.subjectId],
          );
          const existing = profiles.map((row) =>
            parse<AdoptedWorldProfile>(adoptedWorldProfileSchema, row.document),
          );
          if (existing.some((record) => record.worldId !== input.worldId))
            conflict(
              "This Subject already adopted another primary world; choose an explicit isolated Subject",
            );
          const current = existing.find((record) => record.worldId === input.worldId);
          if (current) {
            const fixed = (value: typeof profile) => {
              const {
                energy,
                planning,
                clock,
                actionPolicy,
                travelEdges,
                publicCalendar,
                ...identityAndCalendar
              } = value;
              void energy;
              void planning;
              void clock;
              void actionPolicy;
              void travelEdges;
              void publicCalendar;
              return identityAndCalendar;
            };
            if (
              digestCanonicalJson(
                "world.profile-identity.v1",
                fixed(current.profile) as unknown as CanonicalJsonValue,
              ).hex !==
                digestCanonicalJson(
                  "world.profile-identity.v1",
                  fixed(profile) as unknown as CanonicalJsonValue,
                ).hex ||
              profile.energy.initial !== current.profile.energy.initial
            )
              conflict(
                "An existing entry and initial energy stay fixed; use calendar operations for rule changes",
              );
            if (Date.parse(world.at) < Date.parse(current.policyEffectiveAt.at))
              conflict("A policy revision cannot move backwards in world time");
            if (!existingWorld)
              conflict("The adopted world's current definition is unavailable");
            await options.worlds.configureIn(
              tx,
              {
                operationId: uuidv5("definition", input.operationId),
                expectedRevision: input.expectedRevision,
                definition: {
                  ...existingWorld.definition,
                  revision: existingWorld.definition.revision + 1,
                },
                schedule: [...existingWorld.schedule],
              },
              world,
            );
            const record: AdoptedWorldProfile = {
              ...current,
              revision: current.revision + 1,
              operationId: input.operationId,
              profile,
              policyEffectiveAt: world,
              adoptedAt: options.now(),
            };
            await executeRepositorySql(
              tx,
              "UPDATE heptalogos.world_profile SET revision=$3,document=$4::jsonb WHERE subject_id=$1 AND world_id=$2",
              [input.subjectId, input.worldId, record.revision, JSON.stringify(record)],
            );
            await executeRepositorySql(
              tx,
              "INSERT INTO heptalogos.world_profile_history(subject_id,world_id,revision,document,recorded_at,effective_at) VALUES($1,$2,$3,$4::jsonb,$5,$6)",
              [
                input.subjectId,
                input.worldId,
                record.revision,
                JSON.stringify(record),
                record.adoptedAt,
                record.policyEffectiveAt.at,
              ],
            );
            await executeRepositorySql(
              tx,
              "UPDATE heptalogos.world_living SET document=jsonb_set(document,'{profileRevision}',to_jsonb($3::bigint)) WHERE subject_id=$1 AND world_id=$2",
              [input.subjectId, input.worldId, record.revision],
            );
            await executeRepositorySql(
              tx,
              "INSERT INTO heptalogos.world_realization(subject_id,world_id,operation_id,request_digest,document,recorded_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
              [
                input.subjectId,
                input.worldId,
                input.operationId,
                digest,
                JSON.stringify(record),
                record.adoptedAt,
              ],
            );
            return record;
          }
          const definition: WorldDefinition = {
            worldId: input.worldId,
            subjectId: input.subjectId,
            revision: (existingWorld?.definition.revision ?? 0) + 1,
            name: profile.name,
            timeDomainRef: profile.timeDomainRef,
            timezone: profile.timezone,
            offlinePolicy: profile.offlinePolicy,
            places: profile.places,
            actors: [
              {
                entityRef: actor("self"),
                name: profile.entry.role,
                description: profile.entry.description,
              },
              ...profile.actors.map((person) => ({
                entityRef: actor(person.actorKey),
                name: person.name,
                description: person.description,
              })),
            ],
            subjectActorRef: actor("self"),
            rules: profile.rules,
            creationScope: profile.creationScope,
            informationSourceRefs: [
              ...profile.informationSourceRefs,
              ...(profile.schoolCalendar ? [schoolCalendarTemplate.source] : []),
            ],
            routineRules: [
              ...profile.routineRules,
              ...(profile.schoolCalendar
                ? previewSchoolCalendar(input.worldId, profile.schoolCalendar)
                : []),
            ].map((rule) => ({
              ...rule,
              actorRefs: rule.actorRefs.map(actor),
            })),
            calendarExceptions: profile.calendarExceptions.map((exception) => ({
              ...exception,
              ...(exception.actorRefs
                ? { actorRefs: exception.actorRefs.map(actor) }
                : {}),
            })),
          };
          await options.worlds.configureIn(
            tx,
            {
              operationId: uuidv5("definition", input.operationId),
              expectedRevision: input.expectedRevision,
              definition,
              schedule: [],
            },
            world,
          );
          const now = options.now();
          const record: AdoptedWorldProfile = {
            subjectId: input.subjectId,
            worldId: input.worldId,
            revision: 1,
            operationId: input.operationId,
            profile,
            subjectActorRef: actor("self"),
            actorBindings,
            entrySourceRef: `world-profile:${input.worldId}:1`,
            entryRecordedAt: now,
            policyEffectiveAt: {
              timeDomainRef: profile.timeDomainRef,
              at: profile.entry.at,
            },
            adoptedAt: now,
          };
          const living: WorldLivingState = {
            subjectId: input.subjectId,
            worldId: input.worldId,
            revision: 1,
            profileRevision: 1,
            energy: profile.energy.initial,
            integratedThrough: {
              timeDomainRef: profile.timeDomainRef,
              at: profile.entry.at,
            },
            coverage: "limited",
            currentPlaceRef: profile.entry.placeRef,
            currentActivityRefs: [],
            energyExplanation:
              "Initial energy from the explicitly adopted WorldProfile; no past life or rest is inferred",
            device: { revision: 1, view: { kind: "stowed" } },
            updatedAt: now,
          };
          await executeRepositorySql(
            tx,
            "INSERT INTO heptalogos.world_profile(subject_id,world_id,revision,document,lineage_context_ref) VALUES($1,$2,1,$3::jsonb,$4::jsonb)",
            [
              input.subjectId,
              input.worldId,
              JSON.stringify(record),
              JSON.stringify(subjectLineage(context.execution)),
            ],
          );
          await executeRepositorySql(
            tx,
            "INSERT INTO heptalogos.world_profile_history(subject_id,world_id,revision,document,recorded_at,effective_at) VALUES($1,$2,1,$3::jsonb,$4,$5)",
            [
              input.subjectId,
              input.worldId,
              JSON.stringify(record),
              now,
              record.policyEffectiveAt.at,
            ],
          );
          await executeRepositorySql(
            tx,
            "INSERT INTO heptalogos.world_living(subject_id,world_id,document) VALUES($1,$2,$3::jsonb)",
            [input.subjectId, input.worldId, JSON.stringify(living)],
          );
          await executeRepositorySql(
            tx,
            "INSERT INTO heptalogos.world_living_history(subject_id,world_id,revision,integrated_through,document) VALUES($1,$2,1,$3,$4::jsonb)",
            [input.subjectId, input.worldId, profile.entry.at, JSON.stringify(living)],
          );
          await executeRepositorySql(
            tx,
            "INSERT INTO heptalogos.world_realization(subject_id,world_id,operation_id,request_digest,document,recorded_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
            [
              input.subjectId,
              input.worldId,
              input.operationId,
              digest,
              JSON.stringify(record),
              now,
            ],
          );
          return record;
        }),
      );
    },
  };
}
