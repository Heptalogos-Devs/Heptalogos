// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product Life and behavior authority; cognition and agent execution are external owners.
 * @packageDocumentation
 */
export * from "./contracts.js";
export {
  createLifeService,
  assertScopeWithin,
  captureActivityOpportunity,
  consumeActivityOpportunity,
} from "./life.js";
export { subjectProblem } from "./problems.js";

export * from "./agency-contracts.js";
export { createAgencyService } from "./agency.js";

export * from "./pursuit-contracts.js";
export { createPursuitService } from "./pursuit.js";

export * from "./world-contracts.js";
export { createWorldLifeService, lockSubjectNarrative } from "./world-life.js";

export * from "./narrative-contracts.js";
export { createNarrativeService, validateNarrativeCandidate } from "./narrative.js";
export { expandWorldRoutines, worldOccurrenceId } from "./world-calendar.js";

export * from "./deliberation-contracts.js";
export { createDeliberationService } from "./deliberation.js";
