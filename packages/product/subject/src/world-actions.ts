// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adopts world actions and realizes their elapsed intervals through the existing WorldLife transaction.
 * @module world-actions
 */
import { v5 as uuidv5 } from "uuid";
import { Temporal } from "@js-temporal/polyfill";
import { createSubjectSchemaReader } from "./checked-schema.js";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import {
  executeRepositorySql,
  readRepositorySql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type { PersistenceService } from "@heptalogos/persistence";
import type { LifeActivity } from "./contracts.js";
import { worldScheduleAttendancePolicy } from "./world-contracts.js";
import type { WorldState, realizeWorldSchema } from "./world-contracts.js";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import {
  adoptedWorldProfileSchema,
  worldLivingStateSchema,
  type AdoptedWorldProfile,
  type WorldLivingState,
} from "./world-profile-contracts.js";
import {
  adoptWorldActionSchema,
  worldActionResultSchema,
  type AdoptWorldAction,
  type WorldActionResult,
} from "./world-action-contracts.js";
import { expandWorldRoutines } from "./world-calendar.js";
import { subjectProblem } from "./problems.js";
function invalid(detail: string): never {
  throw subjectProblem(
    "world.action_conflict",
    "World action cannot proceed",
    detail,
    "conflict",
  );
}
const parse = createSubjectSchemaReader(() =>
  invalid("Use the canonical world action contract"),
);
/** Actual external clock reads precede short Host transactions; no action can advance that clock. */
export function createWorldActionService(options: {
  persistence: PersistenceService;
  now: () => string;
  worldNow: (subjectId: string) => Promise<LifeActivity["world"]>;
  lockSubject: (tx: PersistenceInternalTransaction, subjectId: string) => Promise<void>;
  readIn: (
    tx: PersistenceInternalTransaction,
    subjectId: string,
    worldId: string,
  ) => Promise<WorldState | undefined>;
  realizeIn: (
    tx: PersistenceInternalTransaction,
    input: Static<typeof realizeWorldSchema>,
    world: LifeActivity["world"],
  ) => Promise<unknown>;
}) {
  const currentIn = async (
    tx: PersistenceInternalTransaction,
    subjectId: string,
    worldId: string,
    timeDomainRef: string,
    missing: string,
  ) => {
    await options.lockSubject(tx, subjectId);
    const state = await options.readIn(tx, subjectId, worldId);
    if (!state || state.definition.timeDomainRef !== timeDomainRef) invalid(missing);
    return state;
  };
  const readPending = async (subjectId: string, worldId: string, limit = 64) => {
    const rows = await readRepositorySql<{ document: unknown }>(
      options.persistence,
      "SELECT document FROM heptalogos.world_action WHERE subject_id=$1 AND world_id=$2 AND state='pending' ORDER BY ends_at,action_id LIMIT $3",
      [subjectId, worldId, Math.max(1, Math.min(limit, 128))],
    );
    return rows.map((row) =>
      parse<WorldActionResult>(worldActionResultSchema, row.document),
    );
  };
  const service = {
    readPendingActions: readPending,
    async adoptAction(
      value: AdoptWorldAction,
      assertReactionIn?: (tx: PersistenceInternalTransaction) => Promise<void>,
    ): Promise<WorldActionResult> {
      const input = parse<AdoptWorldAction>(adoptWorldActionSchema, value),
        digest = digestCanonicalJson(
          "world.semantic-action.v1",
          input as unknown as CanonicalJsonValue,
        ).hex;
      const saved = await readRepositorySql<{
        request_digest: string;
        document: unknown;
      }>(
        options.persistence,
        "SELECT request_digest,document FROM heptalogos.world_action WHERE subject_id=$1 AND operation_id=$2",
        [input.subjectId, input.operationId],
      );
      if (saved[0]) {
        if (saved[0].request_digest !== digest)
          invalid("This world action already binds another choice");
        return parse<WorldActionResult>(worldActionResultSchema, saved[0].document);
      }
      const world = await options.worldNow(input.subjectId);
      await service.completeActions(
        { subjectId: input.subjectId, worldId: input.worldId },
        world,
      );
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          const state = await currentIn(
            tx,
            input.subjectId,
            input.worldId,
            world.timeDomainRef,
            "Use this adopted world's actual current clock domain",
          );
          const previous = await executeRepositorySql<{
            request_digest: string;
            document: unknown;
          }>(
            tx,
            "SELECT request_digest,document FROM heptalogos.world_action WHERE subject_id=$1 AND operation_id=$2",
            [input.subjectId, input.operationId],
          );
          if (previous[0]) {
            if (previous[0].request_digest !== digest)
              invalid("This action identity already binds another choice");
            return parse<WorldActionResult>(
              worldActionResultSchema,
              previous[0].document,
            );
          }
          if (assertReactionIn) await assertReactionIn(tx);
          const rows = await executeRepositorySql<{
            living: unknown;
            profile: unknown;
          }>(
            tx,
            "SELECT l.document AS living,p.document AS profile FROM heptalogos.world_living l JOIN heptalogos.world_profile p USING(subject_id,world_id) WHERE l.subject_id=$1 AND l.world_id=$2 FOR UPDATE OF l",
            [input.subjectId, input.worldId],
          );
          if (!rows[0]) invalid("Adopt the world's profile and actual presence first");
          const living = parse<WorldLivingState>(
              worldLivingStateSchema,
              rows[0].living,
            ),
            profile = parse<AdoptedWorldProfile>(
              adoptedWorldProfileSchema,
              rows[0].profile,
            );
          const actionId = uuidv5("world-action", input.operationId);
          const base: WorldActionResult = {
            ...input,
            actionId,
            actionRef: `world-action:${actionId}`,
            status: "rejected",
            realizedThrough: world,
            interval: {
              timeDomainRef: world.timeDomainRef,
              start: world.at,
              end: world.at,
            },
            fromPlaceRef: living.currentPlaceRef,
            toPlaceRef: living.currentPlaceRef,
            scheduleId: null,
            eventRefs: [],
            reason: "",
            nextOpportunity: null,
            recordedAt: options.now(),
          };
          const pending = await executeRepositorySql<{
            action_id: string;
            document: unknown;
          }>(
            tx,
            "SELECT action_id,document FROM heptalogos.world_action WHERE subject_id=$1 AND world_id=$2 AND state='pending' LIMIT 1",
            [input.subjectId, input.worldId],
          );
          if (
            pending[0] &&
            parse<WorldActionResult>(worldActionResultSchema, pending[0].document)
              .action.kind === "move"
          )
            return {
              ...base,
              status: "unavailable",
              reason:
                "The Subject is in transit; view actions remain available until the adopted route ends",
            };
          const currentPlan = [
            ...state.schedule,
            ...expandWorldRoutines(state.definition, {
              timeDomainRef: world.timeDomainRef,
              start: world.at,
              end: Temporal.Instant.from(world.at).add({ minutes: 1 }).toString(),
            }).map((item) => item.schedule),
          ].find(
            (plan) =>
              plan.status === "planned" &&
              plan.actorRefs.includes(profile.subjectActorRef) &&
              Date.parse(plan.interval.start) <= Date.parse(world.at) &&
              Date.parse(plan.interval.end) > Date.parse(world.at),
          );
          if (
            currentPlan &&
            !(
              input.action.kind === "participate" &&
              input.action.scheduleId === currentPlan.scheduleId
            )
          ) {
            const policy = worldScheduleAttendancePolicy(state.definition, currentPlan);
            const earliest =
              policy.mode === "strict"
                ? Date.parse(currentPlan.interval.end)
                : Date.parse(currentPlan.interval.start) +
                  policy.minimumContinuationMinutes * 60000;
            const exceptions = input.interruptingEventId
              ? await executeRepositorySql<{
                  document: Static<typeof realizeWorldSchema>["events"][number];
                }>(
                  tx,
                  "SELECT document FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2 AND event_id=$3",
                  [input.subjectId, input.worldId, input.interruptingEventId],
                )
              : [];
            const exception = exceptions[0]?.document;
            const permitted =
              exception?.interruptionKind &&
              policy.interruptEvents.includes(exception.interruptionKind) &&
              exception.perceptions.some(
                (perception) => perception.actorRef === profile.subjectActorRef,
              ) &&
              Date.parse(exception.interval.start) <= Date.parse(world.at) &&
              Date.parse(exception.interval.end) >= Date.parse(world.at);
            if (Date.parse(world.at) < earliest && !permitted)
              return {
                ...base,
                status: "unavailable",
                reason:
                  "The adopted activity continues until its permitted interruption point",
                nextOpportunity: {
                  timeDomainRef: world.timeDomainRef,
                  at: new Date(earliest).toISOString(),
                },
              };
          }
          let end = Temporal.Instant.from(world.at),
            toPlace = base.fromPlaceRef,
            scheduleId: string | null = null;
          if (input.action.kind === "move") {
            const targetPlace = input.action.placeRef;
            if (
              !state.definition.places.some((place) => place.placeRef === targetPlace)
            )
              return {
                ...base,
                reason: "The target place is not in the adopted world",
              };
            toPlace = input.action.placeRef;
            if (toPlace !== base.fromPlaceRef) {
              const edge = profile.profile.travelEdges.find(
                (edge) => edge.from === base.fromPlaceRef && edge.to === toPlace,
              );
              if (!edge)
                return {
                  ...base,
                  status: "unavailable",
                  reason: "No adopted route defines travel to this place",
                };
              end = end.add({ minutes: edge.durationMinutes });
            }
          } else if (input.action.kind === "rest") {
            const nextClass = expandWorldRoutines(state.definition, {
              timeDomainRef: world.timeDomainRef,
              start: world.at,
              end: end.add({ hours: 24 }).toString(),
            })
              .filter(
                (item) =>
                  item.schedule.status === "planned" &&
                  item.schedule.actorRefs.includes(profile.subjectActorRef) &&
                  Date.parse(item.schedule.interval.start) > Date.parse(world.at),
              )
              .map((item) => Date.parse(item.schedule.interval.start))
              .sort((a, b) => a - b)[0];
            end = end.add({ minutes: profile.profile.actionPolicy?.restMinutes ?? 15 });
            if (nextClass && nextClass < Number(end.epochMilliseconds))
              end = Temporal.Instant.fromEpochMilliseconds(nextClass);
          } else {
            const targetId = input.action.scheduleId;
            const candidates = [
              ...state.schedule,
              ...expandWorldRoutines(state.definition, {
                timeDomainRef: world.timeDomainRef,
                start: new Date(Date.parse(world.at) - 7 * 86400000).toISOString(),
                end: end
                  .add({ hours: profile.profile.planning.horizonHours })
                  .toString(),
              })
                .filter((item) => item.rule.visibility !== "world_author")
                .map((item) => item.schedule),
            ];
            const target = candidates.find(
              (plan) =>
                plan.scheduleId === targetId &&
                plan.status === "planned" &&
                plan.actorRefs.includes(profile.subjectActorRef),
            );
            if (!target || Date.parse(target.interval.end) <= Date.parse(world.at))
              return {
                ...base,
                reason:
                  "The known schedule instance is missing, cancelled or already over",
              };
            if (target.placeRef !== base.fromPlaceRef)
              return {
                ...base,
                reason:
                  "Participate only from the actual adopted place; move there first",
              };
            const policy = worldScheduleAttendancePolicy(state.definition, target);
            const delayMinutes =
              (Date.parse(world.at) - Date.parse(target.interval.start)) / 60000;
            if (delayMinutes < -policy.earlyMinutes)
              return {
                ...base,
                status: "unavailable",
                reason: "This activity is outside its adopted early-start allowance",
                nextOpportunity: {
                  timeDomainRef: world.timeDomainRef,
                  at: target.interval.start,
                },
              };
            if (policy.mode === "strict" && delayMinutes > policy.startToleranceMinutes)
              return {
                ...base,
                status: "unavailable",
                reason:
                  "Strict attendance cannot adopt a late start; use an explicit exception",
              };
            if (delayMinutes > policy.startToleranceMinutes)
              base.reason =
                "Participation began beyond the adopted start tolerance; the elapsed absence remains recorded";
            base.interval = {
              ...base.interval,
              start: new Date(
                Math.max(Date.parse(world.at), Date.parse(target.interval.start)),
              ).toISOString(),
            };
            base.realizedThrough = { ...world, at: base.interval.start };
            end = Temporal.Instant.from(target.interval.end);
            scheduleId = target.scheduleId;
          }
          const finish = end.toString({ fractionalSecondDigits: 3 });
          const result: WorldActionResult = {
            ...base,
            status:
              Temporal.Instant.compare(end, Temporal.Instant.from(world.at)) === 0
                ? "completed"
                : "pending",
            toPlaceRef: toPlace,
            scheduleId,
            interval: { ...base.interval, end: finish },
            nextOpportunity:
              Temporal.Instant.compare(end, Temporal.Instant.from(world.at)) === 0
                ? null
                : { timeDomainRef: world.timeDomainRef, at: finish },
          };
          if (pending[0]) {
            const prior = parse<WorldActionResult>(
              worldActionResultSchema,
              pending[0].document,
            );
            const cancelled: WorldActionResult = {
              ...prior,
              status: "cancelled",
              nextOpportunity: null,
              reason: `Replaced at the actual current point by ${result.actionRef}`,
            };
            await executeRepositorySql(
              tx,
              "UPDATE heptalogos.world_action SET state='cancelled',document=$3::jsonb WHERE subject_id=$1 AND action_id=$2",
              [input.subjectId, prior.actionId, JSON.stringify(cancelled)],
            );
          }
          await executeRepositorySql(
            tx,
            "INSERT INTO heptalogos.world_action(subject_id,world_id,action_id,operation_id,request_digest,state,ends_at,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
            [
              input.subjectId,
              input.worldId,
              actionId,
              input.operationId,
              digest,
              result.status,
              finish,
              JSON.stringify(result),
            ],
          );
          await executeRepositorySql(
            tx,
            "UPDATE heptalogos.world_living SET document=jsonb_set(document,'{currentActivityRefs}',$3::jsonb) WHERE subject_id=$1 AND world_id=$2",
            [
              input.subjectId,
              input.worldId,
              JSON.stringify(result.status === "pending" ? [result.actionRef] : []),
            ],
          );
          return result;
        }),
      );
    },
    async completeActions(
      input: {
        subjectId: string;
        worldId: string;
        limit?: number;
      },
      capturedWorld?: LifeActivity["world"],
    ): Promise<WorldActionResult[]> {
      const world = capturedWorld ?? (await options.worldNow(input.subjectId)),
        pending = await readPending(input.subjectId, input.worldId, input.limit);
      const due = pending.filter(
        (action) =>
          action.interval.timeDomainRef === world.timeDomainRef &&
          Date.parse(action.realizedThrough.at) < Date.parse(world.at),
      );
      const result: WorldActionResult[] = [];
      for (const candidate of due)
        result.push(
          await options.persistence.mutate((context) =>
            useRepositoryMutationTransaction(context, async (tx) => {
              const state = await currentIn(
                tx,
                input.subjectId,
                input.worldId,
                world.timeDomainRef,
                "The action belongs to another world clock domain",
              );
              const rows = await executeRepositorySql<{
                document: unknown;
                state: string;
              }>(
                tx,
                "SELECT document,state FROM heptalogos.world_action WHERE subject_id=$1 AND action_id=$2 FOR UPDATE",
                [input.subjectId, candidate.actionId],
              );
              if (!rows[0]) invalid("The adopted world action is missing");
              const action = parse<WorldActionResult>(
                worldActionResultSchema,
                rows[0].document,
              );
              if (rows[0].state !== "pending") return action;
              const profiles = await executeRepositorySql<{ document: unknown }>(
                tx,
                "SELECT document FROM heptalogos.world_profile WHERE subject_id=$1 AND world_id=$2",
                [input.subjectId, input.worldId],
              );
              if (!profiles[0]) invalid("The adopted action profile is missing");
              const profile = parse<AdoptedWorldProfile>(
                adoptedWorldProfileSchema,
                profiles[0].document,
              );
              if (Date.parse(action.realizedThrough.at) >= Date.parse(world.at))
                return action;
              const segment = {
                ...action.interval,
                start: action.realizedThrough.at,
                end: new Date(
                  Math.min(Date.parse(action.interval.end), Date.parse(world.at)),
                ).toISOString(),
              };
              const finished =
                Date.parse(segment.end) >= Date.parse(action.interval.end);
              const eventId = uuidv5(
                  `event:${segment.start}:${segment.end}`,
                  action.actionId,
                ),
                kind = action.action.kind;
              const plan =
                kind === "participate"
                  ? [
                      ...state.schedule,
                      ...expandWorldRoutines(state.definition, action.interval).map(
                        (item) => item.schedule,
                      ),
                    ].find(
                      (plan) =>
                        plan.scheduleId === action.scheduleId &&
                        plan.status === "planned",
                    )
                  : undefined;
              if (kind === "participate" && !plan) {
                const cancelled: WorldActionResult = {
                  ...action,
                  status: "cancelled",
                  reason: "The adopted schedule was cancelled before completion",
                  nextOpportunity: null,
                };
                await executeRepositorySql(
                  tx,
                  "UPDATE heptalogos.world_action SET state='cancelled',document=$3::jsonb WHERE subject_id=$1 AND action_id=$2",
                  [input.subjectId, action.actionId, JSON.stringify(cancelled)],
                );
                await executeRepositorySql(
                  tx,
                  "UPDATE heptalogos.world_living SET document=jsonb_set(document,'{currentActivityRefs}',COALESCE((SELECT jsonb_agg(ref) FROM jsonb_array_elements(document->'currentActivityRefs') ref WHERE ref <> to_jsonb($3::text)),'[]'::jsonb)) WHERE subject_id=$1 AND world_id=$2",
                  [input.subjectId, input.worldId, action.actionRef],
                );
                return cancelled;
              }
              const rule = plan?.ruleRef
                ? state.definition.routineRules?.find(
                    (rule) =>
                      rule.ruleId === plan.ruleRef!.ruleId &&
                      rule.revision === plan.ruleRef!.revision,
                  )
                : undefined;
              const title =
                kind === "move"
                  ? finished
                    ? `Moved to ${action.toPlaceRef}`
                    : `Moving toward ${action.toPlaceRef}`
                  : kind === "rest"
                    ? "Rested"
                    : `Participated in ${plan!.title}`;
              await options.realizeIn(
                tx,
                {
                  operationId: uuidv5(
                    `realize:${segment.start}:${segment.end}`,
                    action.actionId,
                  ),
                  subjectId: input.subjectId,
                  worldId: input.worldId,
                  expectedRevision: state.revision,
                  interval: segment,
                  events: [
                    {
                      eventId,
                      interval: segment,
                      title,
                      content: title,
                      actorRefs: [profile.subjectActorRef],
                      placeRef:
                        kind === "move" && !finished
                          ? action.fromPlaceRef
                          : action.toPlaceRef,
                      scheduleId: action.scheduleId,
                      ...(plan
                        ? {
                            scheduleOutcome:
                              Date.parse(action.interval.start) >
                              Date.parse(plan.interval.start)
                                ? ("partial" as const)
                                : ("completed" as const),
                          }
                        : {}),
                      parentEventId: null,
                      causalEventRefs: action.interruptingEventId
                        ? [action.interruptingEventId]
                        : [],
                      overlap: "exclusive",
                      source: {
                        kind: "rule",
                        producerRef: action.actionRef,
                        sourceRefs: [action.actionRef],
                      },
                      perceptions: [
                        {
                          actorRef: profile.subjectActorRef,
                          kind: "seen",
                          at: {
                            timeDomainRef: world.timeDomainRef,
                            at: segment.end,
                          },
                          content: title,
                        },
                      ],
                      energy: {
                        kind:
                          kind === "rest"
                            ? "rest"
                            : kind === "participate"
                              ? (rule?.kind ?? "ordinary")
                              : "ordinary",
                        participation: "primary",
                        delta: 0,
                        reason: "",
                      },
                    },
                  ],
                  coverage: "limited",
                },
                world,
              );
              const completed: WorldActionResult = {
                ...action,
                status: finished ? "completed" : "pending",
                realizedThrough: {
                  timeDomainRef: world.timeDomainRef,
                  at: segment.end,
                },
                eventRefs: [
                  ...action.eventRefs,
                  `world-event:${input.worldId}:${eventId}:1`,
                ],
                nextOpportunity: finished ? null : action.nextOpportunity,
              };
              await executeRepositorySql(
                tx,
                "UPDATE heptalogos.world_action SET state=$4,document=$3::jsonb WHERE subject_id=$1 AND action_id=$2",
                [
                  input.subjectId,
                  action.actionId,
                  JSON.stringify(completed),
                  completed.status,
                ],
              );
              await executeRepositorySql(
                tx,
                "UPDATE heptalogos.world_living SET document=jsonb_set(document,'{currentActivityRefs}',$3::jsonb) WHERE subject_id=$1 AND world_id=$2",
                [
                  input.subjectId,
                  input.worldId,
                  JSON.stringify(finished ? [] : [action.actionRef]),
                ],
              );
              return completed;
            }),
          ),
        );
      return result;
    },
  };
  return service;
}
