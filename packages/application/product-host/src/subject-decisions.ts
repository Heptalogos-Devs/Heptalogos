// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Consumes an actual subjective choice through Life, native roles and narrative custody.
 * @module subject-decisions
 */
import { v5 as uuidv5 } from "uuid";
import { digestCanonicalJson } from "@heptalogos/foundation-contracts";
import { managementProblem } from "@heptalogos/management";
import {
  type DeliberationDecision,
  type createDeliberationService,
  type createLifeService,
  type createNarrativeService,
  type createWorldLifeService,
  type ExpressionBrief,
  type DecisionCommit,
} from "@heptalogos/subject";
import {
  decodeProjection,
  encodeProjection,
  decodeCognitionUsage,
  type HostPrepareResponse,
} from "@nous-wave/client/host-bridge";
import type {
  NativeAppliedContext,
  createNativeCognitionBridge,
} from "./native-cognition.js";
import type { createSubjectRoles } from "./subject-roles.js";
const namespace = "99bf4a61-c35f-4b41-a405-d0c3feef100f";
/** Stable phase identities prevent a handler retry from replaying paid work or effects. */
export const decisionPhaseId = (runId: string, phase: string) =>
  uuidv5(runId + ":" + phase, namespace);
function denied(code: string, detail: string): never {
  throw managementProblem(
    code,
    "Subject choice cannot proceed",
    detail,
    "conflict",
    "after-change",
  );
}
/** Scene elaboration uses only exact known/released events, never the author's hidden plot. */
async function detailScope(
  worlds: ReturnType<typeof createWorldLifeService>,
  subjectId: string,
  worldId: string | undefined,
  eventRefs: readonly string[],
): Promise<ExpressionBrief["worldDetailScope"]> {
  if (!worldId || !eventRefs.length) return null;
  const state = await worlds.read(subjectId, worldId);
  if (!state) return null;
  const selected = eventRefs.flatMap((ref) => {
    const match = /^world-event:([0-9a-f-]{36}):([0-9a-f-]{36}):([1-9][0-9]*)$/i.exec(
      ref,
    );
    return match?.[1] === worldId
      ? [{ eventId: match[2]!, revision: Number(match[3]) }]
      : [];
  });
  if (!selected.length) return null;
  const released = new Set(
    await worlds.releasedEventIds(
      subjectId,
      worldId,
      selected.map((event) => event.eventId),
    ),
  );
  // Owner reads exact event IDs; only structural scene scope is returned to the renderer.
  const events = await worlds.sceneEvents(
    subjectId,
    worldId,
    selected.filter((event) => released.has(event.eventId)),
  );
  if (!events.length) return null;
  const scene = events.sort((a, b) => b.interval.end.localeCompare(a.interval.end))[0]!;
  return {
    worldId,
    interval: {
      timeDomainRef: state.definition.timeDomainRef,
      start: scene.interval.start,
      end: scene.interval.end,
    },
    actorRefs: scene.actorRefs,
    placeRefs: [scene.placeRef],
    description: state.definition.creationScope,
  };
}
/** Product composition supplies existing owners; professional execution remains in OpenClaw. */
export function createSubjectDecisionHandler(options: {
  readonly life: ReturnType<typeof createLifeService>;
  readonly decisions: ReturnType<typeof createDeliberationService>;
  readonly narrative: ReturnType<typeof createNarrativeService>;
  readonly worlds: ReturnType<typeof createWorldLifeService>;
  readonly native: Pick<
    ReturnType<typeof createNativeCognitionBridge>,
    | "readRun"
    | "readAppliedContext"
    | "readRoleResults"
    | "releaseResult"
    | "readResultRelease"
  >;
  readonly roles: ReturnType<typeof createSubjectRoles>;
  readonly now: () => string;
  readonly startActivity: (
    adopted: DecisionCommit,
    context: { deadlineAt?: string },
  ) => Promise<{ activityId: string }>;
  readonly deliveryFor: (
    subjectId: string,
    activityId: string,
    usage: HostPrepareResponse["usage"],
  ) => Promise<ExpressionBrief["audience"] | undefined>;
}) {
  const service = {
    async adopt(input: {
      subjectId: string;
      activityId: string;
      requestId: string;
      worldId?: string;
      run: {
        runId: string;
        text?: string;
        activityRevision?: number;
        deadlineAt?: string;
        result?: unknown;
        structuredOutput?: unknown;
        status?: string;
      };
    }): Promise<DecisionCommit> {
      const run = await options.native.readRun(input.run.runId);
      if (
        !run?.consumerId ||
        run.registration.subjectId !== input.subjectId ||
        run.registration.activityId !== input.activityId ||
        run.registration.roleScope.role !== "subject.deliberation"
      )
        denied(
          "subject.decision_source_denied",
          "A current admitted subjective run is required",
        );
      const operationId = decisionPhaseId(input.run.runId, "adopt");
      const previous = await options.decisions.readOperation(
        input.subjectId,
        operationId,
      );
      let adopted = previous;
      if (!adopted) {
        if (
          !input.run.structuredOutput ||
          !Number.isInteger(input.run.activityRevision)
        )
          denied(
            "subject.decision_basis_missing",
            "Use the exact native result and frozen Activity revision",
          );
        const decision = input.run.structuredOutput as DeliberationDecision;
        if (decision.action === "continue" && !decision.nextOpportunity) {
          const applied = await options.native.readAppliedContext(input.run.runId);
          const worldId = input.worldId ?? decodeCognitionUsage(applied.usage).worldId;
          if (worldId) {
            const frame = await options.worlds.prepareAdvance(input.subjectId, worldId);
            const now = await options.life.worldNow(input.subjectId);
            const next = [frame.nextOpportunity, frame.currentPolicy?.nextInterruptAt]
              .filter(
                (point): point is NonNullable<typeof point> =>
                  !!point &&
                  point.timeDomainRef === now.timeDomainRef &&
                  Date.parse(point.at) > Date.parse(now.at),
              )
              .sort((a, b) => a.at.localeCompare(b.at))[0];
            if (next) decision.nextOpportunity = next;
          }
        }
        adopted = await options.decisions.adopt({
          operationId,
          subjectId: input.subjectId,
          activityId: input.activityId,
          sourceRunId: input.run.runId,
          expectedActivityRevision: input.run.activityRevision!,
          decision,
        });
      }
      return adopted;
    },
    startActivity: options.startActivity,
    /** Rendering is one explicit foreground action, never an implicit task completion effect. */
    async express(input: {
      subjectId: string;
      activityId: string;
      worldId?: string;
      adopted: DecisionCommit;
      run: { runId: string; deadlineAt?: string };
    }) {
      const adopted = input.adopted;
      const run = await options.native.readRun(input.run.runId);
      if (
        !run?.consumerId ||
        adopted.sourceRunId !== input.run.runId ||
        adopted.subjectId !== input.subjectId ||
        adopted.activityId !== input.activityId
      )
        denied(
          "subject.decision_source_denied",
          "Use the exact adopted subjective source run",
        );
      const decision = adopted.decision;
      const applied: NativeAppliedContext = await options.native.readAppliedContext(
        input.run.runId,
      );
      if (!applied)
        denied(
          "subject.cognition_not_admitted",
          "The actual subjective projection is unavailable",
        );
      const reject = (
        code: string,
        detail: string,
        availableCognitionRefs?: string[],
      ) => ({
        decisionRef: adopted.decisionRef,
        expression: {
          state: "rejected" as const,
          problem: {
            code,
            detail,
            ...(availableCognitionRefs ? { availableCognitionRefs } : {}),
          },
        },
      });
      const express = async () => {
        if (!decision.expressionIntent)
          return {
            decisionRef: adopted.decisionRef,
            expression: { state: "none" as const },
          };
        const audience = await options.deliveryFor(
          input.subjectId,
          input.activityId,
          applied.usage,
        );
        if (!audience)
          return reject(
            "agency.recipient_not_permitted",
            "The current Activity has no permitted external audience; choose another current action.",
          );
        const actualAudience = decodeCognitionUsage(applied.usage).audience;
        if (
          actualAudience?.conversationRef !== audience.conversationRef ||
          !["direct", "group"].includes(actualAudience.visibility)
        )
          return reject(
            "subject.expression_audience_changed",
            "Read or open the permitted audience to obtain its actual projection before communicating.",
          );
        const rendererRunId = decisionPhaseId(input.run.runId, "render");
        let brief = await options.narrative.briefForRun(rendererRunId);
        if (!brief) {
          const projection = decodeProjection(applied.projection);
          const wire = encodeProjection(projection);
          const epistemicView = wire.epistemicView;
          if (
            !epistemicView ||
            typeof epistemicView !== "object" ||
            Array.isArray(epistemicView)
          )
            denied(
              "subject.epistemic_view_missing",
              "The official Nous epistemic view is required for Subject expression",
            );
          const visible = new Set(
            projection.segments.flatMap((segment) =>
              segment.sourceRefs.map((ref) => ref.kind + ":" + ref.value),
            ),
          );
          if (decision.expressionIntent.cognitionRefs.some((ref) => !visible.has(ref)))
            return reject(
              "subject.expression_source_denied",
              "Use only exact cognition references from the admitted projection, or an empty cognitionRefs array. A listed read action obtains actual material; metadata is not a failed read.",
              [...visible].filter((ref) => ref.length <= 2048).slice(0, 16),
            );
          const at = options.now();
          brief = {
            briefId: decisionPhaseId(input.run.runId, "brief"),
            decisionRef: adopted.decisionRef,
            subjectId: input.subjectId,
            activityId: input.activityId,
            expectedActivityRevision: adopted.activityRevision,
            actorEntityRef: run.registration.actorEntityRef,
            audience,
            ...(decision.expressionIntent.semanticRequirement
              ? { semanticRequirement: decision.expressionIntent.semanticRequirement }
              : {}),
            intent: decision.expressionIntent.intent,
            stance: decision.expressionIntent.stance,
            sourceRefs: [...run.registration.sourceRefs],
            cognitionRefs: decision.expressionIntent.cognitionRefs,
            eventRefs: decision.expressionIntent.eventRefs,
            priorClaimRefs: decision.expressionIntent.priorClaimRefs,
            epistemicView,
            qualifications: decision.expressionIntent.qualifications,
            deception: decision.expressionIntent.deception,
            worldDetailScope: await detailScope(
              options.worlds,
              input.subjectId,
              input.worldId ?? decodeCognitionUsage(applied.usage).worldId,
              decision.expressionIntent.eventRefs,
            ),
            createdAt: at,
            validUntil:
              input.run.deadlineAt ??
              new Date(
                Date.parse(at) +
                  (await options.life.get(input.subjectId, input.activityId))!.scope!
                    .maxRunMs,
              ).toISOString(),
          };
          await options.narrative.saveBrief(brief, rendererRunId);
        }
        brief = await options.narrative.prepareExpression(rendererRunId);
        let render: Awaited<ReturnType<typeof options.roles.invoke>>;
        try {
          render = await options.roles.invoke({
            requestId: rendererRunId,
            requestDigest: digestCanonicalJson("subject.role-phase.v1", {
              decisionRef: adopted.decisionRef,
              phase: "render",
            }).hex,
            subjectId: input.subjectId,
            activityId: input.activityId,
            parentRunId: input.run.runId,
            role: "subject.render",
            foreground: run.registration.foreground,
            deadlineAt: input.run.deadlineAt,
            context: {
              adoptedDecisionRef: adopted.decisionRef,
              brief: {
                ...brief,
                ...(brief.semanticPreparation
                  ? {
                      semanticPreparation: {
                        ...brief.semanticPreparation,
                        proposal: {
                          ...brief.semanticPreparation.proposal,
                          worldPatch: null,
                        },
                      },
                    }
                  : {}),
              },
              ...(brief.semanticPreparation?.proposal.worldPatch
                ? {
                    adoptedWorldDetails: await options.worlds.query({
                      subjectId: brief.subjectId,
                      worldId: brief.semanticPreparation.proposal.worldPatch.worldId,
                      interval: brief.semanticPreparation.proposal.worldPatch.interval,
                      view: "subject",
                      limit: 32,
                    }),
                  }
                : {}),
            },
            contacts: [],
            sourceRefs: run.registration.sourceRefs,
            usage: applied.usage,
            delivery: {
              channel: "heptalogos-qq",
              accountId: audience.accountId,
              to: audience.to,
            },
          });
        } catch (error) {
          const rejection = await options.narrative.rejectionForRun(
            input.subjectId,
            rendererRunId,
          );
          if (rejection && rejection.activityId === input.activityId)
            return {
              decisionRef: adopted.decisionRef,
              expression: { state: "rejected" as const, problem: rejection.problem },
            };
          throw error;
        }

        return {
          decisionRef: adopted.decisionRef,
          expression: { state: "rendered" as const, runId: render.runId },
        };
      };
      return express();
    },
  };
  return service;
}
