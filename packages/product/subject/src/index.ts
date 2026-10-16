// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product Life and behavior authority; cognition and agent execution are external owners.
 * @packageDocumentation
 */
export * from "./contracts.js";
export { createLifeService, assertScopeWithin } from "./life.js";
export { subjectProblem } from "./problems.js";

export * from "./agency-contracts.js";
export { createAgencyService } from "./agency.js";
