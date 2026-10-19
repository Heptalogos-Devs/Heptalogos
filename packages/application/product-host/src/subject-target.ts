// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Resolves one explicit target inside the current Situation directory without granting authority.
 * @module subject-target
 */
import { Type } from "@heptalogos/schema-runtime/typebox";
import {
  deliberationDecisionSchema,
  interactionActionKindSchema,
} from "@heptalogos/subject";
import type {
  InteractionAction,
  SituationFrame,
  SituationObject,
} from "@heptalogos/subject";
/** Failure details are retained in the existing continuation for the next normal consideration. */
type TargetResolution =
  | { readonly object: SituationObject; readonly problem?: never }
  | { readonly object?: never; readonly problem: string };
/** Exact public references and handles identify only objects already visible in this frame. */
export function resolveSituationTarget(
  frame: SituationFrame,
  action: InteractionAction,
): TargetResolution {
  const matches = frame.objects.filter((object) => object.handle === action.target);
  const candidates = matches.length
    ? matches
    : frame.objects.filter((object) => object.sourceRef === action.target);
  const identities = new Set(
    candidates.map((object) =>
      JSON.stringify([object.owner, object.kind, object.sourceRef]),
    ),
  );
  const object =
    candidates.find((candidate) => candidate.handle === frame.currentHandle) ??
    candidates[0];
  const code = !action.target
    ? "target_required"
    : !object
      ? "target_not_visible"
      : identities.size !== 1
        ? "target_ambiguous"
        : !object.actions.includes(action.action)
          ? "action_unavailable"
          : undefined;
  if (!code && object) return { object };
  return {
    problem: JSON.stringify({
      code,
      action: action.action,
      target:
        object && action.target && action.target.length <= 256
          ? action.target
          : undefined,
      choices: (object && identities.size === 1 ? [object] : frame.objects)
        .filter((value) => value.handle.length <= 128)
        .slice(0, 4)
        .map((value) => ({
          handle: value.handle,
          actions: value.actions,
        })),
    }),
  };
}

/** These existing foreground actions can express an untargeted local choice. */
export function allowsUntargetedSituationAction(
  action: InteractionAction["action"],
): boolean {
  return ["inspect", "continue", "wait", "rest", "communicate"].includes(action);
}
/** Project current resolver-approved choices into model input; owner authorization remains unchanged. */
export function currentSituationDecisionInput(
  frame: SituationFrame,
  references: { eventRefs: readonly string[]; priorClaimRefs: readonly string[] } = {
    eventRefs: [],
    priorClaimRefs: [],
  },
) {
  const candidates = [
    ...new Set(frame.objects.flatMap((object) => [object.handle, object.sourceRef])),
  ];
  const actionTargets = interactionActionKindSchema.anyOf
    .map(({ const: action }) => ({
      action,
      targetRequired: !allowsUntargetedSituationAction(action),
      targets: candidates.filter(
        (target) => !resolveSituationTarget(frame, { action, target }).problem,
      ),
    }))
    .filter((choice) => choice.targets.length || !choice.targetRequired);
  const alternatives = actionTargets.map((choice) => {
    const target = choice.targets.length
      ? Type.Union(choice.targets.map((value) => Type.Literal(value)))
      : Type.Never();
    const requiredField =
      choice.action === "communicate"
        ? "expressionIntent"
        : choice.action === "search"
          ? "delegation"
          : choice.action === "adjust_plan"
            ? "calendarChange"
            : undefined;
    const retained =
      choice.action === "communicate"
        ? choice.targets.filter((value) =>
            frame.objects.some(
              (object) =>
                object.kind === "expression_candidate" &&
                (object.handle === value || object.sourceRef === value),
            ),
          )
        : [];
    const regularTargets = choice.targets.filter((value) => !retained.includes(value));
    const regularTarget = regularTargets.length
      ? Type.Union(regularTargets.map((value) => Type.Literal(value)))
      : Type.Never();
    const normal = Type.Object({
      ...(requiredField
        ? Type.Required(Type.Pick(deliberationDecisionSchema, [requiredField]))
            .properties
        : {}),
      action: Type.Literal(choice.action),
      ...(choice.action === "adjust_plan"
        ? Type.Required(Type.Pick(deliberationDecisionSchema, ["reason"])).properties
        : {}),
      target:
        choice.action === "communicate" && retained.length
          ? Type.Optional(regularTarget)
          : choice.targetRequired
            ? target
            : Type.Optional(target),
    });
    return retained.length
      ? Type.Union([
          normal,
          Type.Object({
            action: Type.Literal("communicate"),
            target: Type.Union(retained.map((value) => Type.Literal(value))),
          }),
        ])
      : normal;
  });
  return {
    frameRef: frame.frameRef,
    actionTargets,
    outputContract: Type.Intersect([
      deliberationDecisionSchema,
      Type.Object({
        expressionIntent: Type.Optional(
          Type.Object({
            ...deliberationDecisionSchema.properties.expressionIntent.properties,
            eventRefs: allowedReferencesSchema(references.eventRefs),
            priorClaimRefs: allowedReferencesSchema(references.priorClaimRefs),
          }),
        ),
      }),
      Type.Union(alternatives),
    ]),
  };
}
/** Exact owner-provided reference choices keep unavailable categories empty. */
export function allowedReferencesSchema(values: readonly string[]) {
  const choices = [...new Set(values)];
  return Type.Array(
    choices.length
      ? Type.Union(choices.map((value) => Type.Literal(value)))
      : Type.String(),
    { maxItems: choices.length ? 128 : 0, uniqueItems: true },
  );
}
