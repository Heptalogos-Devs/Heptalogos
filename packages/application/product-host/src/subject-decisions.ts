// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Consumes an actual subjective choice through Life, native roles and narrative custody.
 * @module subject-decisions
 */
import { v5 as uuidv5 } from "uuid";
import { digestCanonicalJson } from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import { managementProblem } from "@heptalogos/management";
import {
  deliberationDecisionSchema,
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
  decodeObservationInput,
  type HostPrepareResponse,
} from "@nous-wave/client/host-bridge";
import type { createNativeCognitionBridge } from "./native-cognition.js";
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
/** Parses a complete machine result, without stripping arbitrary punctuation or guessing a replacement. */
export function parseDeliberation(text: string): DeliberationDecision {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    denied(
      "subject.decision_invalid",
      "The deliberation role did not return its structured decision",
    );
  }
  const result = compileSchema<DeliberationDecision>(
    deliberationDecisionSchema,
  ).validate(value);
  if (!result.ok)
    denied(
      "subject.decision_invalid",
      "The actual decision does not match the adopted role output contract",
    );
  return result.value;
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
        status?: string;
      };
    }): Promise<unknown> {
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
        if (!input.run.text || !Number.isInteger(input.run.activityRevision))
          denied(
            "subject.decision_basis_missing",
            "Use the exact native result and frozen Activity revision",
          );
        const decision = parseDeliberation(input.run.text);
        adopted = await options.decisions.adopt({
          operationId,
          subjectId: input.subjectId,
          activityId: input.activityId,
          sourceRunId: input.run.runId,
          expectedActivityRevision: input.run.activityRevision!,
          decision,
        });
      }
      const decision = adopted.decision;
      const applied = await options.native.readAppliedContext(input.run.runId);
      if (!applied)
        denied(
          "subject.cognition_not_admitted",
          "The actual subjective projection is unavailable",
        );
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
          return {
            decisionRef: adopted.decisionRef,
            expression: {
              state: "blocked" as const,
              code: "agency.recipient_not_permitted",
            },
          };
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
            denied(
              "subject.expression_source_denied",
              "The expression cites cognition outside its actual applied projection",
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
        const render = await options.roles.invoke({
          requestId: rendererRunId,
          requestDigest: digestCanonicalJson("subject.role-phase.v1", {
            decisionRef: adopted.decisionRef,
            phase: "render",
          }).hex,
          subjectId: input.subjectId,
          activityId: input.activityId,
          parentRunId: input.run.runId,
          role: "subject.render",
          deadlineAt: input.run.deadlineAt,
          context: { adoptedDecisionRef: adopted.decisionRef, brief },
          contacts: [],
          sourceRefs: run.registration.sourceRefs,
          usage: applied.usage,
          delivery: {
            channel: "heptalogos-qq",
            accountId: audience.accountId,
            to: audience.to,
          },
        });
        return {
          decisionRef: adopted.decisionRef,
          expression: { state: "rendered" as const, runId: render.runId },
        };
      };
      const expression = await express();
      const startedActivity = ["initiate_activity", "learn"].includes(decision.action)
        ? await options.startActivity(adopted, { deadlineAt: input.run.deadlineAt })
        : undefined;
      if (decision.delegation) {
        const execution = await options.roles.invoke({
          requestId: decisionPhaseId(input.run.runId, "execution"),
          requestDigest: digestCanonicalJson("subject.role-phase.v1", {
            decisionRef: adopted.decisionRef,
            phase: "execution",
          }).hex,
          subjectId: input.subjectId,
          activityId: input.activityId,
          parentRunId: input.run.runId,
          role: "subject.execution",
          deadlineAt: input.run.deadlineAt,
          taskTools: decision.delegation.tools,
          adoptedDecisionRef: adopted.decisionRef,
          context: {
            adoptedDecisionRef: adopted.decisionRef,
            task: decision.delegation.goal,
            sourceRefs: decision.delegation.sourceRefs,
            permittedTools: decision.delegation.tools,
          },
          contacts: [],
          sourceRefs: decision.delegation.sourceRefs,
          usage: applied.usage,
        });
        const releaseId = decisionPhaseId(input.run.runId, "release");
        const previousRelease = await options.native.readResultRelease(
          input.subjectId,
          releaseId,
        );
        const retained = previousRelease
          ? undefined
          : await options.native.readRoleResults(input.subjectId, execution.runId);
        const released =
          previousRelease ??
          (await options.native.releaseResult({
            version: 1,
            requestId: releaseId,
            subjectId: input.subjectId,
            parentRunId: input.run.runId,
            childRunId: execution.runId,
            resultIds: (() => {
              const generated = retained!.results.filter(
                (result) => result.observation.sourceClass === "generated",
              );
              return (generated.length ? generated : retained!.results).map(
                (result) => result.resultId,
              );
            })(),
          }));
        const followup = await options.roles.invoke({
          requestId: decisionPhaseId(input.run.runId, "execution-deliberation"),
          requestDigest: digestCanonicalJson("subject.role-phase.v1", {
            decisionRef: adopted.decisionRef,
            phase: "execution-deliberation",
            releaseId,
          }).hex,
          subjectId: input.subjectId,
          activityId: input.activityId,
          role: "subject.deliberation",
          deadlineAt: input.run.deadlineAt,
          context: {
            trigger: { kind: "activity_result", decisionRef: adopted.decisionRef },
            resultRefs: released.contacts.map((contact) => contact.contactRef),
            outputContract: deliberationDecisionSchema,
            receivedResults: released.contacts.map((contact) => {
              const observation = decodeObservationInput(contact.observation);
              return {
                contactRef: contact.contactRef,
                material: observation.material,
                context: observation.context,
              };
            }),
            completedTask: decision.delegation.goal,
            previousDecisionRef: adopted.decisionRef,
          },
          contacts: released.contacts,
          sourceRefs: released.contacts.map((contact) => contact.contactRef),
          usage: applied.usage,
        });
        return {
          decisionRef: adopted.decisionRef,
          executionRunId: execution.runId,
          expression,
          startedActivity,
          followup: await service.adopt({
            ...input,
            requestId: followup.runId,
            run: followup,
          }),
        };
      }
      return { ...expression, startedActivity };
    },
  };
  return service;
}
