// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Selects globally from owner metadata and keeps source fairness distinct from reading.
 * @module attention
 */
import { v5 as uuidv5 } from "uuid";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { createSubjectSchemaReader } from "./checked-schema.js";
import { readSubjectRows } from "./subject-read.js";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import {
  readRepositorySql,
  executeRepositorySql as sql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import { subjectProblem } from "./problems.js";
import {
  subjectAttentionCandidateSchema,
  subjectAttentionPolicySchema,
  selectAttentionSchema,
  attentionSelectionSchema,
  recordAttentionConsideredSchema,
  type SubjectAttentionOptions,
  type AttentionPosition,
  type SubjectAttentionCandidate,
} from "./attention-contracts.js";
const ns = "b55f25e7-55c8-4333-83b8-f0040c068dfe";
const priority = { important: 0, direct: 1, background: 2 } as const;
const checked = createSubjectSchemaReader(() => {
  throw subjectProblem(
    "attention.invalid_input",
    "Invalid attention request",
    "Use the actual metadata-only owner contract",
    "validation",
  );
});
/** Deterministic ranking never promotes old background above a more important class. */
export function createSubjectAttentionService(options: SubjectAttentionOptions) {
  const positions = async (subjectId: string) =>
    (
      await readRepositorySql<{ document: AttentionPosition }>(
        options.persistence,
        "SELECT document FROM heptalogos.attention_source_position WHERE subject_id=$1 ORDER BY source_key",
        [subjectId],
      )
    ).map((row) => row.document);
  const readExplanation = async (
    subjectId: string,
    reference?: string,
    transaction?: PersistenceInternalTransaction,
  ) => {
    const key = reference?.startsWith("attention:") ? reference.slice(10) : undefined;
    if (reference && !/^[0-9a-f-]{36}$/i.test(key ?? "")) return undefined;
    const statement =
      "SELECT document FROM heptalogos.attention_selection WHERE subject_id=$1 AND ($2::uuid IS NULL OR selection_id=$2) ORDER BY recorded_at DESC,selection_id DESC LIMIT 1";
    const parameters = [subjectId, key ?? null];
    const rows = await readSubjectRows<{ document: unknown }>(
      options.persistence,
      statement,
      parameters,
      transaction,
    );
    return rows[0]
      ? checked<Static<typeof attentionSelectionSchema>>(
          attentionSelectionSchema,
          rows[0].document,
        )
      : undefined;
  };
  return {
    positions,
    /** Management can inspect a saved actual choice without calling a model or advancing a source. */
    explain: readExplanation,
    async select(
      value: Static<typeof selectAttentionSchema>,
    ): Promise<Static<typeof attentionSelectionSchema>> {
      const input = checked<Static<typeof selectAttentionSchema>>(
        selectAttentionSchema,
        value,
      );
      const awaitedPolicy = await options.policy();
      const policy = checked<Static<typeof subjectAttentionPolicySchema>>(
        subjectAttentionPolicySchema,
        Object.fromEntries(
          Object.keys(subjectAttentionPolicySchema.properties).map((key) => [
            key,
            Reflect.get(awaitedPolicy, key),
          ]),
        ),
      );
      if (policy.perSourceLimit > policy.candidateLimit)
        throw subjectProblem(
          "attention.invalid_policy",
          "Invalid attention policy",
          "Per-source limit exceeds the complete candidate budget",
          "validation",
        );
      const limit = Math.min(
        input.limit ?? policy.candidateLimit,
        policy.candidateLimit,
      );
      const history = await positions(input.subjectId),
        bySource = new Map(history.map((position) => [position.sourceKey, position]));
      const supplied = await options.candidates({
        subjectId: input.subjectId,
        perSourceLimit: policy.perSourceLimit,
        messageBatchLimit: policy.messageBatchLimit,
        limit,
        positions: history,
        naturalOpportunity: input.naturalOpportunity === true,
        ...(input.manualActivityId ? { manualActivityId: input.manualActivityId } : {}),
      });
      const actualNow = options.now(),
        now = Date.parse(actualNow);
      let nextAt: number | undefined;
      const visible: SubjectAttentionCandidate[] = [];
      for (const value of supplied.candidates) {
        const candidate = checked<SubjectAttentionCandidate>(
          subjectAttentionCandidateSchema,
          value,
        );
        if (candidate.subjectId !== input.subjectId)
          throw subjectProblem(
            "attention.foreign_subject",
            "Foreign attention source",
            "The source owner returned another Subject",
            "authorization",
          );
        if (input.manualActivityId && candidate.activityId !== input.manualActivityId)
          continue;
        const prior = bySource.get(candidate.sourceKey);
        if (
          !input.manualActivityId &&
          prior?.sourceRevision === candidate.sourceRevision
        ) {
          const next = Date.parse(prior.consideredAt) + policy.reconsiderMs;
          if (next > now) nextAt = nextAt === undefined ? next : Math.min(nextAt, next);
          // An unchanged notification can be reconsidered at a real natural node, never a paid timer poll.
          if (!input.naturalOpportunity) continue;
        }
        const ready =
          Date.parse(candidate.availableAt) +
          (candidate.kind === "message" && candidate.priorityClass === "background"
            ? policy.coalesceMs
            : 0);
        if (ready > now) {
          nextAt = nextAt === undefined ? ready : Math.min(nextAt, ready);
          continue;
        }
        visible.push(candidate);
      }
      const rank = (a: SubjectAttentionCandidate, b: SubjectAttentionCandidate) =>
        priority[a.priorityClass] - priority[b.priorityClass] ||
        Number(b.related) - Number(a.related) ||
        Number(b.candidateRef === input.currentFocus?.candidateRef) -
          Number(a.candidateRef === input.currentFocus?.candidateRef) ||
        (bySource.get(a.sourceKey)?.consideredAt ?? "").localeCompare(
          bySource.get(b.sourceKey)?.consideredAt ?? "",
        ) ||
        a.availableAt.localeCompare(b.availableAt) ||
        a.candidateRef.localeCompare(b.candidateRef);
      // Round robin gives each source one slot before it can fill the remaining budget.
      const sources = new Map<string, SubjectAttentionCandidate[]>();
      for (const candidate of visible) {
        const group = sources.get(candidate.sourceKey) ?? [];
        group.push(candidate);
        sources.set(candidate.sourceKey, group);
      }
      for (const group of sources.values()) group.sort(rank);
      const heads = [...sources.values()].sort((a, b) => rank(a[0]!, b[0]!));
      const candidates: SubjectAttentionCandidate[] = [];
      for (let i = 0; i < policy.perSourceLimit && candidates.length < limit; i++)
        for (const group of heads)
          if (group[i] && candidates.length < limit) candidates.push(group[i]!);
      const best = [...candidates].sort(rank)[0],
        focus = input.currentFocus;
      const switchRequested =
        !input.manualActivityId &&
        best &&
        focus &&
        priority[best.priorityClass] < priority[focus.priorityClass]
          ? best
          : undefined;
      const selected = best && (!focus || input.naturalOpportunity) ? best : undefined;
      const state = switchRequested
        ? "switch_requested"
        : selected
          ? "selected"
          : focus
            ? "focus_retained"
            : nextAt !== undefined
              ? "coalescing"
              : "no_new_candidate";
      const reason = switchRequested
        ? "A strictly higher category requests a safe foreground switch"
        : selected
          ? "Highest eligible category, known relation, focus continuity and source fairness"
          : focus
            ? "Retain the current focus until a natural node or strictly higher category"
            : nextAt !== undefined
              ? "Only notification aggregation or metadata reconsideration is due"
              : "No new eligible source revision";
      const explanation = {
        subjectId: input.subjectId,
        state,
        reason,
        candidateRefs: candidates.map((candidate) => candidate.candidateRef),
        candidates,
        limited: supplied.more || visible.length > candidates.length,
        policy,
        ...(selected ? { selected } : {}),
        ...(switchRequested ? { switchRequested } : {}),
        ...(nextAt !== undefined
          ? { nextConsiderAt: new Date(nextAt).toISOString() }
          : {}),
      };
      const selectionId = uuidv5(
        digestCanonicalJson("attention.selection.v1", {
          ...explanation,
          focus: focus ?? null,
        } as CanonicalJsonValue).hex,
        ns,
      );
      const result = checked<Static<typeof attentionSelectionSchema>>(
        attentionSelectionSchema,
        { ...explanation, explanationRef: "attention:" + selectionId },
      );
      await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await sql(
            tx,
            "INSERT INTO heptalogos.attention_selection(selection_id,subject_id,document,recorded_at) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING",
            [selectionId, input.subjectId, JSON.stringify(result), actualNow],
          );
        }),
      );
      return result;
    },
    async recordConsidered(
      value: Static<typeof recordAttentionConsideredSchema>,
      transaction?: PersistenceInternalTransaction,
    ) {
      const input = checked<Static<typeof recordAttentionConsideredSchema>>(
        recordAttentionConsideredSchema,
        value,
      );
      const save = async (tx: PersistenceInternalTransaction) => {
        const selection = await readExplanation(
          input.subjectId,
          input.explanationRef,
          tx,
        );
        const candidate = [selection?.selected, selection?.switchRequested].find(
          (candidate) => candidate?.candidateRef === input.candidateRef,
        );
        if (!candidate)
          throw subjectProblem(
            "attention.choice_changed",
            "Attention choice is unavailable",
            "Use the exact saved candidate and explanation",
          );
        const at = options.now();
        const document: AttentionPosition = {
          sourceKey: candidate.sourceKey,
          sourceRevision: candidate.sourceRevision,
          consideredAt: at,
          reactionId: input.reactionId,
          ...(candidate.sourcePosition
            ? { sourcePosition: candidate.sourcePosition }
            : {}),
        };
        await sql(
          tx,
          "INSERT INTO heptalogos.attention_source_position(subject_id,source_key,document,considered_at) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(subject_id,source_key) DO UPDATE SET document=excluded.document,considered_at=excluded.considered_at WHERE attention_source_position.document->>'reactionId' IS DISTINCT FROM excluded.document->>'reactionId' OR attention_source_position.document->>'sourceRevision' IS DISTINCT FROM excluded.document->>'sourceRevision'",
          [input.subjectId, candidate.sourceKey, JSON.stringify(document), at],
        );
        const rows = await sql<{ document: AttentionPosition }>(
          tx,
          "SELECT document FROM heptalogos.attention_source_position WHERE subject_id=$1 AND source_key=$2",
          [input.subjectId, candidate.sourceKey],
        );
        return rows[0]!.document;
      };
      return transaction
        ? save(transaction)
        : options.persistence.mutate((context) =>
            useRepositoryMutationTransaction(context, save),
          );
    },
  };
}
