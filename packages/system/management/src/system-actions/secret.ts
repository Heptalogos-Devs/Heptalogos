// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runtime handlers for the current Secret SystemAction family.
 * @module system-actions/secret
 */

import type { CanonicalJsonValue } from "@heptalogos/foundation-contracts";
import type { SystemActionRequest, TargetPrecondition } from "../contracts.js";
import { managementProblem } from "../problems.js";
import {
  canonicalObject,
  precondition,
  requiredUuid,
  resultField,
  standardImpact,
  type SystemActionHandler,
} from "./types.js";

type SecretAction = Extract<
  SystemActionRequest,
  { readonly actionId: "secret.set" | "secret.replace" | "secret.revoke" }
>;

function actionInput(action: SystemActionRequest): SecretAction {
  return action as SecretAction;
}

function notFound(): never {
  throw managementProblem(
    "management.secret_not_found",
    "Secret was not found",
    "The requested SecretRef is not current",
    "conflict",
  );
}

/** Creates the finite Secret SystemAction handler. */
export function createSecretActionHandler(): SystemActionHandler {
  const handler: SystemActionHandler = {
    actionIds: Object.freeze(["secret.set", "secret.replace", "secret.revoke"]),
    normalize(request) {
      const action = actionInput(request);
      if (
        action.actionId === "secret.set" &&
        (action.input.purpose !== "ai.gateway.bearer-token" ||
          action.input.scopeRef?.resourceKind !== "gateway-profile")
      ) {
        throw managementProblem(
          "management.invalid_input",
          "Secret input is not current",
          "The current Secret route only accepts an ai.gateway.bearer-token scoped to a gateway-profile",
          "validation",
        );
      }
      if (action.actionId !== "secret.set") {
        requiredUuid("SecretId", action.input.secretRef, "secretRef");
      }
      return action;
    },
    async preconditions(request, context): Promise<readonly TargetPrecondition[]> {
      const action = actionInput(request);
      if (action.actionId === "secret.set") return Object.freeze([]);
      const metadata = await context.owners.secret.getMetadata(action.input.secretRef);
      if (metadata === undefined) notFound();
      return Object.freeze([precondition("secret", metadata.secretId, metadata)]);
    },
    async affectedOwners(): Promise<
      readonly import("../contracts.js").ProductSemanticId[]
    > {
      return Object.freeze([
        "system.secret" as import("../contracts.js").ProductSemanticId,
      ]);
    },
    async impact() {
      return standardImpact();
    },
    async execute(request, context): Promise<CanonicalJsonValue> {
      const action = actionInput(request);
      if (action.actionId === "secret.revoke") {
        await context.owners.secret.revoke(action.input.secretRef);
        return null;
      }
      const bytes = new TextEncoder().encode(action.input.material);
      try {
        if (action.actionId === "secret.set") {
          return canonicalObject(
            await context.owners.secret.createOrSet({
              purpose: action.input.purpose,
              ...(action.input.scopeRef === undefined
                ? {}
                : { scopeRef: action.input.scopeRef }),
              material: bytes,
            }),
          ).value;
        }
        const existing = await context.owners.secret.getMetadata(
          action.input.secretRef,
        );
        if (existing === undefined) notFound();
        return canonicalObject(
          await context.owners.secret.replace(action.input.secretRef, {
            purpose: existing.purpose,
            ...(existing.scopeRef === undefined ? {} : { scopeRef: existing.scopeRef }),
            material: bytes,
          }),
        ).value;
      } finally {
        bytes.fill(0);
      }
    },
    async verify(request, result, context) {
      const action = actionInput(request);
      if (action.actionId === "secret.set") {
        const secretId = resultField(result, "secretId");
        return (
          secretId !== undefined &&
          (await context.owners.secret.getMetadata(secretId))?.state === "ACTIVE"
        );
      }
      if (action.actionId === "secret.replace") {
        return (
          (await context.owners.secret.getMetadata(action.input.secretRef))?.state ===
          "ACTIVE"
        );
      }
      return (
        (await context.owners.secret.getMetadata(action.input.secretRef))?.state ===
        "REVOKED"
      );
    },
    expectedDigest() {
      return undefined;
    },
    reconcilesSubjectRuntime() {
      return true;
    },
  };
  return Object.freeze(handler);
}
