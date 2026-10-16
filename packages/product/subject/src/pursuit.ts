// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Owns explicit behavior-side adoption and exact evaluation links without a cognitive or execution loop.
 * @module pursuit
 */
import {
  createUuidV7Id,
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import {
  executeRepositorySql as sql,
  readRepositorySql,
  type PersistenceInternalTransaction,
  useRepositoryMutationTransaction,
} from "@heptalogos/persistence/repository";
import {
  listPursuitsSchema,
  pursuitHistorySchema,
  adoptPursuitSchema,
  transitionPursuitSchema,
  reconsiderPursuitSchema,
  evaluatePursuitSchema,
  pursuitSchema,
  pursuitEvaluationSchema,
  type Pursuit,
  type PursuitEvaluation,
  type PursuitServiceOptions,
} from "./pursuit-contracts.js";
import { subjectLineage } from "./subject-lineage.js";
import { subjectProblem } from "./problems.js";
function fail(detail: string): never {
  throw subjectProblem(
    "life.pursuit_conflict",
    "Pursuit needs explicit review",
    detail,
  );
}
function checked<T>(schema: Parameters<typeof compileSchema<T>>[0], value: unknown): T {
  const result = compileSchema<T>(schema).validate(value);
  if (!result.ok) fail("Inspect the official Pursuit input schema");
  return result.value;
}
const digest = (value: unknown) =>
  digestCanonicalJson("pursuit.operation.v1", value as CanonicalJsonValue).hex;
/** Mutations are called by the Host's existing runActivity; all network reads occur before short fenced writes. */
export function createPursuitService(options: PursuitServiceOptions) {
  const get = async (
    subjectId: string,
    pursuitId: string,
  ): Promise<Pursuit | undefined> => {
    const rows = await readRepositorySql<{ document: unknown }>(
      options.persistence,
      "SELECT document FROM heptalogos.pursuit WHERE subject_id=$1 AND pursuit_id=$2",
      [subjectId, pursuitId],
    );
    return rows[0] ? checked<Pursuit>(pursuitSchema, rows[0].document) : undefined;
  };
  const required = async (subjectId: string, pursuitId: string) =>
    (await get(subjectId, pursuitId)) ??
    fail("The Pursuit does not belong to this Subject");
  const save = async (before: Pursuit, change: Partial<Pursuit>) =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (tx) => {
        const next = checked<Pursuit>(pursuitSchema, {
          ...before,
          ...change,
          revision: before.revision + 1,
          updatedAt: options.now(),
        });
        const rows = await sql<{ document: unknown }>(
          tx,
          "UPDATE heptalogos.pursuit SET revision=$3,document=$4::jsonb,updated_at=$5 WHERE subject_id=$1 AND pursuit_id=$2 AND revision=$6 RETURNING document",
          [
            before.subjectId,
            before.pursuitId,
            next.revision,
            JSON.stringify(next),
            next.updatedAt,
            before.revision,
          ],
        );
        if (!rows.length) fail("Read the current Pursuit revision before changing it");
        await sql(
          tx,
          "INSERT INTO heptalogos.pursuit_history(pursuit_id,revision,document,recorded_at) VALUES($1,$2,$3::jsonb,$4)",
          [next.pursuitId, next.revision, JSON.stringify(next), next.updatedAt],
        );
        return next;
      }),
    );
  const activityFor = async (value: Pursuit) => {
    const activity = await options.life.get(value.subjectId, value.activityId);
    if (
      !activity?.adoptedBy ||
      !activity.scope ||
      activity.workContextId !== value.workContextId
    )
      fail("The original adopted Activity/WorkContext is unavailable");
    await options.authorize(activity, value.adoptedBy);
    return activity;
  };
  const suspend = async (value: Pursuit) => {
    const activity = await options.life.get(value.subjectId, value.activityId);
    if (activity?.state === "active")
      await options.life.transition({
        subjectId: value.subjectId,
        activityId: value.activityId,
        expectedRevision: activity.revision,
        action: "pause",
        reason: "Pursuit: " + (value.reviewReason || value.reason),
      });
  };
  const recheck = async (subjectId: string, pursuitId: string): Promise<Pursuit> => {
    const value = await required(subjectId, pursuitId);
    if (value.state === "ended") return value;
    const source = await options.motivation.inspect(value);
    if (
      !source.current ||
      source.timeDomainRef !== value.timeDomainRef ||
      source.desireEpoch !== value.desireEpoch ||
      source.conditionEpoch !== value.conditionEpoch
    ) {
      const next = value.reviewRequired
        ? value
        : await save(value, {
            state: "paused",
            reviewRequired: true,
            reviewReason:
              source.reason || "Condition revision lifecycle or time domain changed",
          });
      await suspend(next);
      return next;
    }
    return value;
  };
  return {
    /** Reads the behavior-side record, including preserved historical evaluation identity. */
    get,
    /** Lists current records through the Pursuit owner, with stable identity pagination. */
    async list(value: Static<typeof listPursuitsSchema>) {
      const input = checked<Static<typeof listPursuitsSchema>>(
        listPursuitsSchema,
        value,
      );
      const rows = await readRepositorySql<{ document: unknown }>(
        options.persistence,
        "SELECT document FROM heptalogos.pursuit WHERE subject_id=$1 AND ($2::uuid IS NULL OR pursuit_id>$2) AND (cardinality($3::text[])=0 OR document->>'state'=ANY($3::text[])) ORDER BY pursuit_id LIMIT $4",
        [input.subjectId, input.afterId ?? null, input.states, input.limit + 1],
      );
      const pursuits = rows
        .slice(0, input.limit)
        .map((row) => checked<Pursuit>(pursuitSchema, row.document));
      return {
        pursuits,
        nextId: rows.length > input.limit ? pursuits.at(-1)!.pursuitId : null,
      };
    },
    /** Reads preserved exact revisions without contacting or re-evaluating cognition. */
    async history(value: Static<typeof pursuitHistorySchema>) {
      const input = checked<Static<typeof pursuitHistorySchema>>(
        pursuitHistorySchema,
        value,
      );
      await required(input.subjectId, input.pursuitId);
      const rows = await readRepositorySql<{ document: unknown }>(
        options.persistence,
        "SELECT document FROM heptalogos.pursuit_history WHERE pursuit_id=$1 AND revision>$2 ORDER BY revision LIMIT $3",
        [input.pursuitId, input.afterRevision ?? 0, input.limit + 1],
      );
      const history = rows
        .slice(0, input.limit)
        .map((row) => checked<Pursuit>(pursuitSchema, row.document));
      return {
        history,
        nextRevision: rows.length > input.limit ? history.at(-1)!.revision : null,
      };
    },
    /** Lists only this Subject's explicitly linked Pursuits; it schedules no work. */
    async forActivity(subjectId: string, activityId: string): Promise<Pursuit[]> {
      const rows = await readRepositorySql<{ document: unknown }>(
        options.persistence,
        "SELECT document FROM heptalogos.pursuit WHERE subject_id=$1 AND activity_id=$2 ORDER BY pursuit_id",
        [subjectId, activityId],
      );
      return rows.map((row) => checked<Pursuit>(pursuitSchema, row.document));
    },
    /** Adopts exact current cognition revisions and an already adopted same-world Activity/open WorkContext. */
    async adopt(value: Static<typeof adoptPursuitSchema>): Promise<Pursuit> {
      const input = checked<Static<typeof adoptPursuitSchema>>(
        adoptPursuitSchema,
        value,
      );
      const requestDigest = digest(input);
      const previous = await readRepositorySql<{
        document: unknown;
        request_digest: string;
      }>(
        options.persistence,
        "SELECT document,request_digest FROM heptalogos.pursuit WHERE subject_id=$1 AND operation_id=$2",
        [input.subjectId, input.operationId],
      );
      if (previous[0]) {
        if (previous[0].request_digest !== requestDigest)
          fail("Adoption identity binds another exact request");
        return checked<Pursuit>(pursuitSchema, previous[0].document);
      }
      const activity = await options.life.get(input.subjectId, input.activityId);
      if (
        !activity?.scope ||
        !activity.adoptedBy ||
        activity.adoptedBy !== input.adoptedBy ||
        !activity.workContextId ||
        !["active", "paused"].includes(activity.state)
      )
        fail("Adopt a real same-Subject Activity with a WorkContext first");
      await options.authorize(activity, input.adoptedBy);
      const source = await options.motivation.inspect(input);
      if (!source.current) fail(source.reason);
      if (source.timeDomainRef !== activity.world.timeDomainRef)
        fail("Condition and Activity time domains have no declared mapping");
      if (
        !(await options.motivation.workContextOpen(
          input.subjectId,
          activity.workContextId,
        ))
      )
        fail("The actual same-Subject WorkContext must be open");
      const at = options.now();
      const document = checked<Pursuit>(pursuitSchema, {
        pursuitId: createUuidV7Id("PursuitId"),
        subjectId: input.subjectId,
        activityId: input.activityId,
        workContextId: activity.workContextId,
        revision: 1,
        desireRevision: input.desireRevision,
        conditionRevision: input.conditionRevision,
        desireEpoch: source.desireEpoch,
        conditionEpoch: source.conditionEpoch,
        adoptedBy: input.adoptedBy,
        reason: input.reason,
        state: "active",
        reviewRequired: false,
        reviewReason: "",
        timeDomainRef: source.timeDomainRef,
        lastEvaluation: null,
        createdAt: at,
        updatedAt: at,
      });
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          const current = await sql<{ document: { revision: number } }>(
            tx,
            "SELECT document FROM heptalogos.life_activity WHERE subject_id=$1 AND activity_id=$2 FOR SHARE",
            [input.subjectId, input.activityId],
          );
          if (current[0]?.document.revision !== activity.revision)
            fail("The Activity changed during explicit adoption");
          await sql(
            tx,
            "INSERT INTO heptalogos.pursuit(pursuit_id,subject_id,activity_id,operation_id,request_digest,revision,document,created_at,updated_at,lineage_context_ref) VALUES($1,$2,$3,$4,$5,1,$6::jsonb,$7,$7,$8::jsonb) ON CONFLICT(subject_id,operation_id) DO NOTHING",
            [
              document.pursuitId,
              input.subjectId,
              input.activityId,
              input.operationId,
              requestDigest,
              JSON.stringify(document),
              at,
              JSON.stringify(subjectLineage(context.execution)),
            ],
          );
          const rows = await sql<{ document: unknown; request_digest: string }>(
            tx,
            "SELECT document,request_digest FROM heptalogos.pursuit WHERE subject_id=$1 AND operation_id=$2",
            [input.subjectId, input.operationId],
          );
          if (rows[0]?.request_digest !== requestDigest)
            fail("Adoption identity binds another exact request");
          const result = checked<Pursuit>(pursuitSchema, rows[0]!.document);
          await sql(
            tx,
            "INSERT INTO heptalogos.pursuit_history(pursuit_id,revision,document,recorded_at) VALUES($1,1,$2::jsonb,$3) ON CONFLICT DO NOTHING",
            [result.pursuitId, JSON.stringify(result), at],
          );
          return result;
        }),
      );
    },
    /** Revalidates current desire/condition heads before continued work; changed sources pause the actual Activity. */
    recheck,
    /** Rechecks local adopted state at the actual fenced send/input point; it performs no cognition/network work. */
    async assertActivityCurrent(
      subjectId: string,
      activityId: string,
      transaction?: PersistenceInternalTransaction,
    ): Promise<void> {
      const query =
        "SELECT document FROM heptalogos.pursuit WHERE subject_id=$1 AND activity_id=$2 ORDER BY pursuit_id" +
        (transaction ? " FOR SHARE" : "");
      const rows = transaction
        ? await sql<{ document: unknown }>(transaction, query, [subjectId, activityId])
        : await readRepositorySql<{ document: unknown }>(options.persistence, query, [
            subjectId,
            activityId,
          ]);
      for (const row of rows) {
        const pursuit = checked<Pursuit>(pursuitSchema, row.document);
        if (
          pursuit.state !== "ended" &&
          (pursuit.state !== "active" || pursuit.reviewRequired)
        )
          fail("An associated Pursuit requires explicit review before continued work");
      }
    },
    /** Guard used by the existing Activity/Agency entry points; no separate opportunity queue exists. */
    async guardActivity(subjectId: string, activityId: string): Promise<void> {
      for (const value of await this.forActivity(subjectId, activityId)) {
        const current = await recheck(subjectId, value.pursuitId);
        if (
          current.state !== "ended" &&
          (current.state !== "active" || current.reviewRequired)
        )
          fail("An associated Pursuit requires explicit review before continued work");
      }
    },
    /** Explicit pause/resume/end is separate from evaluator satisfaction and cannot adopt a changed condition silently. */
    async transition(value: Static<typeof transitionPursuitSchema>): Promise<Pursuit> {
      const input = checked<Static<typeof transitionPursuitSchema>>(
        transitionPursuitSchema,
        value,
      );
      const before = await recheck(input.subjectId, input.pursuitId);
      if (before.revision !== input.expectedRevision)
        fail("Read the current Pursuit before transition");
      if (before.state === "ended") fail("An ended Pursuit cannot restart");
      await activityFor(before);
      if (input.action === "resume" && before.reviewRequired)
        fail(
          "Changed or withdrawn cognition requires a new explicit adoption; the old exact Pursuit cannot resume",
        );
      if (
        input.action === "resume" &&
        !(await options.motivation.workContextOpen(
          before.subjectId,
          before.workContextId,
        ))
      )
        fail("The actual WorkContext is not open");
      const next = await save(before, {
        state:
          input.action === "end"
            ? "ended"
            : input.action === "pause"
              ? "paused"
              : "active",
        reason: input.reason,
      });
      if (input.action !== "resume") await suspend(next);
      return next;
    },
    /** Explicitly adopts changed cognition revisions after review, preserving prior history and requiring normal Life resumption. */
    async reconsider(value: Static<typeof reconsiderPursuitSchema>): Promise<Pursuit> {
      const input = checked<Static<typeof reconsiderPursuitSchema>>(
        reconsiderPursuitSchema,
        value,
      );
      const before = await required(input.subjectId, input.pursuitId);
      if (before.revision !== input.expectedRevision || before.state === "ended")
        fail("Read the current non-ended Pursuit before reconsideration");
      const activity = await activityFor(before);
      const candidate = {
        ...before,
        desireRevision: input.desireRevision,
        conditionRevision: input.conditionRevision,
      };
      const source = await options.motivation.inspect(candidate);
      if (!source.current) fail(source.reason);
      if (source.timeDomainRef !== activity.world.timeDomainRef)
        fail("Condition and Activity time domains have no declared mapping");
      if (
        !(await options.motivation.workContextOpen(
          before.subjectId,
          before.workContextId,
        ))
      )
        fail("The actual WorkContext must be open");
      const next = await save(before, {
        desireRevision: input.desireRevision,
        conditionRevision: input.conditionRevision,
        desireEpoch: source.desireEpoch,
        conditionEpoch: source.conditionEpoch,
        state: "paused",
        reviewRequired: false,
        reviewReason: "",
        reason: input.reason,
        lastEvaluation: null,
        timeDomainRef: source.timeDomainRef,
      });
      await suspend(next);
      return next;
    },
    /** Evaluates only actual evidence through the existing Nous owner, preserving unknown and partial coverage. */
    async evaluate(
      value: Static<typeof evaluatePursuitSchema>,
    ): Promise<PursuitEvaluation> {
      const input = checked<Static<typeof evaluatePursuitSchema>>(
        evaluatePursuitSchema,
        value,
      );
      const requestDigest = digest(input);
      const previous = await readRepositorySql<{
        document: unknown;
        request_digest: string;
        pursuit_id: string;
      }>(
        options.persistence,
        "SELECT document,request_digest,pursuit_id FROM heptalogos.pursuit_evaluation WHERE operation_id=$1",
        [input.operationId],
      );
      if (previous[0]) {
        if (
          previous[0].request_digest !== requestDigest ||
          previous[0].pursuit_id !== input.pursuitId
        )
          fail("Evaluation identity names another actual selection");
        return checked<PursuitEvaluation>(
          pursuitEvaluationSchema,
          previous[0].document,
        );
      }
      const before = await recheck(input.subjectId, input.pursuitId);
      if (
        before.revision !== input.expectedRevision ||
        before.state !== "active" ||
        before.reviewRequired
      )
        fail("The exact Pursuit is not currently executable");
      const activity = await activityFor(before);
      if (activity.world.timeDomainRef !== before.timeDomainRef)
        fail("Condition and Activity time domains have no declared mapping");
      const result = checked<PursuitEvaluation>(
        pursuitEvaluationSchema,
        await options.motivation.evaluate({
          pursuit: before,
          activity,
          operationId: input.operationId,
          evidenceRefs: input.evidenceRefs,
        }),
      );
      if (
        digest(result.conditionRevision) !== digest(before.conditionRevision) ||
        result.timeDomainRef !== before.timeDomainRef
      )
        fail("The evaluator returned another condition or an unmapped time domain");
      await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await sql(
            tx,
            "INSERT INTO heptalogos.pursuit_evaluation(operation_id,pursuit_id,request_digest,document,recorded_at) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(operation_id) DO NOTHING",
            [
              input.operationId,
              before.pursuitId,
              requestDigest,
              JSON.stringify(result),
              options.now(),
            ],
          );
          const saved = await sql<{ request_digest: string }>(
            tx,
            "SELECT request_digest FROM heptalogos.pursuit_evaluation WHERE operation_id=$1",
            [input.operationId],
          );
          if (saved[0]?.request_digest !== requestDigest)
            fail("Evaluation identity names another actual selection");
        }),
      );
      const latest = await required(input.subjectId, input.pursuitId);
      if (latest.revision === before.revision)
        await save(latest, { lastEvaluation: result });
      return result;
    },
  };
}
