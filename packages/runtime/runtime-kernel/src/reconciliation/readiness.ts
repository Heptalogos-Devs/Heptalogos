// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Evaluates declared Runtime readiness from service and capability state while
 * keeping readiness meaning distinct from substrate resource disposal.
 * @module readiness
 */

import type {
  CapabilityId,
  ProviderId,
  ServiceId,
} from "@heptalogos/foundation-contracts";
import type { CapabilityRegistry } from "../registry/capability-registry.js";
import type {
  ReadinessProfileDefinition,
  ReadinessResult,
} from "../model/contracts.js";
import type { ServiceRegistry } from "../registry/service-registry.js";

/** Evaluates required and optional provider bindings into an aggregate readiness result. */
export function evaluateReadiness(
  profile: ReadinessProfileDefinition,
  services: ServiceRegistry,
  capabilities: CapabilityRegistry,
  serviceBindings: ReadonlyMap<ServiceId, ProviderId>,
  capabilityBindings: ReadonlyMap<CapabilityId, ProviderId>,
): ReadinessResult {
  const missingServices = profile.requiredServices
    .filter(
      (requirement) =>
        !services.hasEligible(requirement, serviceBindings.get(requirement.serviceId)),
    )
    .map((requirement) => requirement.serviceId);
  const missingRequiredCapabilities = profile.requiredCapabilities
    .filter(
      (requirement) =>
        !capabilities.hasEligible(
          requirement,
          capabilityBindings.get(requirement.capabilityId),
        ),
    )
    .map((requirement) => requirement.capabilityId);
  const missingOptionalCapabilities = profile.optionalCapabilities
    .filter(
      (requirement) =>
        !capabilities.hasEligible(
          requirement,
          capabilityBindings.get(requirement.capabilityId),
        ),
    )
    .map((requirement) => requirement.capabilityId);
  const state =
    missingServices.length > 0 || missingRequiredCapabilities.length > 0
      ? "BLOCKED"
      : missingOptionalCapabilities.length > 0
        ? "DEGRADED"
        : "READY";
  return Object.freeze({
    profileId: profile.profileId,
    state,
    missingServices: Object.freeze(missingServices),
    missingRequiredCapabilities: Object.freeze(missingRequiredCapabilities),
    missingOptionalCapabilities: Object.freeze(missingOptionalCapabilities),
  });
}
