// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Atomic narrative adoption; model review and network dispatch remain outside its transaction.
 * @module narrative
 */
import {
  createUuidV7Id,
  ProblemError,
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
import { preparedDeliverySchema, type PreparedDelivery } from "./agency-contracts.js";
import type { createDeliberationService } from "./deliberation.js";
import type { createLifeService } from "./life.js";
import type { createAgencyService } from "./agency.js";
import { createWorldLifeService, lockSubjectNarrative } from "./world-life.js";
import {
  expressionBriefSchema,
  narrativeRejectionSchema,
  type NarrativeRejection,
  narrativeCommitSchema,
  claimsToSchema,
  narrativeCommitmentSchema,
  type ExpressionBrief,
  type NarrativeReview,
  type NarrativeIntentProposal,
  type NarrativeReviewProposal,
  type AdoptedClaim,
  type NarrativeCommitInput,
} from "./narrative-contracts.js";
import type { DecisionCommit } from "./deliberation-contracts.js";
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
/** Resolve exact, unambiguous quotations against the final accepted payload. */
export function resolveNarrativeReview(
  prepared: PreparedDelivery,
  proposal: NarrativeReviewProposal,
): NarrativeReview {
  const texts = payloadTexts(prepared);
  return {
    ...proposal,
    claims: proposal.claims.map((claim) => {
      const text = texts.get(claim.sourceIndex);
      const start = text?.indexOf(claim.quote) ?? -1;
      if (text === undefined || start < 0 || text.indexOf(claim.quote, start + 1) >= 0)
        denied("The claim must identify one exact quotation in its final payload");
      return { ...claim, start, end: start + claim.quote.length };
    }),
  };
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
        throw subjectProblem(
          "narrative.review_source_denied",
          "Review source is outside the adopted brief",
          "The review introduced an unadopted source or cognition reference",
        );
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
  validateWorldPatch(brief, review.worldPatch);
}
function validateWorldPatch(
  brief: ExpressionBrief,
  patch: NarrativeReview["worldPatch"],
) {
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
async function indexClaimsIn(
  tx: PersistenceInternalTransaction,
  brief: ExpressionBrief,
  behaviorRef: string,
  claims: NarrativeReview["claims"],
  at: string,
) {
  const claimIds: string[] = [];
  for (const claim of claims) {
    const claimId = createUuidV7Id("ClaimId");
    claimIds.push(claimId);
    const document = {
      ...claim,
      claimId,
      briefId: brief.briefId,
      behaviorRef,
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
        behaviorRef,
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
  return claimIds;
}
/** Dependencies are existing semantic owners, with one actual trusted review invocation. */
interface NarrativeOptions {
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
  readonly recoverRenderedCandidates?: (
    subjectId: string,
    activityId: string,
  ) => Promise<{ prepared: PreparedDelivery; recoveredFrom: string }[]>;
  readonly assertRendererSource?: (
    brief: ExpressionBrief,
    prepared: PreparedDelivery,
  ) => Promise<void>;
  readonly prepareIntent?: (
    brief: ExpressionBrief,
  ) => Promise<{ reviewerRunId: string; proposal: NarrativeIntentProposal }>;
  readonly review: (
    brief: ExpressionBrief,
    prepared: PreparedDelivery,
    background?: boolean,
  ) => Promise<
    | { reviewerRunId: string; review: NarrativeReview; pending?: false }
    | { reviewerRunId: string; pending: true }
  >;
}
/** Reads exact retained/adopted originals and delivery receipts without performing semantic indexing. */
export async function readActivityStatements(
  persistence: PersistenceService,
  input: { subjectId: string; activityIds: string[] },
) {
  const rows = await readRepositorySql<{
    brief: ExpressionBrief;
    run_id: string;
    committed: NarrativeCommitInput | null;
    recorded_at: string;
    delivery: { state: string; messageId: string | null; acceptedAt: string | null }[];
  }>(
    persistence,
    `SELECT b.document AS brief,b.renderer_run_id AS run_id,
    c.document AS committed,b.recorded_at::text AS recorded_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('state',p.state,
      'messageId',p.document#>>'{outcome,platformMessageId}',
      'acceptedAt',p.document#>>'{outcome,acceptedAt}'))
      FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id),'[]'::jsonb) AS delivery
    FROM heptalogos.expression_brief b LEFT JOIN heptalogos.narrative_commit c USING(brief_id)
    WHERE b.subject_id=$1 AND b.activity_id::text=ANY($2::text[])
    ORDER BY b.recorded_at DESC,b.brief_id DESC LIMIT 129`,
    [input.subjectId, input.activityIds],
  );
  return {
    statements: rows.slice(0, 128).flatMap((row) => {
      const brief = checked<ExpressionBrief>(expressionBriefSchema, row.brief);
      const prepared = row.committed
        ? checked<PreparedDelivery>(preparedDeliverySchema, row.committed.prepared)
        : brief.retainedCandidate?.prepared;
      if (!prepared) return [];
      return [
        {
          briefId: brief.briefId,
          activityId: brief.activityId,
          runId: row.run_id,
          decisionRef: brief.decisionRef,
          audience: brief.audience,
          createdAt: brief.createdAt,
          recordedAt: row.recorded_at,
          adopted: row.committed !== null,
          discarded: !!brief.retainedCandidate?.discardedBy,
          payloads: [...payloadTexts(prepared)].map(([sourceIndex, text]) => ({
            sourceIndex,
            text,
          })),
          delivery: row.delivery,
        },
      ];
    }),
    more: rows.length > 128,
  };
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
  const rejectionForRun = async (
    subjectId: string,
    rendererRunId: string,
  ): Promise<NarrativeRejection | undefined> => {
    const rows = await readRepositorySql<{ rejection: unknown }>(
      options.persistence,
      `SELECT b.rejection FROM heptalogos.expression_brief b WHERE b.subject_id=$1 AND b.renderer_run_id=$2 AND b.rejection IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM heptalogos.narrative_commit n WHERE n.brief_id=b.brief_id)
       AND NOT EXISTS(SELECT 1 FROM heptalogos.agency_behavior a WHERE a.subject_id=b.subject_id AND a.run_id=b.renderer_run_id)`,
      [subjectId, rendererRunId],
    );
    return rows[0]
      ? checked<NarrativeRejection>(narrativeRejectionSchema, rows[0].rejection)
      : undefined;
  };
  const retainSourceRejection = async (
    brief: ExpressionBrief,
    prepared: PreparedDelivery,
    reviewerRunId: string,
  ) =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (tx) => {
        await lockSubjectNarrative(tx, brief.subjectId);
        const rows = await sql<{ rejection: unknown; committed: boolean }>(
          tx,
          `SELECT b.rejection, (EXISTS(SELECT 1 FROM heptalogos.narrative_commit n WHERE n.brief_id=b.brief_id) OR EXISTS(SELECT 1 FROM heptalogos.agency_behavior a WHERE a.subject_id=b.subject_id AND a.run_id=b.renderer_run_id)) AS committed
       FROM heptalogos.expression_brief b WHERE b.brief_id=$1 FOR UPDATE`,
          [brief.briefId],
        );
        if (!rows[0] || rows[0].committed)
          denied(
            "A candidate with a Narrative/Agency commit cannot become a pre-commit rejection",
          );
        const value = checked<NarrativeRejection>(narrativeRejectionSchema, {
          subjectId: brief.subjectId,
          activityId: brief.activityId,
          rendererRunId: prepared.runId,
          reviewerRunId,
          preparedDigest: digest(prepared),
          recordedAt: options.now(),
          problem: {
            code: "narrative.review_source_denied",
            detail:
              "The review must use only the adopted brief's exact source and cognition references; no delivery was committed.",
            availableSourceRefs: brief.sourceRefs.slice(0, 16),
            availableCognitionRefs: brief.cognitionRefs.slice(0, 16),
          },
        });
        if (rows[0].rejection) {
          const old = checked<NarrativeRejection>(
            narrativeRejectionSchema,
            rows[0].rejection,
          );
          if (
            old.preparedDigest !== value.preparedDigest ||
            old.reviewerRunId !== reviewerRunId
          )
            denied("A rejected candidate cannot change its actual review or payload");
          return old;
        }
        await sql(
          tx,
          "UPDATE heptalogos.expression_brief SET rejection=$2::jsonb WHERE brief_id=$1",
          [brief.briefId, JSON.stringify(value)],
        );
        return value;
      }),
    );
  const readBrief = async (subjectId: string, briefId: string) =>
    (
      await readRepositorySql<{ document: ExpressionBrief }>(
        options.persistence,
        "SELECT document FROM heptalogos.expression_brief WHERE subject_id=$1 AND brief_id=$2",
        [subjectId, briefId],
      )
    )[0]?.document;
  const retainCandidate = async (
    prepared: PreparedDelivery,
    recoveredFrom?: string,
  ) => {
    prepared = checked<PreparedDelivery>(preparedDeliverySchema, prepared);
    const brief = await briefForRun(prepared.runId);
    if (!brief) denied("This rendered candidate has no adopted intention");
    validateNarrativeCandidate(brief, prepared, {
      claims: [],
      conflicts: [],
      commitments: [],
      worldPatch: null,
    });
    await options.assertRendererSource?.(brief, prepared);
    return options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (tx) => {
        await lockSubjectNarrative(tx, brief.subjectId);
        const rows = await sql<{ document: ExpressionBrief }>(
          tx,
          "SELECT document FROM heptalogos.expression_brief WHERE brief_id=$1 FOR UPDATE",
          [brief.briefId],
        );
        const current = rows[0]?.document;
        if (!current) denied("The renderer intention is unavailable");
        if (current.retainedCandidate) {
          if (digest(current.retainedCandidate.prepared) !== digest(prepared))
            denied(
              "A renderer candidate cannot change its original payload or sending identity",
            );
          return current;
        }
        const adopted = {
          ...current,
          retainedCandidate: {
            prepared,
            recordedAt: options.now(),
            ...(recoveredFrom ? { recoveredFrom } : {}),
            adoptions: [],
          },
        };
        await sql(
          tx,
          "UPDATE heptalogos.expression_brief SET document=$2::jsonb WHERE brief_id=$1",
          [brief.briefId, JSON.stringify(adopted)],
        );
        return adopted;
      }),
    );
  };
  const selectedDecision = async (
    subjectId: string,
    briefId: string,
    decisionRef: string,
    action: "communicate" | "discard",
  ) => {
    const brief = await readBrief(subjectId, briefId);
    const decision = await options.decisions.read(subjectId, decisionRef);
    if (
      !brief?.retainedCandidate ||
      !decision ||
      decision.activityId !== brief.activityId ||
      decision.decision.action !== action ||
      decision.decision.target !== "expression-candidate:" + briefId
    )
      denied("Use the current Subject choice of this exact retained candidate");
    if (brief.retainedCandidate.discardedBy)
      denied("This candidate was already declined by the Subject");
    if (action === "communicate") {
      const {
        intent,
        stance,
        qualifications,
        deception,
        eventRefs,
        cognitionRefs,
        priorClaimRefs,
        semanticRequirement,
      } = brief;
      const original = {
        intent,
        stance,
        qualifications,
        deception,
        eventRefs,
        cognitionRefs,
        priorClaimRefs,
        ...(semanticRequirement ? { semanticRequirement } : {}),
      };
      if (
        !decision.decision.expressionIntent ||
        digest(decision.decision.expressionIntent) !== digest(original)
      )
        denied(
          "Retained expression adoption must preserve its exact original intention and truth stance",
        );
    }
    if (
      action === "communicate" &&
      brief.semanticRequirement === "serious_commitment"
    ) {
      const now = await options.worldNow(brief.subjectId);
      if (
        !brief.semanticPreparation?.proposal.commitments.length ||
        brief.semanticPreparation.proposal.commitments.some(
          (commitment) =>
            commitment.due.timeDomainRef !== now.timeDomainRef ||
            Date.parse(commitment.due.at) <= Date.parse(now.at),
        )
      )
        denied(
          "The retained undertaking needs a new future condition; choose a new expression intention",
        );
    }
    return { brief, decision };
  };
  const assertSelectionIn = async (
    tx: PersistenceInternalTransaction,
    brief: ExpressionBrief,
    decision: DecisionCommit,
  ) => {
    await options.assertCandidateCurrentIn?.(tx, decision.sourceRunId);
    const rows = await sql<{ document: LifeActivity }>(
      tx,
      "SELECT document FROM heptalogos.life_activity WHERE subject_id=$1 AND activity_id=$2 FOR UPDATE",
      [brief.subjectId, brief.activityId],
    );
    const activity = rows[0]?.document;
    if (
      !activity ||
      activity.state !== "active" ||
      activity.continuationRequired ||
      activity.revision !== decision.activityRevision
    )
      denied(
        "The current Subject candidate choice requires its actual active Activity revision",
      );
  };
  return {
    briefForRun,
    retainCandidate,
    async recoverCandidates(input: { subjectId: string; activityId: string }) {
      const originals =
        (await options.recoverRenderedCandidates?.(
          input.subjectId,
          input.activityId,
        )) ?? [];
      for (const original of originals) {
        const brief = await briefForRun(original.prepared.runId);
        if (
          brief &&
          brief.subjectId === input.subjectId &&
          brief.activityId === input.activityId
        )
          await retainCandidate(original.prepared, original.recoveredFrom);
      }
      return { recovered: originals.length };
    },
    async candidatesForActivity(subjectId: string, activityId: string) {
      const rows = await readRepositorySql<{
        document: ExpressionBrief;
        rejection: NarrativeRejection | null;
        adopted: boolean;
      }>(
        options.persistence,
        `SELECT b.document,b.rejection,c.brief_id IS NOT NULL AS adopted FROM heptalogos.expression_brief b LEFT JOIN heptalogos.narrative_commit c USING(brief_id) WHERE b.subject_id=$1 AND b.activity_id=$2 AND b.document ? 'retainedCandidate' AND NOT(b.document->'retainedCandidate' ? 'discardedBy') AND NOT EXISTS(SELECT 1 FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id AND p.state IN ('accepted','dispatching','uncertain')) ORDER BY b.recorded_at DESC LIMIT 16`,
        [subjectId, activityId],
      );
      return rows.map(({ document: brief, rejection, adopted }) => ({
        adopted,
        candidateRef: "expression-candidate:" + brief.briefId,
        briefId: brief.briefId,
        renderedAt: brief.createdAt,
        audience: brief.audience,
        originalIntent: {
          intent: brief.intent,
          stance: brief.stance,
          qualifications: brief.qualifications,
          deception: brief.deception,
          eventRefs: brief.eventRefs,
          cognitionRefs: brief.cognitionRefs,
          priorClaimRefs: brief.priorClaimRefs,
          ...(brief.semanticRequirement
            ? { semanticRequirement: brief.semanticRequirement }
            : {}),
        },
        nativeIntentId: brief.retainedCandidate!.prepared.nativeIntentId,
        payloads: [...payloadTexts(brief.retainedCandidate!.prepared)].map(
          ([sourceIndex, text]) => ({ sourceIndex, text }),
        ),
        historicProblem: rejection?.problem.code ?? null,
      }));
    },
    async discardCandidate(input: {
      subjectId: string;
      briefId: string;
      decisionRef: string;
    }) {
      const { brief, decision } = await selectedDecision(
        input.subjectId,
        input.briefId,
        input.decisionRef,
        "discard",
      );
      await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, brief.subjectId);
          await assertSelectionIn(tx, brief, decision);
          await sql(
            tx,
            "UPDATE heptalogos.expression_brief SET document=jsonb_set(document,'{retainedCandidate,discardedBy}',to_jsonb($2::text)) WHERE brief_id=$1 AND NOT EXISTS(SELECT 1 FROM heptalogos.narrative_commit WHERE brief_id=$1)",
            [brief.briefId, decision.decisionRef],
          );
        }),
      );
    },
    /** Both pre-commit adoption and later queue delivery use this owner's current receipt. */
    async permitsRetainedRenderer(
      rendererRunId: string,
      transaction?: PersistenceInternalTransaction,
    ) {
      const statement = `SELECT b.document,c.document AS committed,a.document AS activity FROM heptalogos.expression_brief b JOIN heptalogos.life_activity a USING(subject_id,activity_id) LEFT JOIN heptalogos.narrative_commit c USING(brief_id) WHERE b.renderer_run_id=$1`;
      const rows = transaction
        ? await sql<{
            document: ExpressionBrief;
            committed: { reaffirmation?: unknown } | null;
            activity: LifeActivity;
          }>(transaction, statement, [rendererRunId])
        : await readRepositorySql<{
            document: ExpressionBrief;
            committed: { reaffirmation?: unknown } | null;
            activity: LifeActivity;
          }>(options.persistence, statement, [rendererRunId]);
      const row = rows[0],
        latest = row?.document.retainedCandidate?.adoptions.at(-1);
      if (
        !row ||
        !latest ||
        row.activity.state !== "active" ||
        row.activity.continuationRequired
      )
        return false;
      if (row.committed?.reaffirmation) return true;
      if (row.activity.revision !== latest.activityRevision) return false;
      if (transaction)
        await options.assertCandidateCurrentIn?.(transaction, latest.sourceRunId);
      return true;
    },
    async adoptRetainedCandidate(input: {
      subjectId: string;
      briefId: string;
      decisionRef: string;
    }) {
      const { brief, decision } = await selectedDecision(
        input.subjectId,
        input.briefId,
        input.decisionRef,
        "communicate",
      );
      const prepared = brief.retainedCandidate!.prepared;
      const prior = await priorCommit(prepared);
      if (prior) return prior;
      const reaffirmation = {
        decisionRef: decision.decisionRef,
        sourceRunId: decision.sourceRunId,
        activityRevision: decision.activityRevision,
        adoptedAt: options.now(),
      };
      await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, brief.subjectId);
          await assertSelectionIn(tx, brief, decision);
          const rows = await sql<{ document: ExpressionBrief }>(
            tx,
            "SELECT document FROM heptalogos.expression_brief WHERE brief_id=$1 FOR UPDATE",
            [brief.briefId],
          );
          const candidate = rows[0]?.document.retainedCandidate;
          if (
            !candidate ||
            candidate.discardedBy ||
            digest(candidate.prepared) !== digest(prepared)
          )
            denied("The retained candidate changed before current adoption");
          if (
            !candidate.adoptions.some(
              (receipt) => receipt.decisionRef === decision.decisionRef,
            )
          )
            await sql(
              tx,
              "UPDATE heptalogos.expression_brief SET document=jsonb_set(document,'{retainedCandidate,adoptions}',$2::jsonb) WHERE brief_id=$1",
              [brief.briefId, JSON.stringify([...candidate.adoptions, reaffirmation])],
            );
        }),
      );
      const currentBrief = (await readBrief(brief.subjectId, brief.briefId))!;
      const semantic =
        brief.semanticRequirement === "important_conflict"
          ? await options.review(currentBrief, prepared)
          : {
              pending: false as const,
              reviewerRunId: null,
              review: { claims: [], conflicts: [], commitments: [], worldPatch: null },
            };
      if (semantic.pending) denied("The related important conflict is still pending");
      validateNarrativeCandidate(brief, prepared, semantic.review);
      if (semantic.review.worldPatch || semantic.review.commitments.length)
        denied(
          "New facts and obligations require their owner before a retained expression can be adopted",
        );
      const authority = await options.agency.prepareAdoption(prepared);
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, brief.subjectId);
          const existing = await sql<{ document: { reference: string } }>(
            tx,
            "SELECT document FROM heptalogos.narrative_commit WHERE brief_id=$1",
            [brief.briefId],
          );
          if (existing[0]) return { reference: existing[0].document.reference };
          await assertSelectionIn(tx, brief, decision);
          const adopted = await options.agency.adoptDeliveryIn(
            tx,
            prepared,
            authority.current,
          );
          const claimIds = await indexClaimsIn(
            tx,
            brief,
            adopted.reference,
            semantic.review.claims,
            reaffirmation.adoptedAt,
          );
          const document = {
            operationId: brief.briefId,
            briefId: brief.briefId,
            prepared,
            reviewerRunId: semantic.reviewerRunId,
            review: semantic.review,
            reference: adopted.reference,
            claimIds,
            reaffirmation,
            semanticState:
              brief.semanticRequirement === "important_conflict"
                ? "indexed"
                : "pending",
          };
          await sql(
            tx,
            "INSERT INTO heptalogos.narrative_commit(operation_id,brief_id,subject_id,behavior_id,request_digest,document,recorded_at) VALUES($1,$1,$2,$3,$4,$5::jsonb,$6)",
            [
              brief.briefId,
              brief.subjectId,
              adopted.reference,
              digest(document),
              JSON.stringify(document),
              reaffirmation.adoptedAt,
            ],
          );
          return adopted;
        }),
      );
    },
    async candidateDelivery(input: { subjectId: string; briefId: string }) {
      const rows = await readRepositorySql<{
        document: NarrativeCommitInput & { reference: string };
      }>(
        options.persistence,
        "SELECT document FROM heptalogos.narrative_commit WHERE subject_id=$1 AND brief_id=$2",
        [input.subjectId, input.briefId],
      );
      if (!rows[0]) denied("The Subject has not adopted this retained expression");
      return {
        reference: rows[0].document.reference,
        prepared: rows[0].document.prepared,
      };
    },
    rejectionForRun,
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
        ...(brief.semanticRequirement
          ? { semanticRequirement: brief.semanticRequirement }
          : {}),
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
    /** Adopt explicit new facts and undertakings before the renderer sees them. */
    async prepareExpression(rendererRunId: string) {
      const brief = await briefForRun(rendererRunId);
      if (!brief) denied("The renderer has no adopted expression intention");
      if (
        !brief.semanticRequirement ||
        brief.semanticRequirement === "important_conflict" ||
        brief.semanticPreparation
      )
        return brief;
      if (!options.prepareIntent)
        denied("The explicit expression semantics have no configured owner");
      const prepared = await options.prepareIntent(brief);
      const { proposal } = prepared;
      if (proposal.conflicts.length) denied(proposal.conflicts.join("; "));
      if (proposal.worldPatch && brief.semanticRequirement !== "world_fact")
        denied("A commitment cannot introduce a new world fact");
      if (
        proposal.commitments.length &&
        brief.semanticRequirement !== "serious_commitment"
      )
        denied("New world detail cannot introduce an undertaking");
      const world = await options.worldNow(brief.subjectId);
      if (
        proposal.commitments.some(
          (commitment) =>
            commitment.due.timeDomainRef !== world.timeDomainRef ||
            Date.parse(commitment.due.at) <= Date.parse(world.at) ||
            commitment.sourceRefs.some((ref) => !brief.sourceRefs.includes(ref)),
        )
      )
        denied(
          "The undertaking requires adopted sources and a future actual opportunity",
        );
      if (
        brief.semanticRequirement === "serious_commitment" &&
        !proposal.commitments.length
      )
        denied("The serious undertaking needs a concrete future condition");
      if (brief.semanticRequirement === "world_fact" && !proposal.worldPatch)
        denied("Explicit new world facts require a formal world proposal");
      validateWorldPatch(brief, proposal.worldPatch);
      const decision = await options.decisions.read(brief.subjectId, brief.decisionRef);
      if (!decision) denied("The adopted communication decision is unavailable");
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, brief.subjectId);
          const rows = await sql<{ document: ExpressionBrief }>(
            tx,
            "SELECT document FROM heptalogos.expression_brief WHERE renderer_run_id=$1 FOR UPDATE",
            [rendererRunId],
          );
          const current = rows[0]?.document;
          if (!current) denied("The expression intention is unavailable");
          if (current.semanticPreparation) return current;
          // The adopted decision owns the foreground before a renderer registration exists.
          await options.assertCandidateCurrentIn?.(tx, decision.sourceRunId);
          const activities = await sql<{ document: LifeActivity }>(
            tx,
            "SELECT document FROM heptalogos.life_activity WHERE subject_id=$1 AND activity_id=$2 FOR UPDATE",
            [brief.subjectId, brief.activityId],
          );
          const activity = activities[0]?.document;
          if (
            !activity ||
            activity.state !== "active" ||
            activity.revision !== brief.expectedActivityRevision
          )
            denied("The Activity changed before adopting expression semantics");
          const realized = proposal.worldPatch
            ? await options.worlds.realizeIn(
                tx,
                {
                  ...proposal.worldPatch,
                  events: proposal.worldPatch.events.map((event) => ({
                    ...event,
                    source: {
                      kind: "narrative",
                      producerRef: prepared.reviewerRunId,
                      sourceRefs: [...brief.sourceRefs, prepared.reviewerRunId],
                    },
                  })),
                },
                world,
              )
            : undefined;
          let revision = activity.revision;
          if (proposal.commitments.length) {
            const due = proposal.commitments.map((commitment) => commitment.due);
            if (
              activity.nextOpportunity &&
              activity.nextOpportunity.timeDomainRef === world.timeDomainRef &&
              Date.parse(activity.nextOpportunity.at) > Date.parse(world.at)
            )
              due.push(activity.nextOpportunity);
            const next = due.sort((a, b) => a.at.localeCompare(b.at))[0]!;
            const progressed = await options.life.progressIn(
              tx,
              {
                subjectId: brief.subjectId,
                activityId: brief.activityId,
                expectedRevision: activity.revision,
                progress: activity.progress,
                mode: activity.mode,
                nextOpportunity: next,
              },
              world,
            );
            revision = progressed.revision;
          }
          const adopted = {
            ...brief,
            eventRefs: [
              ...brief.eventRefs,
              ...(realized?.events ?? [])
                .filter((event) =>
                  event.perceptions.some(
                    (perception) => perception.actorRef === brief.actorEntityRef,
                  ),
                )
                .map(
                  (event) =>
                    `world-event:${proposal.worldPatch!.worldId}:${event.eventId}:${event.revision}`,
                ),
            ],
            expectedActivityRevision: revision,
            semanticPreparation: prepared,
          };
          await sql(
            tx,
            "UPDATE heptalogos.expression_brief SET document=$2::jsonb WHERE brief_id=$1",
            [brief.briefId, JSON.stringify(adopted)],
          );
          return adopted;
        }),
      );
    },
    async adoptDelivery(prepared: PreparedDelivery) {
      const old = await priorCommit(prepared);
      if (old) return old;
      const brief = await retainCandidate(prepared);
      const rejection = await rejectionForRun(brief.subjectId, prepared.runId);
      if (rejection) {
        if (rejection.preparedDigest !== digest(prepared))
          denied("A rejected renderer identity cannot change its payload");
        throw subjectProblem(
          rejection.problem.code,
          "Candidate was rejected before commit",
          rejection.problem.detail,
        );
      }
      if (
        ["world_fact", "serious_commitment"].includes(
          brief.semanticRequirement ?? "",
        ) &&
        !brief.semanticPreparation
      )
        denied("Explicit semantics must be adopted before rendering");
      const reviewed =
        brief.semanticRequirement === "important_conflict"
          ? await options.review(brief, prepared)
          : {
              reviewerRunId: null,
              pending: false as const,
              review: { claims: [], conflicts: [], commitments: [], worldPatch: null },
            };
      if (reviewed.pending) denied("The important conflict readback has not completed");
      if (
        brief.semanticRequirement === "important_conflict" &&
        (reviewed.review.worldPatch || reviewed.review.commitments.length)
      )
        denied("New world facts and undertakings must be adopted before rendering");
      if (reviewed.reviewerRunId === prepared.runId)
        denied("Narrative readback must be an independent actual purpose invocation");
      const input = checked<NarrativeCommitInput>(narrativeCommitSchema, {
        operationId: brief.briefId,
        briefId: brief.briefId,
        prepared,
        reviewerRunId: reviewed.reviewerRunId,
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
                        ...(reviewed.reviewerRunId ? [reviewed.reviewerRunId] : []),
                      ]),
                    ],
                  },
                })),
              }
            : null,
        },
      });
      try {
        validateNarrativeCandidate(brief, prepared, input.review);
      } catch (error) {
        if (
          error instanceof ProblemError &&
          error.problem.problemCode === "narrative.review_source_denied"
        )
          await retainSourceRejection(brief, prepared, reviewed.reviewerRunId!);
        throw error;
      }
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
          const rejected = await sql<{ rejection: unknown }>(
            tx,
            "SELECT rejection FROM heptalogos.expression_brief WHERE brief_id=$1 FOR UPDATE",
            [brief.briefId],
          );
          if (rejected[0]?.rejection)
            denied("The actual candidate already has a terminal pre-commit rejection");
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
          const claimIds = await indexClaimsIn(
            tx,
            brief,
            adopted.reference,
            input.review.claims,
            at,
          );
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
              JSON.stringify({
                ...input,
                reference: adopted.reference,
                claimIds,
                semanticState:
                  brief.semanticRequirement === "important_conflict"
                    ? "indexed"
                    : "pending",
              }),
              at,
            ],
          );
          return adopted;
        }),
      );
    },
    /** A background reviewer is authorized by an actual retained pending original. */
    async assertPendingIndexIn(
      tx: PersistenceInternalTransaction,
      subjectId: string,
      activityId: string,
      rendererRunId?: string,
    ) {
      if (!rendererRunId)
        denied("Background indexing requires its actual renderer parent");
      const rows = await sql<{ brief_id: string }>(
        tx,
        `SELECT c.brief_id FROM heptalogos.narrative_commit c JOIN heptalogos.expression_brief b USING(brief_id) WHERE c.subject_id=$1 AND b.activity_id=$2 AND b.renderer_run_id=$3 AND c.document->>'semanticState'='pending'`,
        [subjectId, activityId, rendererRunId],
      );
      if (!rows.length) denied("This role has no retained pending statement to index");
      return { continuationSourceRef: "expression-candidate:" + rows[0]!.brief_id };
    },
    /** Owner backlog uses the already retained exact delivery; reads never launch a model. */
    async pendingSemanticWork(
      subjectId: string,
      limit = 16,
      state?: "pending" | "blocked",
    ) {
      return readRepositorySql<{
        briefId: string;
        activityId: string;
        state: string;
        problem: string | null;
        runId: string | null;
      }>(
        options.persistence,
        `SELECT c.brief_id AS "briefId", b.activity_id AS "activityId", c.document->>'semanticState' AS state, COALESCE(c.document->>'semanticProblem', c.document#>>'{semanticConflicts,0}') AS problem, c.document->>'semanticRunId' AS "runId"
         FROM heptalogos.narrative_commit c JOIN heptalogos.expression_brief b USING(brief_id)
         WHERE c.subject_id=$1 AND c.document->>'semanticState' IN ('pending','blocked') AND ($3::text IS NULL OR c.document->>'semanticState'=$3)
         ORDER BY c.recorded_at,c.brief_id LIMIT $2`,
        [subjectId, Math.min(64, Math.max(1, limit)), state ?? null],
      );
    },
    /** Same-audience unindexed originals remain usable while derived claims lag behind. */
    async unindexedTo(subjectId: string, conversationRef: string, limit = 16) {
      const rows = await readRepositorySql<{
        document: NarrativeCommitInput;
        brief: ExpressionBrief;
        deliveryState: string;
        deliveryParts: {
          sourceIndex: number;
          partIndex: number;
          state: string;
          platformMessageId: string | null;
        }[];
      }>(
        options.persistence,
        `SELECT c.document,b.document AS brief,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceIndex',p.source_index,'partIndex',p.part_index,'state',p.state,'platformMessageId',p.document#>>'{outcome,platformMessageId}') ORDER BY p.source_index,p.part_index) FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id),'[]'::jsonb) AS "deliveryParts",
         CASE WHEN EXISTS(SELECT 1 FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id AND p.state='accepted') THEN 'expressed'
         WHEN EXISTS(SELECT 1 FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id AND p.state IN ('dispatching','uncertain')) THEN 'uncertain'
         WHEN EXISTS(SELECT 1 FROM heptalogos.agency_delivery_part p WHERE p.behavior_id=c.behavior_id AND p.state IN ('not_sent','failed')) THEN 'not_sent' ELSE 'adopted' END AS "deliveryState"
         FROM heptalogos.narrative_commit c
         JOIN heptalogos.expression_brief b USING(brief_id)
         WHERE c.subject_id=$1 AND b.document#>>'{audience,conversationRef}'=$2
         AND c.document->>'semanticState' IN ('pending','blocked') ORDER BY c.recorded_at DESC,c.brief_id DESC LIMIT $3`,
        [subjectId, conversationRef, Math.min(64, Math.max(1, limit))],
      );
      return rows.map(({ document, brief, deliveryState, deliveryParts }) => ({
        deliveryState,
        deliveryParts,
        brief: {
          ...brief,
          retainedCandidate: undefined,
          ...(brief.semanticPreparation
            ? {
                semanticPreparation: {
                  ...brief.semanticPreparation,
                  proposal: { ...brief.semanticPreparation.proposal, worldPatch: null },
                },
              }
            : {}),
        },
        prepared: document.prepared,
      }));
    },
    /** Called by an authorized existing background opportunity, never by the sender. */
    async indexPending(briefId: string) {
      const rows = await readRepositorySql<{
        document: NarrativeCommitInput & { reference: string; semanticState?: string };
        brief: ExpressionBrief;
      }>(
        options.persistence,
        `SELECT c.document,b.document AS brief FROM heptalogos.narrative_commit c JOIN heptalogos.expression_brief b USING(brief_id) WHERE c.brief_id=$1`,
        [briefId],
      );
      const saved = rows[0];
      if (!saved || saved.document.semanticState !== "pending") return;
      const { brief, document } = saved;
      try {
        const reviewed = await options.review(brief, document.prepared, true);
        if (reviewed.pending) {
          await options.persistence.mutate((context) =>
            useRepositoryMutationTransaction(context, async (tx) => {
              await sql(
                tx,
                "UPDATE heptalogos.narrative_commit SET document=document || $2::jsonb WHERE brief_id=$1 AND document->>'semanticState'='pending'",
                [
                  briefId,
                  JSON.stringify({
                    semanticRunId: reviewed.reviewerRunId,
                    semanticProblem: null,
                  }),
                ],
              );
            }),
          );
          return;
        }
        // A late review is an index proposal. It cannot alter a world, undertake an
        // obligation or mutate the already adopted original and sender identity.
        const review = { ...reviewed.review, worldPatch: null, commitments: [] };
        const conflicts = [...review.conflicts];
        if (reviewed.review.worldPatch || reviewed.review.commitments.length)
          conflicts.push(
            "Late world or commitment proposal requires explicit owner adoption",
          );
        const indexable = {
          ...review,
          conflicts: [],
          claims: review.claims.filter(
            (claim) =>
              claim.basis !== "new_virtual_detail" && claim.basis !== "commitment",
          ),
        };
        validateNarrativeCandidate(brief, document.prepared, indexable);
        await options.persistence.mutate((context) =>
          useRepositoryMutationTransaction(context, async (tx) => {
            await lockSubjectNarrative(tx, brief.subjectId);
            const current = await sql<{ state: string }>(
              tx,
              "SELECT document->>'semanticState' AS state FROM heptalogos.narrative_commit WHERE brief_id=$1 FOR UPDATE",
              [briefId],
            );
            if (current[0]?.state !== "pending") return;
            const at = options.now();
            const claimIds = await indexClaimsIn(
              tx,
              brief,
              document.reference,
              indexable.claims,
              at,
            );
            await sql(
              tx,
              "UPDATE heptalogos.narrative_commit SET document=document || $2::jsonb WHERE brief_id=$1",
              [
                briefId,
                JSON.stringify({
                  semanticState: conflicts.length ? "blocked" : "indexed",
                  semanticResult: reviewed,
                  semanticConflicts: conflicts,
                  claimIds,
                }),
              ],
            );
          }),
        );
      } catch (error) {
        const code =
          error instanceof ProblemError
            ? error.problem.problemCode
            : "narrative.index_failed";
        const waiting = ["role.result_pending", "role.result_uncertain"].includes(code);
        await options.persistence.mutate((context) =>
          useRepositoryMutationTransaction(context, async (tx) => {
            await sql(
              tx,
              "UPDATE heptalogos.narrative_commit SET document=document || $2::jsonb WHERE brief_id=$1 AND document->>'semanticState'='pending'",
              [
                briefId,
                JSON.stringify({
                  semanticState: waiting ? "pending" : "blocked",
                  semanticProblem: code,
                }),
              ],
            );
          }),
        );
      }
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
      const prepared = await readRepositorySql<{
        brief_id: string;
        document: ExpressionBrief;
      }>(
        options.persistence,
        "SELECT b.brief_id,b.document FROM heptalogos.expression_brief b JOIN heptalogos.life_activity a USING(subject_id,activity_id) WHERE b.subject_id=$1 AND b.activity_id=$2 AND b.document ? 'semanticPreparation' AND a.document->>'state' IN ('active','paused') ORDER BY b.recorded_at DESC LIMIT 64",
        [subjectId, activityId],
      );
      const adopted = prepared.flatMap((row) =>
        (row.document.semanticPreparation?.proposal.commitments ?? []).map(
          (commitment, index) => ({
            ...commitment,
            commitmentId: row.brief_id + ":" + index,
            claimId: null,
            claimIndex: index,
          }),
        ),
      );
      return {
        commitments: [
          ...adopted,
          ...rows.slice(0, 64).map((row) => ({
            commitmentId: row.commitment_id,
            claimId: row.claim_id,
            ...checked<Static<typeof narrativeCommitmentSchema>>(
              narrativeCommitmentSchema,
              row.document,
            ),
          })),
        ],
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
          " WHERE c.subject_id=$1 AND c.conversation_ref=$2 AND ($3::uuid IS NULL OR (CASE WHEN $9::boolean THEN c.claim_id<$3 ELSE c.claim_id>$3 END)) AND ($4::text IS NULL OR (c.about_domain=$4 AND c.about_start<$6::timestamptz AND c.about_end>$5::timestamptz)) AND ($10::text[] IS NULL OR c.claim_id::text=ANY($10::text[]) OR c.document->'sourceRefs' ?| $10::text[] OR c.document->'eventRefs' ?| $10::text[] OR c.document->'cognitionRefs' ?| $10::text[] OR c.document->'entityRefs' ?| $10::text[])) q WHERE ($7::text IS NULL OR q.status=$7) ORDER BY " +
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
          input.relatedRefs ?? null,
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
