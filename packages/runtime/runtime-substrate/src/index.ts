// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public RuntimeSubstrate activation and disposal contracts above Cordis;
 * framework resource objects remain private to the adapter.
 * @packageDocumentation
 */

export type {
  ActivationResourceScope,
  RuntimeDisposer,
  RuntimeSubstrate,
  RuntimeSubstrateFailure,
  RuntimeSubstrateOptions,
  SubstrateActivationHandle,
  SubstrateActivationRequest,
} from "./contracts.js";
export { runtimeSubstrateProblem } from "./problems.js";
export { createRuntimeSubstrate } from "./cordis-adapter.js";
