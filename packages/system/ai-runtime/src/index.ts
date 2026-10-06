// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public current AIRuntime contracts and OpenAI-family gateway routes.
 * @packageDocumentation
 */

export {
  aiRuntimeReadinessSchema,
  CURRENT_MODEL_CAPABILITIES,
  modelBindingSchema,
  modelBindingSetInputSchema,
  modelProfileSchema,
  modelProfileSetInputSchema,
  gatewayProfileSchema,
  gatewayProfileSetInputSchema,
  type AIRuntimeMessage,
  type AIRuntimeReadiness,
  type AIRuntimeService,
  type AIRuntimeServiceOptions,
  type GenerationResult,
  type InvocationBudget,
  type InvocationId,
  type InvocationSpec,
  type ModelBinding,
  type ModelBindingCommitProvenance,
  type ModelBindingId,
  type ModelCapability,
  type ModelProfile,
  type ModelProfileId,
  type GatewayProfile,
  type GatewayProfileId,
  type ModelInvocationProtocol,
  type SetModelBindingInput,
  type SetModelProfileInput,
  type SetGatewayProfileInput,
  type UsageMetadata,
} from "./contracts.js";
export { createAIRuntimeService } from "./service.js";
