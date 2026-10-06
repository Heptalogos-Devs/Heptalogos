// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runtime handlers for the current Subject lifecycle SystemAction family.
 * @module system-actions/subject
 */

import type { CanonicalJsonValue } from "@heptalogos/foundation-contracts";
import type {
  ProductSemanticId,
  SystemActionRequest,
  TargetPrecondition,
} from "../contracts.js";
import { managementProblem } from "../problems.js";
import {
  canonicalObject,
  precondition,
  requiredUuid,
  canonicalValue,
  standardImpact,
  type SystemActionHandler,
} from "./types.js";

type SubjectAction = Extract<
  SystemActionRequest,
  { readonly actionId: "subject.start" | "subject.stop" }
>;

function actionInput(action: SystemActionRequest): SubjectAction {
  return action as SubjectAction;
}

/** Creates the finite Subject lifecycle SystemAction handler. */
export function createSubjectActionHandler(): SystemActionHandler {
  const handler: SystemActionHandler = {
    actionIds: Object.freeze(["subject.start", "subject.stop"]),
    normalize(request) {
      const action = actionInput(request);
      requiredUuid("SubjectId", action.input.subjectId, "subjectId");
      if (
        !Number.isSafeInteger(action.input.expectedAuthorityRevision) ||
        action.input.expectedAuthorityRevision < 1
      ) {
        throw managementProblem(
          "management.invalid_input",
          "Subject authority revision is invalid",
          "expectedAuthorityRevision must be a positive safe integer",
          "validation",
        );
      }
      return action;
    },
    async preconditions(request, context): Promise<readonly TargetPrecondition[]> {
      const action = actionInput(request);
      const status = await context.owners.subject.getStatus();
      if (status.subjectId !== action.input.subjectId) {
        throw managementProblem(
          "management.subject_not_found",
          "Subject was not found",
          "The requested SubjectId is not current for this Installation",
          "conflict",
        );
      }
      return Object.freeze([
        precondition("subject", status.subjectId, status, "subject.status.v1"),
      ]);
    },
    async affectedOwners(): Promise<readonly ProductSemanticId[]> {
      return Object.freeze([
        "product.subject" as ProductSemanticId,
        "product.messaging" as ProductSemanticId,
      ]);
    },
    async impact() {
      return standardImpact();
    },
    async execute(request, context): Promise<CanonicalJsonValue> {
      const action = actionInput(request);
      const result =
        action.actionId === "subject.start"
          ? await context.owners.subject.start({
              subjectId: action.input.subjectId,
              expectedAuthorityRevision: action.input.expectedAuthorityRevision,
            })
          : await context.owners.subject.stop({
              subjectId: action.input.subjectId,
              expectedAuthorityRevision: action.input.expectedAuthorityRevision,
            });
      if (action.actionId === "subject.start") {
        await context.owners.subject.reconcileRuntime().catch(() => undefined);
        return canonicalObject(await context.owners.subject.getStatus()).value;
      }
      return canonicalObject(result).value;
    },
    async verify(request, result, context) {
      const action = actionInput(request);
      const current = await context.owners.subject.getStatus();
      return (
        current.subjectId === action.input.subjectId &&
        current.desiredState ===
          (action.actionId === "subject.start" ? "RUNNING" : "STOPPED") &&
        canonicalObject(current).canonical === canonicalValue(result)
      );
    },
    expectedDigest() {
      return undefined;
    },
    reconcilesSubjectRuntime(request) {
      return actionInput(request).actionId === "subject.start";
    },
  };
  return Object.freeze(handler);
}
