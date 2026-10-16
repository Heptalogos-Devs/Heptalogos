// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Projects public Nous Motivation reads/evaluations into exact behavior-side references.
 * @module pursuit-motivation
 */
import type { NousClient } from "@nous-wave/client";
import type { PursuitMotivation, PursuitReference } from "@heptalogos/subject";
import { managementProblem } from "@heptalogos/management";
function denied(detail: string): never {
  throw managementProblem(
    "gateway.pursuit_denied",
    "Pursuit cognition access denied",
    detail,
    "authorization",
  );
}
const same = (a: { kind: string; value: string } | undefined, b: PursuitReference) =>
  a?.kind === b.kind && a.value === b.value;
/** Reuses the single official evaluator; callers cannot inject truth or complete-coverage assertions. */
export function createPursuitMotivation(options: {
  readonly nous: () => Promise<Pick<NousClient, "motivation" | "runtime">>;
  readonly now: () => string;
}): PursuitMotivation {
  return {
    async inspect(input) {
      const client = await options.nous();
      const [desire, condition] = await Promise.all([
        client.motivation.getRevision(
          { subjectId: input.subjectId, id: input.desireRevision.value },
          { timeoutMs: 5000 },
        ),
        client.motivation.getRevision(
          { subjectId: input.subjectId, id: input.conditionRevision.value },
          { timeoutMs: 5000 },
        ),
      ]);
      const available = (
        record: typeof desire,
        reference: PursuitReference,
        family: string,
      ) =>
        record.subjectId === input.subjectId &&
        record.content?.family === family &&
        same(record.reference, reference) &&
        record.currentRevisionId === reference.value &&
        record.acceptanceState === "accepted" &&
        record.integrityState === "valid" &&
        record.suppressionState === "normal";
      const current =
        available(desire, input.desireRevision, "desire") &&
        available(condition, input.conditionRevision, "desired_condition");
      return {
        current,
        desireEpoch: desire.objectEpoch.toString(),
        conditionEpoch: condition.objectEpoch.toString(),
        reason: current
          ? ""
          : "Desire/condition was revised, withdrawn, suppressed or made unavailable",
        timeDomainRef: condition.content?.condition?.window?.timeDomainRef ?? "",
      };
    },
    async workContextOpen(subjectId, workContextId) {
      const value = await (
        await options.nous()
      ).runtime.getWorkContext({ subjectId, workContextId }, { timeoutMs: 5000 });
      return (
        value.workContext?.subjectId === subjectId &&
        value.workContext.workContextId === workContextId &&
        value.workContext.state === "open"
      );
    },
    async evaluate({ pursuit, activity, operationId, evidenceRefs }) {
      if (!activity.scope) denied("The Activity has no adopted source authority");
      const refs = activity.scope.sourceRefs
        .filter((reference) => !reference.startsWith("message:"))
        .map((reference) => {
          const separator = reference.indexOf(":");
          if (separator < 1) denied("Use exact typed cognition source references");
          return {
            kind: reference.slice(0, separator),
            value: reference.slice(separator + 1),
          };
        });
      // The selected WorkContext is an already adopted authoritative source. No arbitrary evidence is silently granted.
      refs.push({ kind: "work_context", value: pursuit.workContextId });
      const audience = activity.scope.conversations
        .filter((c) => c.operations.includes("observe"))
        .map((c) => c.conversationRef);
      const result = await (
        await options.nous()
      ).motivation.evaluate(
        {
          subjectId: pursuit.subjectId,
          operationId,
          conditionRevision: pursuit.conditionRevision,
          scope: { workContext: pursuit.workContextId },
          sourceRead: {
            subjectId: pursuit.subjectId,
            sourceRefs: refs,
            originConversationRefs: audience,
          },
          evidenceRefs,
        },
        { timeoutMs: 30000 },
      );
      if (
        !result.conditionRevision ||
        !same(result.conditionRevision, pursuit.conditionRevision) ||
        !result.evaluatedInterval?.timeDomainRef
      )
        denied("The official evaluator returned an incomplete condition identity");
      if (
        !["satisfied", "violated", "unknown"].includes(result.verdict) ||
        !["complete", "limited", "gap"].includes(result.coverage)
      )
        denied("Inspect the official evaluator version");
      const stamp = (value: { seconds: bigint; nanos: number } | undefined) =>
        value
          ? new Date(Number(value.seconds) * 1000).toISOString().slice(0, -5) +
            "." +
            String(value.nanos).padStart(9, "0") +
            "Z"
          : null;
      const extent = result.evaluatedInterval.extent?.value;
      const interval =
        extent?.case === "instant"
          ? {
              kind: "instant" as const,
              from: stamp(extent.value),
              until: stamp(extent.value),
            }
          : extent?.case === "interval"
            ? {
                kind: "interval" as const,
                from: stamp(extent.value.start),
                until: stamp(extent.value.end),
              }
            : { kind: "unknown" as const, from: null, until: null };
      return {
        evaluationId: result.evaluationId,
        conditionRevision: {
          kind: result.conditionRevision.kind,
          value: result.conditionRevision.value,
        },
        verdict: result.verdict as "satisfied" | "violated" | "unknown",
        finalConclusion: result.finalConclusion,
        coverage: result.coverage as "complete" | "limited" | "gap",
        applicable: result.applicable ?? null,
        timeDomainRef: result.evaluatedInterval.timeDomainRef,
        evaluatedInterval: interval,
        evidenceRefs: result.inputs.map((ref) => ({
          kind: ref.kind,
          value: ref.value,
        })),
        recordedAt: options.now(),
      };
    },
  };
}
