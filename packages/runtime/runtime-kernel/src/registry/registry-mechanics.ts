// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Exposes package-private registry and generation primitives to the supervisor
 * without widening those mechanics into the Runtime Kernel public contract.
 * @module registry-mechanics
 */

export { ContractCompatibilityRegistry } from "../model/contract-compatibility.js";
export { GenerationFence } from "../generation/generation-fence.js";
export { createFencedProxy } from "../generation/fenced-proxy.js";
export { validateSupportedContractShape } from "../model/contract-shape.js";
export { runtimeKernelProblem } from "../problems.js";
