// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adopts Subject choices in the existing Life owner and Host-fenced short transaction.
 * @module deliberation
 */
import {
  createUuidV7Id,
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { createSubjectSchemaReader } from "./checked-schema.js";
import { readSubjectRows } from "./subject-read.js";
import {
  executeRepositorySql as sql,
  readRepositorySql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import { activitySchema, type LifeActivity } from "./contracts.js";
import {
  adoptDeliberationSchema,
  decisionCommitSchema,
  type AdoptDeliberation,
  type DecisionCommit,
  type DeliberationOptions,
} from "./deliberation-contracts.js";
import { lockSubjectNarrative } from "./world-life.js";
import { subjectLineage } from "./subject-lineage.js";
import { subjectProblem } from "./problems.js";
function conflict(detail: string): never {
  throw subjectProblem(
    "deliberation.conflict",
    "Subject decision cannot be adopted",
    detail,
  );
}
const checked = createSubjectSchemaReader(() => {
  throw subjectProblem(
    "deliberation.invalid_input",
    "Invalid Subject decision",
    "Use the actual adopted decision schema",
    "validation",
  );
});
/** Immutable decisions selected by their actual input run or related Activity, not current authority. */
export async function readDecisionHistory(
  persistence: DeliberationOptions["persistence"],
  input: { subjectId: string; sourceRunIds: string[]; activityIds: string[] },
) {
  const rows = await readRepositorySql<{ document: unknown }>(
    persistence,
    `SELECT document FROM heptalogos.subject_decision WHERE subject_id=$1
     AND (source_run_id=ANY($2::text[]) OR activity_id::text=ANY($3::text[]))
     ORDER BY adopted_at DESC,decision_id DESC LIMIT 129`,
    [input.subjectId, input.sourceRunIds, input.activityIds],
  );
  return {
    decisions: rows
      .slice(0, 128)
      .map((row) => checked<DecisionCommit>(decisionCommitSchema, row.document)),
    more: rows.length > 128,
  };
}
/** No model loop or alternative Activity lifecycle is created by this owner. */
export function createDeliberationService(options: DeliberationOptions) {
  const read = async (
    subjectId: string,
    decisionRef: string,
    transaction?: PersistenceInternalTransaction,
  ): Promise<DecisionCommit | undefined> => {
    const match =
      /^subject-decision:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
        decisionRef,
      );
    if (!match) return undefined;
    const statement =
      "SELECT document FROM heptalogos.subject_decision WHERE subject_id=$1 AND decision_id=$2";
    const parameters = [subjectId, match[1]!];
    const rows = await readSubjectRows<{ document: unknown }>(
      options.persistence,
      statement,
      parameters,
      transaction,
    );
    return rows[0]
      ? checked<DecisionCommit>(decisionCommitSchema, rows[0].document)
      : undefined;
  };
  return {
    /** Reads one same-Subject immutable adoption for brief/task consumers. */
    read,
    /** Recovers an existing receipt before a Host rebuilds any current-revision adoption request. */
    async readOperation(
      subjectId: string,
      operationId: string,
    ): Promise<DecisionCommit | undefined> {
      const rows = await readRepositorySql<{ document: unknown }>(
        options.persistence,
        "SELECT document FROM heptalogos.subject_decision WHERE subject_id=$1 AND operation_id=$2",
        [subjectId, operationId],
      );
      return rows[0]
        ? checked<DecisionCommit>(decisionCommitSchema, rows[0].document)
        : undefined;
    },
    /** Adopts a bounded actual choice and the resulting mode/next point atomically under Activity CAS. */
    async adopt(value: AdoptDeliberation): Promise<DecisionCommit> {
      const input = checked<AdoptDeliberation>(adoptDeliberationSchema, value);
      const digest = digestCanonicalJson(
        "subject.decision.v1",
        input as unknown as CanonicalJsonValue,
      ).hex;
      // Idempotent reads do not require a still-live provider or clock; canonical adoption remains readable after cancellation.
      const old = await readRepositorySql<{
        document: unknown;
        request_digest: string;
      }>(
        options.persistence,
        "SELECT document,request_digest FROM heptalogos.subject_decision WHERE subject_id=$1 AND operation_id=$2",
        [input.subjectId, input.operationId],
      );
      if (old[0]) {
        if (old[0].request_digest !== digest)
          conflict("This operationId is already bound to another choice");
        return checked<DecisionCommit>(decisionCommitSchema, old[0].document);
      }
      const decision = input.decision;
      if (decision.action === "communicate" && !decision.expressionIntent)
        conflict(
          "An adopted communicate choice requires its explicit expression intent",
        );
      if (decision.expressionIntent && decision.action !== "communicate")
        conflict(
          "Use the canonical communicate action for an explicit expression intent",
        );
      if (decision.calendarChange && !decision.reason?.trim())
        conflict("A calendar change requires its actual reason");
      if (decision.calendarChange && decision.action !== "adjust_plan")
        conflict("A calendar change belongs to the canonical adjust_plan action");
      if (decision.delegation && decision.action !== "search")
        conflict("A professional search task requires the canonical search action");
      if (decision.newActivity && decision.action !== "continue")
        conflict(
          "Adopt a new foreground activity through the canonical continue action",
        );
      const [world, authority] = await Promise.all([
        options.worldNow(input.subjectId),
        options.validateSourceRun(input),
      ]);
      if (authority.sourceRefs.length > 128 || authority.tools.length > 128)
        conflict("Actual run authority must be bounded to this invocation");
      if (
        decision.delegation &&
        (decision.delegation.sourceRefs.some(
          (ref) => !authority.sourceRefs.includes(ref),
        ) ||
          decision.delegation.tools.some((tool) => !authority.tools.includes(tool)))
      )
        throw subjectProblem(
          "deliberation.scope_denied",
          "Delegation exceeds the admitted run scope",
          "Keep task sources and tools within actual current authority",
          "authorization",
        );
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, input.subjectId);
          const previous = await sql<{ document: unknown; request_digest: string }>(
            tx,
            "SELECT document,request_digest FROM heptalogos.subject_decision WHERE subject_id=$1 AND operation_id=$2",
            [input.subjectId, input.operationId],
          );
          if (previous[0]) {
            if (previous[0].request_digest !== digest)
              conflict("This operationId is already bound to another choice");
            return checked<DecisionCommit>(decisionCommitSchema, previous[0].document);
          }
          const rows = await sql<{ document: unknown }>(
            tx,
            "SELECT document FROM heptalogos.life_activity WHERE subject_id=$1 AND activity_id=$2 FOR UPDATE",
            [input.subjectId, input.activityId],
          );
          if (!rows[0]) conflict("The actual Activity does not belong to this Subject");
          const activity = checked<LifeActivity>(activitySchema, rows[0].document);
          if (
            activity.revision !== input.expectedActivityRevision ||
            activity.state !== "active" ||
            activity.continuationRequired ||
            !activity.adoptedBy ||
            !activity.scope
          )
            conflict(
              "Use the current active, adopted Activity revision after recovery",
            );
          if (
            activity.world.timeDomainRef !== world.timeDomainRef ||
            !Number.isFinite(Date.parse(world.at))
          )
            conflict(
              "The actual Activity and current world must share one declared domain",
            );
          const next =
            decision.nextOpportunity === undefined
              ? activity.nextOpportunity &&
                Date.parse(activity.nextOpportunity.at) > Date.parse(world.at)
                ? activity.nextOpportunity
                : null
              : decision.nextOpportunity;
          if (
            next &&
            (next.timeDomainRef !== world.timeDomainRef ||
              !Number.isFinite(Date.parse(next.at)) ||
              Date.parse(next.at) <= Date.parse(world.at))
          )
            conflict(
              "A newly adopted next opportunity must be a future point in this Activity's actual world",
            );
          if (
            decision.delegation &&
            decision.delegation.tools.some(
              (tool) => !activity.scope!.tools.includes(tool),
            )
          )
            throw subjectProblem(
              "deliberation.scope_denied",
              "Delegation exceeds the current Activity scope",
              "Use only the Activity's currently adopted tools; the trusted Host rechecks exact source permission",
              "authorization",
            );
          await options.assertSourceRunIn(tx, input, authority);
          const mode =
            decision.action === "rest"
              ? ("rest" as const)
              : decision.action === "wait"
                ? ("wait" as const)
                : activity.mode;
          const updated = await options.life.progressIn(
            tx,
            {
              subjectId: input.subjectId,
              activityId: input.activityId,
              expectedRevision: input.expectedActivityRevision,
              progress: activity.progress,
              nextOpportunity: next,
              mode,
            },
            world,
          );
          const decisionId = createUuidV7Id("DecisionCommitId");
          const adopted = checked<DecisionCommit>(decisionCommitSchema, {
            decisionId,
            decisionRef: `subject-decision:${decisionId}`,
            operationId: input.operationId,
            subjectId: input.subjectId,
            activityId: input.activityId,
            sourceRunId: input.sourceRunId,
            previousActivityRevision: activity.revision,
            activityRevision: updated.revision,
            decision,
            sourceRefs: [...new Set(authority.sourceRefs)],
            tools: [...new Set(authority.tools)],
            mode,
            nextOpportunity: next,
            adoptedAt: options.now(),
          });
          await sql(
            tx,
            "INSERT INTO heptalogos.subject_decision(decision_id,subject_id,activity_id,operation_id,source_run_id,request_digest,document,adopted_at,lineage_context_ref) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)",
            [
              decisionId,
              input.subjectId,
              input.activityId,
              input.operationId,
              input.sourceRunId,
              digest,
              JSON.stringify(adopted),
              adopted.adoptedAt,
              JSON.stringify(subjectLineage(context.execution)),
            ],
          );
          return adopted;
        }),
      );
    },
  };
}
