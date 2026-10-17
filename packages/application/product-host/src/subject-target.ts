// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Resolves one explicit target inside the current Situation directory without granting authority.
 * @module subject-target
 */
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
