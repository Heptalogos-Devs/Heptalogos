// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reconciles desired Runtime snapshots into deterministic graph activation and
 * retirement operations, with generation fencing at each lifecycle boundary.
 * @module reconciler
 */

import type { CapabilityRegistry } from "../registry/capability-registry.js";
import type { CapabilityId } from "../model/contracts.js";
import type {
  DesiredRuntimeSnapshot,
  MicroSystemActualState,
  MicroSystemDefinition,
  MicroSystemId,
  ProviderId,
  ServiceId,
} from "../model/contracts.js";
import { RuntimeGraph } from "./runtime-graph.js";
import type { ServiceRegistry } from "../registry/service-registry.js";

/** Describes one deterministic Runtime reconciliation action. */
export type ReconcileAction =
  | {
      readonly kind: "QUIESCE";
      readonly microSystemId: MicroSystemId;
      readonly reason: string;
    }
  | {
      readonly kind: "STOP";
      readonly microSystemId: MicroSystemId;
      readonly reason: string;
    }
  | {
      readonly kind: "START";
      readonly microSystemId: MicroSystemId;
      readonly reason: string;
    }
  | {
      readonly kind: "REBIND_SERVICE";
      readonly serviceId: ServiceId;
      readonly providerId: ProviderId;
    }
  | {
      readonly kind: "REBIND_CAPABILITY";
      readonly capabilityId: CapabilityId;
      readonly providerId: ProviderId | undefined;
    };

/** Reports the ordered actions and bindings produced by reconciliation. */
export interface ReconcilePlan {
  readonly revision: number;
  readonly actions: readonly ReconcileAction[];
  readonly blocked: ReadonlyMap<MicroSystemId, string>;
  readonly serviceBindings: ReadonlyMap<ServiceId, ProviderId>;
  readonly desiredServiceBindings: ReadonlyMap<ServiceId, ProviderId>;
  readonly capabilityBindings: ReadonlyMap<CapabilityId, ProviderId>;
}

/** Supplies desired, actual, registry, and binding state to reconciliation. */
export interface ReconcileInput {
  readonly definitions: readonly MicroSystemDefinition[];
  readonly desired: DesiredRuntimeSnapshot;
  readonly actual: ReadonlyMap<MicroSystemId, MicroSystemActualState>;
  readonly services: ServiceRegistry;
  readonly capabilities: CapabilityRegistry;
  readonly currentServiceBindings?: ReadonlyMap<ServiceId, ProviderId>;
  readonly currentCapabilityBindings?: ReadonlyMap<CapabilityId, ProviderId>;
}

function shutdownActions(
  microSystemId: MicroSystemId,
  reason: string,
): readonly ReconcileAction[] {
  return [
    { kind: "QUIESCE", microSystemId, reason },
    { kind: "STOP", microSystemId, reason },
  ];
}

