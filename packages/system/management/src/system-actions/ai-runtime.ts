// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runtime handlers for the current AIRuntime SystemAction family.
 * @module system-actions/ai-runtime
 */

import type { CanonicalJsonValue } from "@heptalogos/foundation-contracts";
import type {
  ProductSemanticId,
  SystemActionRequest,
  TargetPrecondition,
} from "../contracts.js";
import { invalidInputProblem } from "../problems.js";
import {
  canonicalObject,
  canonicalValue,
  precondition,
  requiredUuid,
  resultField,
  secretRefFromAction,
  standardImpact,
  exactModelCapabilities,
  type SystemActionHandler,
} from "./types.js";

type AIRuntimeAction = Extract<
  SystemActionRequest,
  {
    readonly actionId:
      "gateway-profile.set" | "model-profile.set" | "model-binding.set";
  }
>;

function actionInput(action: SystemActionRequest): AIRuntimeAction {
  return action as AIRuntimeAction;
}

/** Creates the finite AIRuntime SystemAction handler. */
export function createAIRuntimeActionHandler(): SystemActionHandler {
  const handler: SystemActionHandler = {
    actionIds: Object.freeze([
      "gateway-profile.set",
      "model-profile.set",
      "model-binding.set",
    ]),
    normalize(request) {
      const action = actionInput(request);
      if (action.actionId === "gateway-profile.set") {
        if (action.input.gatewayProfileId !== undefined) {
          requiredUuid(
            "GatewayProfileId",
            action.input.gatewayProfileId,
            "gatewayProfileId",
          );
        }
        if (action.input.apiTokenSecretRef !== undefined) {
          if (action.input.gatewayProfileId === undefined) {
            throw invalidInputProblem(
              "A gateway token SecretRef requires an explicit gatewayProfileId",
            );
          }
          requiredUuid(
            "SecretId",
            action.input.apiTokenSecretRef.secretId,
            "apiTokenSecretRef.secretId",
          );
        }
      } else if (action.actionId === "model-profile.set") {
        if (action.input.modelProfileId !== undefined) {
          requiredUuid("ModelProfileId", action.input.modelProfileId, "modelProfileId");
        }
        requiredUuid(
          "GatewayProfileId",
          action.input.gatewayProfileId,
          "gatewayProfileId",
        );
        if (!exactModelCapabilities(action.input.consumedCapabilities)) {
          throw invalidInputProblem(
            "consumedCapabilities must be the exact current four-capability set in order",
          );
        }
      } else {
        requiredUuid("ModelProfileId", action.input.modelProfileId, "modelProfileId");
      }
      return action;
    },
    async preconditions(request, context): Promise<readonly TargetPrecondition[]> {
      const action = actionInput(request);
      if (action.actionId === "gateway-profile.set") {
        if (action.input.gatewayProfileId === undefined) return Object.freeze([]);
        const profile = await context.owners.aiRuntime.getGatewayProfile(
          action.input.gatewayProfileId,
        );
        return Object.freeze([
          precondition(
            "gateway-profile",
            action.input.gatewayProfileId,
            profile,
            "ai.gateway-profile.v1",
          ),
        ]);
      }
      if (action.actionId === "model-profile.set") {
        if (action.input.modelProfileId === undefined) return Object.freeze([]);
        const profile = await context.owners.aiRuntime.getModelProfile(
          action.input.modelProfileId,
        );
        return Object.freeze([
          precondition(
            "model-profile",
            action.input.modelProfileId,
            profile,
            "ai.model-profile.v1",
          ),
        ]);
      }
      const binding = await context.owners.aiRuntime.getModelBinding(action.input.role);
      return Object.freeze([
        precondition(
          "model-binding",
          action.input.role,
          binding,
          "ai.model-binding.v1",
        ),
      ]);
    },
    async affectedOwners(): Promise<readonly ProductSemanticId[]> {
      return Object.freeze(["system.ai-runtime" as ProductSemanticId]);
    },
    async impact() {
      return standardImpact();
    },
    async execute(request, context, expectedDigest): Promise<CanonicalJsonValue> {
      const action = actionInput(request);
      if (action.actionId === "gateway-profile.set") {
        return canonicalObject(
          await context.owners.aiRuntime.setGatewayProfile(
            {
              ...(action.input.gatewayProfileId === undefined
                ? {}
                : { gatewayProfileId: action.input.gatewayProfileId }),
              baseUrl: action.input.baseUrl,
              ...(action.input.apiTokenSecretRef === undefined
                ? {}
                : {
                    apiTokenSecretRef: secretRefFromAction(
                      action.input.apiTokenSecretRef,
                    ),
                  }),
              enabled: action.input.enabled,
            },
            expectedDigest,
          ),
        ).value;
      }
      if (action.actionId === "model-profile.set") {
        return canonicalObject(
          await context.owners.aiRuntime.setModelProfile(
            {
              ...(action.input.modelProfileId === undefined
                ? {}
                : { modelProfileId: action.input.modelProfileId }),
              gatewayProfileId: action.input.gatewayProfileId,
              modelIdentifier: action.input.modelIdentifier,
              protocol: action.input.protocol,
              consumedCapabilities: action.input.consumedCapabilities,
            },
            expectedDigest,
          ),
        ).value;
      }
      return canonicalObject(
        await context.owners.aiRuntime.setModelBinding(
          {
            role: action.input.role,
            modelProfileId: action.input.modelProfileId,
          },
          expectedDigest,
        ),
      ).value;
    },
    async verify(request, result, context) {
      const action = actionInput(request);
      if (action.actionId === "gateway-profile.set") {
        const gatewayProfileId = resultField(result, "gatewayProfileId");
        const current =
          gatewayProfileId === undefined
            ? undefined
            : await context.owners.aiRuntime.getGatewayProfile(gatewayProfileId);
        return (
          current !== undefined &&
          canonicalObject(current).canonical === canonicalValue(result)
        );
      }
      if (action.actionId === "model-profile.set") {
        const modelProfileId = resultField(result, "modelProfileId");
        const current =
          modelProfileId === undefined
            ? undefined
            : await context.owners.aiRuntime.getModelProfile(modelProfileId);
        return (
          current !== undefined &&
          canonicalObject(current).canonical === canonicalValue(result)
        );
      }
      const current = await context.owners.aiRuntime.getModelBinding(action.input.role);
      return (
        current !== undefined &&
        canonicalObject(current).canonical === canonicalValue(result)
      );
    },
    expectedDigest(request, preconditions) {
      const action = actionInput(request);
      const resourceKind =
        action.actionId === "gateway-profile.set"
          ? "gateway-profile"
          : action.actionId === "model-profile.set"
            ? "model-profile"
            : "model-binding";
      const target = preconditions.find(
        (candidate) => candidate.resource.resourceKind === resourceKind,
      );
      return target === undefined ? undefined : (target.expectedDigest ?? null);
    },
    reconcilesSubjectRuntime() {
      return true;
    },
  };
  return Object.freeze(handler);
}
