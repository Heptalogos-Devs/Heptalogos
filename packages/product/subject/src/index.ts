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
export {
  createNarrativeService,
  validateNarrativeCandidate,
  resolveNarrativeReview,
} from "./narrative.js";
export { expandWorldRoutines, worldOccurrenceId } from "./world-calendar.js";

export * from "./deliberation-contracts.js";
export { createDeliberationService } from "./deliberation.js";

export {
  createWorldHostLifecycleService,
  type WorldHostClock,
  type WorldHostLifecycleReceipt,
} from "./world-lifecycle.js";

export * from "./world-calendar-contracts.js";
export { worldCalendarWindow } from "./world-calendar-service.js";

export * from "./attention-contracts.js";
export { createSubjectAttentionService } from "./attention.js";

export * from "./reactor-contracts.js";
export { createSubjectReactorService } from "./reactor.js";

export * from "./world-profile-contracts.js";
export * from "./world-energy-contracts.js";
export {
  createWorldProfileService,
  schoolCalendarTemplate,
  previewSchoolCalendar,
} from "./world-profile.js";
export { integrateWorldEnergy } from "./world-living.js";

export * from "./situation-contracts.js";

export * from "./world-action-contracts.js";

export { readDecisionHistory } from "./deliberation.js";
export { readActivityStatements } from "./narrative.js";
