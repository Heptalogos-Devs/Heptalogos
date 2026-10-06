// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Composes the AIRuntime routing and provider invocation owners.
 * @module service
 */

import type { AIRuntimeService, AIRuntimeServiceOptions } from "./contracts.js";
import { createAIRuntimeInvocation } from "./invocation.js";
import { createAIRuntimeRouting } from "./routing.js";

/** Creates the current AIRuntime service over its semantic owner boundaries. */
export function createAIRuntimeService(
  options: AIRuntimeServiceOptions,
): AIRuntimeService {
  const routing = createAIRuntimeRouting(options);
  const invocation = createAIRuntimeInvocation(options, routing);
  const service: AIRuntimeService = {
    listGatewayProfiles: () => routing.listGatewayProfiles(),
    listModelProfiles: () => routing.listModelProfiles(),
    listModelBindings: () => routing.listModelBindings(),
    getGatewayProfile: (id) => routing.getGatewayProfile(id),
    getModelProfile: (id) => routing.getModelProfile(id),
    getModelBinding: (roleOrId) => routing.getModelBinding(roleOrId),
    setGatewayProfile: (input, expectedDigest) =>
      routing.setGatewayProfile(input, expectedDigest),
    setModelProfile: (input, expectedDigest) =>
      routing.setModelProfile(input, expectedDigest),
    setModelBinding: (input, expectedDigest) =>
      routing.setModelBinding(input, expectedDigest),
    getReadiness: () => routing.getReadiness(),
    assertGenerationAdmissibleForCommit: (transaction, provenance) =>
      routing.assertGenerationAdmissibleForCommit(transaction, provenance),
    assertModelBindingAdmissibleForCommit: (transaction, provenance) =>
      routing.assertModelBindingAdmissibleForCommit(transaction, provenance),
    invoke: (spec) => invocation.invoke(spec),
  };
  return Object.freeze(service);
}
