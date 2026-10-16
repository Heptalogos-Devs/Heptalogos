// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns adopted activities, continuation state and low-cost attention decisions.
 * @module life
 */
import {
  createUuidV7Id,
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { createSubjectSchemaReader } from "./checked-schema.js";
import { readSubjectRows } from "./subject-read.js";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import {
  executeRepositorySql,
  readRepositorySql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import {
  activitySchema,
  proposeActivitySchema,
  adoptActivitySchema,
  transitionActivitySchema,
  progressActivitySchema,
  scheduleQuerySchema,
  takeAttentionSchema,
  type LifeActivity,
  type LifeOptions,
  type ActivityScope,
  type ActivityOpportunity,
} from "./contracts.js";
import { subjectLineage } from "./subject-lineage.js";
import { subjectProblem } from "./problems.js";

const checked = createSubjectSchemaReader(() => {
  throw subjectProblem(
    "life.invalid_input",
    "Invalid Activity request",
    "Inspect the Activity schema",
    "validation",
  );
});
function conflict(detail: string): never {
  throw subjectProblem("life.conflict", "Activity changed", detail);
}
function readDocument(row: { document: unknown }): LifeActivity {
  return checked<LifeActivity>(activitySchema, row.document);
}
const terminal = new Set(["completed", "cancelled", "failed"]);

/** Checks an adopted request against current installation and parent-Activity authority. */
export function assertScopeWithin(
  request: ActivityScope,
  authority: ActivityScope,
): void {
  if (
    request.maxRunMs > authority.maxRunMs ||
    request.tools.some((tool) => !authority.tools.includes(tool)) ||
    request.sourceRefs.some((source) => !authority.sourceRefs.includes(source)) ||
    request.conversations.some((scope) =>
      scope.operations.some(
        (operation) =>
          !authority.conversations.some(
            (grant) =>
              grant.conversationRef === scope.conversationRef &&
              grant.operations.includes(operation),
          ),
      ),
    )
  )
    throw subjectProblem(
      "life.scope_denied",
      "Activity scope is not authorized",
      "The request exceeds the current actor, source, tool or conversation grants",
    );
}

function assertWindow(
  activity: LifeActivity,
  world: { timeDomainRef: string; at: string },
) {
  if (activity.world.timeDomainRef !== world.timeDomainRef)
    throw subjectProblem(
      "life.time_domain_unavailable",
      "Activity world cannot be compared",
      "The Activity belongs to a different declared world",
    );
  for (const point of [activity.window.notBefore, activity.window.notAfter])
    if (point && point.timeDomainRef !== world.timeDomainRef)
      throw subjectProblem(
        "life.time_domain_unavailable",
        "Activity window cannot be compared",
        "Reconsider the Activity in the current declared world",
      );
  const now = Date.parse(world.at);
  if (
    !Number.isFinite(now) ||
    (activity.window.notBefore && Date.parse(activity.window.notBefore.at) > now) ||
    (activity.window.notAfter && Date.parse(activity.window.notAfter.at) <= now)
  )
    conflict("The Activity is outside its adopted time window");
}

/** A scheduled work opportunity is comparable only in its actual world domain. */
export function captureActivityOpportunity(
  activity: LifeActivity,
  world: ActivityOpportunity["world"],
): ActivityOpportunity | undefined {
  const point = activity.nextOpportunity;
  if (
    activity.state !== "active" ||
    activity.mode !== "work" ||
    activity.continuationRequired ||
    !activity.adoptedBy ||
    !activity.scope ||
    !activity.workContextId ||
    !point ||
    !Number.isFinite(Date.parse(point.at)) ||
    !Number.isFinite(Date.parse(world.at)) ||
    point.timeDomainRef !== world.timeDomainRef ||
    activity.world.timeDomainRef !== world.timeDomainRef ||
    Date.parse(point.at) > Date.parse(world.at)
  )
    return undefined;
  for (const bound of [activity.window.notBefore, activity.window.notAfter])
    if (bound && bound.timeDomainRef !== world.timeDomainRef) return undefined;
  if (
    (activity.window.notBefore &&
      Date.parse(activity.window.notBefore.at) > Date.parse(world.at)) ||
    (activity.window.notAfter &&
      Date.parse(activity.window.notAfter.at) <= Date.parse(world.at))
  )
    return undefined;
  assertWindow(activity, world);
  return { expectedRevision: activity.revision, scheduledAt: point, world };
}

/** The due point and its durable native input commit together under the same Host fence. */
export async function consumeActivityOpportunity(
  transaction: PersistenceInternalTransaction,
  activity: LifeActivity,
  opportunity: ActivityOpportunity,
  recordedAt: string,
): Promise<void> {
  const actual = captureActivityOpportunity(activity, opportunity.world);
  if (
    !actual ||
    actual.expectedRevision !== opportunity.expectedRevision ||
    actual.scheduledAt.timeDomainRef !== opportunity.scheduledAt.timeDomainRef ||
    actual.scheduledAt.at !== opportunity.scheduledAt.at
  )
    conflict("The scheduled Activity opportunity has changed");
  const next = {
    ...activity,
    revision: activity.revision + 1,
    nextOpportunity: null,
    updatedAt: recordedAt,
  };
  await executeRepositorySql(
    transaction,
    "UPDATE heptalogos.life_activity SET revision=$3,updated_at=$4,document=$5::jsonb WHERE subject_id=$1 AND activity_id=$2",
    [
      activity.subjectId,
      activity.activityId,
      next.revision,
      recordedAt,
      JSON.stringify(next),
    ],
  );
}

/** Creates Life operations; the caller supplies its current real execution Activity to Persistence. */
export function createLifeService(options: LifeOptions) {
  const mutateIn = async (
    transaction: PersistenceInternalTransaction,
    input: { subjectId: string; activityId: string; expectedRevision: number },
    change: (value: LifeActivity) => LifeActivity,
  ) => {
    const rows = await executeRepositorySql<{
      document: unknown;
      revision: string;
    }>(
      transaction,
      'SELECT document, revision FROM "heptalogos"."life_activity" WHERE subject_id=$1 AND activity_id=$2 FOR UPDATE',
      [input.subjectId, input.activityId],
    );
    if (!rows[0])
      throw subjectProblem(
        "life.not_found",
        "Activity not found",
        "The Activity does not belong to this Subject",
      );
    const current = readDocument(rows[0]);
    if (Number(rows[0].revision) !== input.expectedRevision)
      conflict("Read the current Activity revision before changing it");
    const next = checked<LifeActivity>(activitySchema, {
      ...change(current),
      revision: current.revision + 1,
      updatedAt: options.now(),
    });
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."life_activity" SET document=$1::jsonb,revision=$2,updated_at=$3 WHERE activity_id=$4',
      [JSON.stringify(next), next.revision, next.updatedAt, input.activityId],
    );
    return next;
  };
  const mutate = <
    T extends { subjectId: string; activityId: string; expectedRevision: number },
  >(
    input: T,
    change: (value: LifeActivity) => LifeActivity,
  ) =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, (tx) => mutateIn(tx, input, change)),
    );
  const progressIn = async (
    transaction: PersistenceInternalTransaction,
    value: Static<typeof progressActivitySchema>,
    world: LifeActivity["world"],
  ) => {
    const input = checked<Static<typeof progressActivitySchema>>(
      progressActivitySchema,
      value,
    );
    return mutateIn(transaction, input, (current) => {
      if (!["active", "paused"].includes(current.state))
        conflict("Only current work can record progress");
      if (
        world.timeDomainRef !== current.world.timeDomainRef ||
        !Number.isFinite(Date.parse(world.at)) ||
        (input.nextOpportunity &&
          (input.nextOpportunity.timeDomainRef !== current.world.timeDomainRef ||
            !Number.isFinite(Date.parse(input.nextOpportunity.at))))
      )
        throw subjectProblem(
          "life.time_domain_unavailable",
          "Progress must use the actual Activity world",
          "Use the current comparable world point",
        );
      return {
        ...current,
        progress: input.progress,
        nextOpportunity: input.nextOpportunity,
        ...(input.mode ? { mode: input.mode } : {}),
      };
    });
  };
  return {
    /** Host-native progress shares this owner and the caller's existing fenced transaction. */
    progressIn,
    /** Quiet mode ends only at its actual comparable due point, under Activity CAS. */
    async resumeDue(
      input: { subjectId: string; activityId: string; expectedRevision: number },
      world: LifeActivity["world"],
    ) {
      return mutate(input, (current) => {
        assertWindow(current, world);
        if (
          current.state !== "active" ||
          current.continuationRequired ||
          !current.adoptedBy ||
          !current.scope ||
          current.mode === "work" ||
          !current.nextOpportunity ||
          current.nextOpportunity.timeDomainRef !== world.timeDomainRef ||
          Date.parse(current.nextOpportunity.at) > Date.parse(world.at)
        )
          conflict("The quiet Activity has no current due opportunity in this world");
        return { ...current, mode: "work" };
      });
    },
    /** Actual world time is read before entering any Host mutation. */
    worldNow: options.worldNow,
    /** Reads the actual current proposal/adoption by its stable creation identity before reconstructing a retry. */
    async readOperation(
      subjectId: string,
      operationId: string,
      transaction?: PersistenceInternalTransaction,
    ): Promise<LifeActivity | undefined> {
      const statement =
        "SELECT document FROM heptalogos.life_activity WHERE subject_id=$1 AND operation_id=$2";
      const rows = await readSubjectRows<{ document: unknown }>(
        options.persistence,
        statement,
        [subjectId, operationId],
        transaction,
      );
      return rows[0] ? readDocument(rows[0]) : undefined;
    },
    async propose(value: Static<typeof proposeActivitySchema>): Promise<LifeActivity> {
      const input = checked<Static<typeof proposeActivitySchema>>(
        proposeActivitySchema,
        value,
      );
      const digest = digestCanonicalJson(
        "life.propose.v1",
        input as unknown as CanonicalJsonValue,
      ).hex;
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (transaction) => {
          const at = options.now();
          const document: LifeActivity = {
            activityId: createUuidV7Id("LifeActivityId"),
            subjectId: input.subjectId,
            revision: 1,
            purpose: input.purpose,
            mode: input.mode,
            window: input.window,
            sourceRefs: input.sourceRefs,
            workContextId: input.workContextId,
            state: "planned",
            proposedBy: input.proposedBy,
            adoptedBy: null,
            adoptedAt: null,
            lastTransitionReason: "Proposed",
            scope: null,
            world: input.world,
            nextOpportunity: input.nextOpportunity,
            progress: { note: "", sourceRefs: [], artifactRefs: [], resultRefs: [] },
            interruptOn: input.interruptOn,
            continuationRequired: false,
            createdAt: at,
            updatedAt: at,
          };
          await executeRepositorySql(
            transaction,
            'INSERT INTO "heptalogos"."life_activity" (activity_id,subject_id,operation_id,request_digest,revision,document,created_at,updated_at,lineage_context_ref) VALUES ($1,$2,$3,$4,1,$5::jsonb,$6,$6,$7::jsonb) ON CONFLICT(subject_id,operation_id) DO NOTHING',
            [
              document.activityId,
              input.subjectId,
              input.operationId,
              digest,
              JSON.stringify(document),
              at,
              JSON.stringify(subjectLineage(context.execution)),
            ],
          );
          const rows = await executeRepositorySql<{
            document: unknown;
            request_digest: string;
          }>(
            transaction,
            'SELECT document,request_digest FROM "heptalogos"."life_activity" WHERE subject_id=$1 AND operation_id=$2',
            [input.subjectId, input.operationId],
          );
          if (!rows[0] || rows[0].request_digest !== digest)
            conflict("The operation identity is already bound to another proposal");
          return readDocument(rows[0]);
        }),
      );
    },
    async adopt(value: Static<typeof adoptActivitySchema>) {
      const input = checked<Static<typeof adoptActivitySchema>>(
        adoptActivitySchema,
        value,
      );
      const authority = await options.scopeAuthority(
        input.subjectId,
        input.adoptedBy,
        input.scope,
      );
      assertScopeWithin(input.scope, authority);
      return mutate(input, (current) => {
        if (current.state !== "planned" || current.adoptedBy)
          conflict("Only an unadopted planned Activity can be adopted");
        return {
          ...current,
          adoptedBy: input.adoptedBy,
          adoptedAt: options.now(),
          scope: input.scope,
        };
      });
    },
    async transition(value: Static<typeof transitionActivitySchema>) {
      const input = checked<Static<typeof transitionActivitySchema>>(
        transitionActivitySchema,
        value,
      );
      const world = ["start", "resume"].includes(input.action)
        ? await options.worldNow(input.subjectId)
        : undefined;
      return mutate(input, (current) => {
        if (world) assertWindow(current, world);
        if (terminal.has(current.state)) conflict("A terminal Activity cannot restart");
        if (!current.adoptedBy && !["cancel", "fail"].includes(input.action))
          conflict("The Subject must adopt this proposal first");
        const allowed = {
          start: ["planned"],
          pause: ["active"],
          resume: ["paused", "active"],
          finish: ["active", "paused"],
          cancel: ["planned", "active", "paused"],
          fail: ["planned", "active", "paused"],
        };
        if (
          input.action === "resume" &&
          current.state === "active" &&
          !current.continuationRequired
        )
          conflict("Activity is already active");
        if (!allowed[input.action].includes(current.state))
          conflict("The lifecycle action is not applicable to the current state");
        const state = {
          start: "active",
          pause: "paused",
          resume: "active",
          finish: "completed",
          cancel: "cancelled",
          fail: "failed",
        }[input.action] as LifeActivity["state"];
        return {
          ...current,
          state,
          continuationRequired: false,
          lastTransitionReason: input.reason,
          ...(terminal.has(state) ? { nextOpportunity: null } : {}),
        };
      });
    },
    async progress(value: Static<typeof progressActivitySchema>) {
      const input = checked<Static<typeof progressActivitySchema>>(
        progressActivitySchema,
        value,
      );
      const world = await options.worldNow(input.subjectId);
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, (tx) => progressIn(tx, input, world)),
      );
    },
    async get(
      subjectId: string,
      activityId: string,
      transaction?: PersistenceInternalTransaction,
    ) {
      const statement =
        'SELECT document FROM "heptalogos"."life_activity" WHERE subject_id=$1 AND activity_id=$2';
      const parameters = [subjectId, activityId];
      const rows = await readSubjectRows<{ document: unknown }>(
        options.persistence,
        statement,
        parameters,
        transaction,
      );
      return rows[0] ? readDocument(rows[0]) : undefined;
    },
    async schedule(value: Static<typeof scheduleQuerySchema>) {
      const input = checked<Static<typeof scheduleQuerySchema>>(
        scheduleQuerySchema,
        value,
      );
      const rows = await readRepositorySql<{ document: unknown }>(
        options.persistence,
        'SELECT document FROM "heptalogos"."life_activity" WHERE subject_id=$1 AND ($2::uuid IS NULL OR activity_id>$2) AND (cardinality($3::text[])=0 OR document->>\'state\'=ANY($3::text[])) ORDER BY activity_id LIMIT $4',
        [input.subjectId, input.afterId ?? null, input.states, input.limit + 1],
      );
      return {
        activities: rows.slice(0, input.limit).map(readDocument),
        nextId:
          rows.length > input.limit
            ? readDocument(rows[input.limit - 1]!).activityId
            : null,
      };
    },
    async recover(subjectId: string) {
      // Recovery marks continuation and unknown in-flight effects; it never replays a native action.
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (transaction) => {
          const at = options.now();
          const rows = await executeRepositorySql<{ changed: number }>(
            transaction,
            `WITH recovered AS (
           UPDATE heptalogos.life_activity SET revision=revision+1,updated_at=$2::text::timestamptz,
            document=document||jsonb_build_object('revision',revision+1,'updatedAt',$2::text,'continuationRequired',true)
           WHERE subject_id=$1 AND document->>'state'='active' AND document->>'continuationRequired'='false'
           RETURNING activity_id)
           SELECT count(*)::integer AS changed FROM recovered`,
            [subjectId, at],
          );
          await executeRepositorySql(
            transaction,
            "UPDATE heptalogos.life_native_run SET state='uncertain',updated_at=$2 WHERE subject_id=$1 AND state IN ('admitted','running')",
            [subjectId, at],
          );
          await executeRepositorySql(
            transaction,
            `UPDATE heptalogos.agency_delivery_part p SET state='uncertain',updated_at=$2,
           document=p.document||jsonb_build_object('state','uncertain')
           FROM heptalogos.agency_behavior b WHERE p.behavior_id=b.behavior_id AND b.subject_id=$1 AND p.state='dispatching'`,
            [subjectId, at],
          );
          return { changed: rows[0]?.changed ?? 0 };
        }),
      );
    },
    async takeAttention(value: Static<typeof takeAttentionSchema>) {
      const input = checked<Static<typeof takeAttentionSchema>>(
        takeAttentionSchema,
        value,
      );
      const activity = input.activityId
        ? await this.get(input.subjectId, input.activityId)
        : undefined;
      if (input.resting || (activity?.state === "active" && activity.mode === "rest"))
        return {
          decision: "rest" as const,
          messageRefs: [],
          reason: "Resting; raw pending content has not been read",
        };
      const now = Date.parse(options.now());
      const permitted = input.candidates; // Already filtered by the trusted Messaging audience.
      const ranked = permitted
        .map((candidate) => ({
          candidate,
          expired: now - Date.parse(candidate.receivedAt) >= input.maxWaitMs,
          urgent:
            (candidate.direct &&
              (!activity || activity.interruptOn.includes("direct"))) ||
            (candidate.mention &&
              (!activity || activity.interruptOn.includes("mention"))) ||
            (candidate.reply && (!activity || activity.interruptOn.includes("reply"))),
        }))
        .filter((item) => input.naturalOpportunity || item.expired || item.urgent)
        .sort(
          (a, b) =>
            Number(b.expired) - Number(a.expired) ||
            Number(b.urgent) - Number(a.urgent) ||
            a.candidate.receivedAt.localeCompare(b.candidate.receivedAt) ||
            a.candidate.messageRef.localeCompare(b.candidate.messageRef),
        );
      const selected = ranked
        .slice(0, input.maxItems)
        .map((item) => item.candidate.messageRef);
      return {
        decision: selected.length
          ? ("read" as const)
          : activity
            ? ("continue" as const)
            : ("defer" as const),
        messageRefs: selected,
        reason: selected.length
          ? "Current bounded attention opportunity"
          : "Continue current work; messages remain persisted pending",
      };
    },
  };
}