/** Plans Runtime activation, rebinding, quiescence, and retirement actions. */
export class RuntimeReconciler {
  /** Computes a deterministic plan without mutating Runtime state. */
  plan(input: ReconcileInput): ReconcilePlan {
    const definitions = [...input.definitions].sort((left, right) =>
      left.microSystemId.localeCompare(right.microSystemId),
    );
    const blocked = new Map<MicroSystemId, string>();
    const candidates = definitions.filter((definition) => {
      if (input.desired.desired.get(definition.microSystemId) !== "RUNNING") {
        return false;
      }
      if (!definition.operatingModes.includes(input.desired.operatingMode)) {
        blocked.set(definition.microSystemId, "runtime.operating_mode.ineligible");
        return false;
      }
      return true;
    });

    let resolvable = new Set(candidates);
    let changed = true;
    while (changed) {
      changed = false;
      for (const definition of [...resolvable]) {
        for (const requirement of definition.serviceRequirements) {
          const explicit = input.desired.serviceBindings.get(requirement.serviceId);
          const providers = [...resolvable].flatMap((provider) =>
            provider.serviceProvisions
              .filter(
                (provision) =>
                  provision.serviceId === requirement.serviceId &&
                  provision.contractVersion === requirement.contract.version &&
                  (explicit === undefined || provision.providerId === explicit),
              )
              .map(() => provider),
          );
          if (providers.length === 1) continue;
          blocked.set(
            definition.microSystemId,
            providers.length === 0
              ? "runtime.service.missing"
              : explicit === undefined
                ? "runtime.service.ambiguous_provider"
                : "runtime.service.explicit_unavailable",
          );
          resolvable.delete(definition);
          changed = true;
          break;
        }
      }
    }

    const graphPlan =
      resolvable.size > 0
        ? new RuntimeGraph([...resolvable], input.desired.serviceBindings).plan()
        : { startOrder: [], shutdownOrder: [], edges: [] };
    const actions: ReconcileAction[] = [];
    const currentServices = input.currentServiceBindings ?? new Map();
    const currentCapabilities = input.currentCapabilityBindings ?? new Map();
    const currentDefinitions = definitions.filter(
      (definition) =>
        (input.actual.get(definition.microSystemId) ?? "STOPPED") === "RUNNING" ||
        [...currentServices.values()].some((providerId) =>
          definition.serviceProvisions.some(
            (provision) => provision.providerId === providerId,
          ),
        ),
    );
    const currentGraphPlan =
      currentDefinitions.length > 0
        ? new RuntimeGraph(currentDefinitions, currentServices).plan()
        : { startOrder: [], shutdownOrder: [], edges: [] };
    const selectedServices = new Map<ServiceId, ProviderId>();
    for (const edge of graphPlan.edges) {
      const previous = selectedServices.get(edge.serviceId);
      if (previous !== undefined && previous !== edge.providerId) {
        blocked.set(edge.consumer.microSystemId, "runtime.service.binding_conflict");
        continue;
      }
      selectedServices.set(edge.serviceId, edge.providerId);
    }
    const selectedCapabilities = new Map(input.desired.capabilityBindings);
    const stopped = new Set<MicroSystemId>();
    const restartRequired = new Set<MicroSystemId>();
    const changedServices = new Set<ServiceId>();
    for (const serviceId of currentServices.keys()) {
      if (!selectedServices.has(serviceId)) {
        changedServices.add(serviceId);
      }
    }
    for (const [serviceId, providerId] of selectedServices) {
      if (currentServices.get(serviceId) !== providerId) {
        changedServices.add(serviceId);
      }
    }
    for (const definition of currentGraphPlan.shutdownOrder) {
      if (
        (input.actual.get(definition.microSystemId) ?? "STOPPED") === "RUNNING" &&
        definition.serviceRequirements.some((requirement) =>
          changedServices.has(requirement.serviceId),
        )
      ) {
        actions.push({
          kind: "QUIESCE",
          microSystemId: definition.microSystemId,
          reason: "hard-service-rebind",
        });
        actions.push({
          kind: "STOP",
          microSystemId: definition.microSystemId,
          reason: "hard-service-rebind",
        });
        stopped.add(definition.microSystemId);
        restartRequired.add(definition.microSystemId);
      }
    }
    for (const [serviceId, providerId] of selectedServices) {
      if (changedServices.has(serviceId)) {
        actions.push({ kind: "REBIND_SERVICE", serviceId, providerId });
      }
    }
    for (const [capabilityId, providerId] of input.desired.capabilityBindings) {
      if (currentCapabilities.get(capabilityId) !== providerId) {
        actions.push({ kind: "REBIND_CAPABILITY", capabilityId, providerId });
      }
    }
    for (const capabilityId of currentCapabilities.keys()) {
      if (!selectedCapabilities.has(capabilityId)) {
        actions.push({
          kind: "REBIND_CAPABILITY",
          capabilityId,
          providerId: undefined,
        });
      }
    }

    for (const definition of currentGraphPlan.shutdownOrder) {
      const actual = input.actual.get(definition.microSystemId) ?? "STOPPED";
      if (
        actual === "RUNNING" &&
        (input.desired.desired.get(definition.microSystemId) !== "RUNNING" ||
          blocked.has(definition.microSystemId))
      ) {
        if (stopped.has(definition.microSystemId)) continue;
        actions.push(
          ...shutdownActions(
            definition.microSystemId,
            blocked.get(definition.microSystemId) ?? "desired-stopped",
          ),
        );
        stopped.add(definition.microSystemId);
      }
    }
    // Intentional duplication: this shutdown pass uses the same action
    // projection but represents a distinct resolvability predicate.
    /* jscpd:ignore-start */
    for (const definition of currentGraphPlan.shutdownOrder) {
      const actual = input.actual.get(definition.microSystemId) ?? "STOPPED";
      if (
        actual === "RUNNING" &&
        (input.desired.desired.get(definition.microSystemId) !== "RUNNING" ||
          !resolvable.has(definition)) &&
        !stopped.has(definition.microSystemId)
      ) {
        actions.push(
          ...shutdownActions(
            definition.microSystemId,
            blocked.get(definition.microSystemId) ?? "desired-stopped",
          ),
        );
        stopped.add(definition.microSystemId);
      }
    }
    /* jscpd:ignore-end */
    for (const definition of definitions) {
      const actual = input.actual.get(definition.microSystemId) ?? "STOPPED";
      if (
        actual === "RUNNING" &&
        input.desired.desired.get(definition.microSystemId) === "RUNNING" &&
        !resolvable.has(definition) &&
        !blocked.has(definition.microSystemId)
      ) {
        blocked.set(definition.microSystemId, "runtime.service.blocked_dependency");
      }
    }
    for (const definition of graphPlan.startOrder) {
      const actual = input.actual.get(definition.microSystemId) ?? "STOPPED";
      if (actual !== "RUNNING" || restartRequired.has(definition.microSystemId)) {
        actions.push({
          kind: "START",
          microSystemId: definition.microSystemId,
          reason: "desired-running",
        });
      }
    }
    return Object.freeze({
      revision: input.desired.revision,
      actions: Object.freeze(actions),
      blocked: new Map(blocked),
      serviceBindings: new Map(selectedServices),
      desiredServiceBindings: new Map(input.desired.serviceBindings),
      capabilityBindings: new Map(selectedCapabilities),
    });
  }
}
