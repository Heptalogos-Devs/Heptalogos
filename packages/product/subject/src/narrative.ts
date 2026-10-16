// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Atomic narrative adoption; model review and network dispatch remain outside its transaction.
 * @module narrative
 */
import {
  createUuidV7Id,
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import type { PersistenceService } from "@heptalogos/persistence";
import {
  executeRepositorySql as sql,
  readRepositorySql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import {
  activitySchema,
  type LifeActivity,
  type worldPointSchema,
} from "./contracts.js";
import type { PreparedDelivery } from "./agency-contracts.js";
import type { createDeliberationService } from "./deliberation.js";
import type { createLifeService } from "./life.js";
import type { createAgencyService } from "./agency.js";
import { createWorldLifeService, lockSubjectNarrative } from "./world-life.js";
import {
  expressionBriefSchema,
  narrativeCommitSchema,
  claimsToSchema,
  narrativeCommitmentSchema,
  type ExpressionBrief,
  type NarrativeReview,
  type AdoptedClaim,
  type NarrativeCommitInput,
} from "./narrative-contracts.js";
import { subjectProblem } from "./problems.js";
const digest = (value: unknown) =>
  digestCanonicalJson("agency.narrative.v1", value as CanonicalJsonValue).hex;
function denied(detail: string): never {
  throw subjectProblem("narrative.conflict", "Expression cannot be adopted", detail);
}
function checked<T>(schema: Parameters<typeof compileSchema<T>>[0], input: unknown): T {
  const result = compileSchema<T>(schema).validate(input);
  if (!result.ok) denied("The request does not match the owning narrative contract");
  return result.value;
}
function payloadTexts(input: PreparedDelivery): Map<number, string> {
  const entries = input.preparedBatch.entries;
  if (!Array.isArray(entries)) denied("A complete native prepared batch is required");
  const result = new Map<number, string>();
  for (const entry of entries) {
    if (entry.status !== "accepted") continue;
    if (!Number.isInteger(entry.sourceIndex) || result.has(entry.sourceIndex))
      denied("Original payload indices must be unique");
    result.set(
      entry.sourceIndex,
      typeof entry.payload?.text === "string" ? entry.payload.text : "",
    );
  }
  return result;
}
/** Checks actual quote spans, provenance boundaries and deliberate intent before any owner write. */
export function validateNarrativeCandidate(
  brief: ExpressionBrief,
  prepared: PreparedDelivery,
  review: NarrativeReview,
): void {
  if (review.conflicts.length) denied(review.conflicts.join("; "));
  const audience = brief.audience;
  if (
    prepared.channel !== audience.channel ||
    prepared.accountId !== audience.accountId ||
    prepared.to !== audience.to
  )
    denied("The renderer cannot change the adopted audience");
  const texts = payloadTexts(prepared);
  for (const claim of review.claims) {
    const text = texts.get(claim.sourceIndex);
    if (
      text === undefined ||
      claim.end <= claim.start ||
      text.slice(claim.start, claim.end) !== claim.quote
    )
      denied("The claim must quote the exact final payload span");
    for (const [actual, allowed] of [
      [claim.sourceRefs, brief.sourceRefs],
      [claim.cognitionRefs, brief.cognitionRefs],
      [claim.priorClaimRefs, brief.priorClaimRefs],
    ] as const) {
      if (actual.some((ref) => !allowed.includes(ref)))
        denied("The review introduced an unadopted source or cognition reference");
    }
    if (
      (claim.basis === "deliberate" || claim.stance === "deliberate") &&
      brief.deception === "none"
    )
      denied("A contradiction cannot acquire a deliberate intent after rendering");
    if (
      claim.basis === "world" &&
      (!claim.eventRefs.length ||
        claim.eventRefs.some((ref) => !brief.eventRefs.includes(ref)))
    )
      denied("World claims require the adopted exact event references");
    if (claim.basis === "cognition" && !claim.cognitionRefs.length)
      denied("Personal knowledge attribution requires its exact cognition reference");
    if (
      claim.basis === "new_virtual_detail" &&
      (!review.worldPatch ||
        !claim.eventRefs.length ||
        claim.eventRefs.some(
          (ref) =>
            !review.worldPatch!.events.some(
              (e) => ref === e.eventId || ref === "event:heptalogos:" + e.eventId,
            ),
        ))
    )
      denied("New virtual details require the actual matching WorldPatch");
    if (
      claim.basis === "commitment" &&
      !review.commitments.some((c) => review.claims[c.claimIndex] === claim)
    )
      denied("A promised undertaking must have an actual due opportunity");
    if (claim.about && Date.parse(claim.about.start) >= Date.parse(claim.about.end))
      denied("Claim time intervals must increase");
  }
  for (const c of review.commitments) {
    if (
      review.claims[c.claimIndex]?.kind !== "commitment" ||
      c.sourceRefs.some((ref) => !brief.sourceRefs.includes(ref))
    )
      denied(
        "Commitments must reference the corresponding final claim and adopted sources",
      );
  }
  const patch = review.worldPatch;
  if (patch) {
    const scope = brief.worldDetailScope;
    if (
      !scope ||
      patch.subjectId !== brief.subjectId ||
      patch.worldId !== scope.worldId ||
      patch.interval.timeDomainRef !== scope.interval.timeDomainRef ||
      Date.parse(patch.interval.start) < Date.parse(scope.interval.start) ||
      Date.parse(patch.interval.end) > Date.parse(scope.interval.end)
    )
      denied("World elaboration is outside this brief's adopted scene and interval");
    if (
      patch.events.some(
        (event) =>
          !event.parentEventId ||
          !brief.eventRefs.some(
            (ref) =>
              ref === event.parentEventId ||
              ref === "event:heptalogos:" + event.parentEventId ||
              ref.startsWith(`world-event:${scope.worldId}:${event.parentEventId}:`),
          ) ||
          event.actorRefs.some((ref) => !scope.actorRefs.includes(ref)) ||
          !scope.placeRefs.includes(event.placeRef),
      )
    )
      denied("The renderer cannot introduce new world actors or locations");
  }
}
/** Dependencies are existing semantic owners, with one actual trusted review invocation. */
export interface NarrativeOptions {
  readonly persistence: PersistenceService;
  readonly life: Pick<ReturnType<typeof createLifeService>, "progressIn">;
  readonly decisions: Pick<ReturnType<typeof createDeliberationService>, "read">;
  readonly now: () => string;
  readonly worldNow: (subjectId: string) => Promise<Static<typeof worldPointSchema>>;
  readonly worlds: ReturnType<typeof createWorldLifeService>;
  readonly agency: Pick<
    ReturnType<typeof createAgencyService>,
    "prepareAdoption" | "adoptDeliveryIn"
  >;
  /** New candidates must still own foreground qualification; immutable adopted batches remain deliverable. */
  readonly assertCandidateCurrentIn?: (
    tx: PersistenceInternalTransaction,
    rendererRunId: string,
  ) => Promise<void>;
  readonly review: (
    brief: ExpressionBrief,
    prepared: PreparedDelivery,
  ) => Promise<{ reviewerRunId: string; review: NarrativeReview }>;
}
/** Briefs, claims, commitments and one native delivery are adopted in the same local transaction. */
export function createNarrativeService(options: NarrativeOptions) {
  const briefForRun = async (runId: string): Promise<ExpressionBrief | undefined> =>
    (
      await readRepositorySql<{ document: ExpressionBrief }>(
        options.persistence,
        "SELECT document FROM heptalogos.expression_brief WHERE renderer_run_id=$1",
        [runId],
      )
    )[0]?.document;
  const priorCommit = async (input: PreparedDelivery) => {
    const rows = await readRepositorySql<{
      document: NarrativeCommitInput & { reference: string };
    }>(
      options.persistence,
      "SELECT c.document FROM heptalogos.narrative_commit c JOIN heptalogos.agency_behavior b ON b.behavior_id=c.behavior_id WHERE b.native_intent_id=$1",
      [input.nativeIntentId],
    );
    if (!rows[0]) return undefined;
    if (digest(rows[0].document.prepared) !== digest(input))
      denied("The native intent already identifies another exact expression");
    return { reference: rows[0].document.reference };
  };
  const claimQuery = `SELECT c.claim_id, c.document,
    CASE WHEN EXISTS(SELECT 1 FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id AND p.source_index=c.source_index AND p.state='accepted') THEN 'expressed'
    WHEN EXISTS(SELECT 1 FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id AND p.source_index=c.source_index AND p.state IN ('dispatching','uncertain')) THEN 'uncertain'
    WHEN EXISTS(SELECT 1 FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id AND p.source_index=c.source_index AND p.state IN ('not_sent','failed')) THEN 'not_sent'
    ELSE 'adopted' END AS status,
    COALESCE((SELECT jsonb_agg(p.document#>>'{outcome,platformMessageId}') FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id AND p.source_index=c.source_index AND p.state='accepted'),'[]'::jsonb) AS message_ids
    FROM heptalogos.narrative_claim c`;
  return {
    briefForRun,
    async saveBrief(value: ExpressionBrief, rendererRunId: string) {
      const brief = checked<ExpressionBrief>(expressionBriefSchema, value);
      if (!rendererRunId || Date.parse(brief.validUntil) <= Date.parse(brief.createdAt))
        denied("A renderer binding and finite expression lifetime are required");
      const adopted = await options.decisions.read(brief.subjectId, brief.decisionRef);
      const intent = adopted?.decision.expressionIntent;
      if (!adopted || adopted.activityId !== brief.activityId || !intent)
        denied(
          "The expression must reference an actually adopted same-Activity communication intention",
        );
      const actualIntent = {
        intent: brief.intent,
        stance: brief.stance,
        qualifications: brief.qualifications,
        deception: brief.deception,
        eventRefs: brief.eventRefs,
        cognitionRefs: brief.cognitionRefs,
        priorClaimRefs: brief.priorClaimRefs,
      };
      if (
        digest(intent) !== digest(actualIntent) ||
        brief.sourceRefs.some((ref) => !adopted.sourceRefs.includes(ref))
      )
        denied(
          "The expression cannot change the adopted intention, deliberate stance or source boundary",
        );
      const hash = digest({ brief, rendererRunId });
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, brief.subjectId);
          await sql(
            tx,
            "INSERT INTO heptalogos.expression_brief(brief_id,subject_id,activity_id,renderer_run_id,request_digest,document,recorded_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(brief_id) DO NOTHING",
            [
              brief.briefId,
              brief.subjectId,
              brief.activityId,
              rendererRunId,
              hash,
              JSON.stringify(brief),
              options.now(),
            ],
          );
          const rows = await sql<{ request_digest: string }>(
            tx,
            "SELECT request_digest FROM heptalogos.expression_brief WHERE brief_id=$1",
            [brief.briefId],
          );
          if (rows[0]?.request_digest !== hash)
            denied("The brief identity already binds another intent or renderer");
          return brief;
        }),
      );
    },
    async adoptDelivery(prepared: PreparedDelivery) {
      const old = await priorCommit(prepared);
      if (old) return old;
      const brief = await briefForRun(prepared.runId);
      if (!brief) denied("This native result has no adopted expression brief");
      const reviewed = await options.review(brief, prepared);
      if (reviewed.reviewerRunId === prepared.runId)
        denied("Narrative readback must be an independent actual purpose invocation");
      const input = checked<NarrativeCommitInput>(narrativeCommitSchema, {
        operationId: brief.briefId,
        briefId: brief.briefId,
        prepared,
        ...reviewed,
        review: {
          ...reviewed.review,
          worldPatch: reviewed.review.worldPatch
            ? {
                ...reviewed.review.worldPatch,
                events: reviewed.review.worldPatch.events.map((event) => ({
                  ...event,
                  source: {
                    kind: "narrative",
                    producerRef: prepared.runId,
                    sourceRefs: [
                      ...new Set([
                        ...brief.sourceRefs,
                        prepared.runId,
                        reviewed.reviewerRunId,
                      ]),
                    ],
                  },
                })),
              }
            : null,
        },
      });
      validateNarrativeCandidate(brief, prepared, input.review);
      const authority = await options.agency.prepareAdoption(prepared);
      if (
        authority.current.activity.subjectId !== brief.subjectId ||
        authority.current.activity.activityId !== brief.activityId ||
        authority.current.actorEntityRef !== brief.actorEntityRef
      )
        denied("The actual renderer belongs to another adopted Subject or Activity");
      const world =
        input.review.worldPatch || input.review.commitments.length
          ? await options.worldNow(brief.subjectId)
          : undefined;
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, brief.subjectId);
          const previous = await sql<{
            request_digest: string;
            document: { reference: string };
          }>(
            tx,
            "SELECT request_digest,document FROM heptalogos.narrative_commit WHERE operation_id=$1",
            [input.operationId],
          );
          if (previous[0]) {
            if (previous[0].request_digest !== digest(input))
              denied(
                "This narrative operation already identifies a different candidate",
              );
            return { reference: previous[0].document.reference };
          }
          await options.assertCandidateCurrentIn?.(tx, prepared.runId);
          if (Date.parse(options.now()) > Date.parse(brief.validUntil))
            denied(
              "The expression's relative time and dependencies have expired; render a new candidate",
            );
          if (input.review.worldPatch)
            await options.worlds.realizeIn(tx, input.review.worldPatch, world!);
          const rows = await sql<{ document: LifeActivity }>(
            tx,
            "SELECT document FROM heptalogos.life_activity WHERE subject_id=$1 AND activity_id=$2 FOR UPDATE",
            [brief.subjectId, brief.activityId],
          );
          const activity =
            rows[0] && checked<LifeActivity>(activitySchema, rows[0].document);
          if (
            !activity ||
            activity.revision !== brief.expectedActivityRevision ||
            activity.state !== "active" ||
            activity.continuationRequired
          )
            denied("The relevant adopted Activity changed before narrative commit");
          const adopted = await options.agency.adoptDeliveryIn(
            tx,
            prepared,
            authority.current,
          );
          if (input.review.commitments.length) {
            const due = input.review.commitments.map((commitment) => commitment.due);
            if (
              due.some(
                (point) =>
                  point.timeDomainRef !== world!.timeDomainRef ||
                  Date.parse(point.at) <= Date.parse(world!.at),
              )
            )
              denied(
                "An adopted undertaking requires a future opportunity in the actual world domain",
              );
            if (activity.nextOpportunity?.timeDomainRef === world!.timeDomainRef)
              due.push(activity.nextOpportunity);
            const earliest = due.sort((a, b) => a.at.localeCompare(b.at))[0]!;
            await options.life.progressIn(
              tx,
              {
                subjectId: brief.subjectId,
                activityId: brief.activityId,
                expectedRevision: activity.revision,
                progress: activity.progress,
                mode: activity.mode,
                nextOpportunity: earliest,
              },
              world!,
            );
          }
          const at = options.now();
          const claimIds: string[] = [];
          for (const claim of input.review.claims) {
            const claimId = createUuidV7Id("ClaimId");
            claimIds.push(claimId);
            const document = {
              ...claim,
              claimId,
              briefId: brief.briefId,
              behaviorRef: adopted.reference,
              conversationRef: brief.audience.conversationRef,
              recordedAt: at,
            };
            await sql(
              tx,
              "INSERT INTO heptalogos.narrative_claim(claim_id,subject_id,brief_id,behavior_id,conversation_ref,source_index,about_domain,about_start,about_end,document,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)",
              [
                claimId,
                brief.subjectId,
                brief.briefId,
                adopted.reference,
                brief.audience.conversationRef,
                claim.sourceIndex,
                claim.about?.timeDomainRef ?? null,
                claim.about?.start ?? null,
                claim.about?.end ?? null,
                JSON.stringify(document),
                at,
              ],
            );
          }
          for (const commitment of input.review.commitments)
            await sql(
              tx,
              "INSERT INTO heptalogos.agency_commitment(commitment_id,subject_id,activity_id,claim_id,due_domain,due_at,state,document,recorded_at) VALUES($1,$2,$3,$4,$5,$6,'pending',$7::jsonb,$8)",
              [
                createUuidV7Id("CommitmentId"),
                brief.subjectId,
                brief.activityId,
                claimIds[commitment.claimIndex],
                commitment.due.timeDomainRef,
                commitment.due.at,
                JSON.stringify(commitment),
                at,
              ],
            );
          await sql(
            tx,
            "INSERT INTO heptalogos.narrative_commit(operation_id,brief_id,subject_id,behavior_id,request_digest,document,recorded_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
            [
              input.operationId,
              brief.briefId,
              brief.subjectId,
              adopted.reference,
              digest(input),
              JSON.stringify({ ...input, reference: adopted.reference, claimIds }),
              at,
            ],
          );
          return adopted;
        }),
      );
    },
    /** Actual adopted undertakings remain visible until their owning Activity resolves them. */
    async pendingCommitments(subjectId: string, activityId: string) {
      const rows = await readRepositorySql<{
        commitment_id: string;
        claim_id: string;
        document: unknown;
      }>(
        options.persistence,
        "SELECT commitment_id,claim_id,document FROM heptalogos.agency_commitment WHERE subject_id=$1 AND activity_id=$2 AND state='pending' ORDER BY due_at,commitment_id LIMIT 65",
        [subjectId, activityId],
      );
      return {
        commitments: rows.slice(0, 64).map((row) => ({
          commitmentId: row.commitment_id,
          claimId: row.claim_id,
          ...checked<Static<typeof narrativeCommitmentSchema>>(
            narrativeCommitmentSchema,
            row.document,
          ),
        })),
        more: rows.length > 64,
      };
    },
    async claimsTo(
      value: Static<typeof claimsToSchema>,
    ): Promise<{ claims: AdoptedClaim[]; more: boolean }> {
      const input = checked<Static<typeof claimsToSchema>>(claimsToSchema, value);
      const rows = await readRepositorySql<{
        document: Omit<AdoptedClaim, "status" | "platformMessageIds">;
        status: AdoptedClaim["status"];
        message_ids: string[];
      }>(
        options.persistence,
        "SELECT * FROM (" +
          claimQuery +
          " WHERE c.subject_id=$1 AND c.conversation_ref=$2 AND ($3::uuid IS NULL OR (CASE WHEN $9::boolean THEN c.claim_id<$3 ELSE c.claim_id>$3 END)) AND ($4::text IS NULL OR (c.about_domain=$4 AND c.about_start<$6::timestamptz AND c.about_end>$5::timestamptz))) q WHERE ($7::text IS NULL OR q.status=$7) ORDER BY " +
          (input.order === "newest" ? "q.claim_id DESC" : "q.claim_id ASC") +
          " LIMIT $8",
        [
          input.subjectId,
          input.conversationRef,
          input.afterClaimId ?? null,
          input.about?.timeDomainRef ?? null,
          input.about?.start ?? null,
          input.about?.end ?? null,
          input.status ?? null,
          input.limit + 1,
          input.order === "newest",
        ],
      );
      const selected = rows.map((row) => ({
        ...row.document,
        status: row.status,
        platformMessageIds: row.message_ids,
      }));
      return {
        claims: selected.slice(0, input.limit),
        more: rows.length > input.limit,
      };
    },
    async explainStatement(subjectId: string, platformMessageId: string) {
      const rows = await readRepositorySql<{
        document: Omit<AdoptedClaim, "status" | "platformMessageIds">;
        status: AdoptedClaim["status"];
        message_ids: string[];
      }>(
        options.persistence,
        claimQuery +
          " WHERE c.subject_id=$1 AND EXISTS(SELECT 1 FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id AND p.source_index=c.source_index AND p.document#>>'{outcome,platformMessageId}'=$2) ORDER BY c.claim_id LIMIT 128",
        [subjectId, platformMessageId],
      );
      return {
        claims: rows.map((row) => ({
          ...row.document,
          status: row.status,
          platformMessageIds: row.message_ids,
        })),
      };
    },
  };
}
