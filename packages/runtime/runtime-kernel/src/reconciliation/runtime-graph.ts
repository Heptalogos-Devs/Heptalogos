// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builds the deterministic Runtime dependency graph through Graphlib, leaving
 * graph mechanics behind a semantic plan consumed by reconciliation.
 * @module runtime-graph
 */

import { alg, Graph } from "@dagrejs/graphlib";
import type {
  ContractVersion,
  MicroSystemDefinition,
  ProviderId,
  ServiceId,
} from "../model/contracts.js";
import { ContractCompatibilityRegistry } from "../model/contract-compatibility.js";
import { runtimeKernelProblem } from "../problems.js";

/** Reports deterministic start/shutdown order and hard Service dependency edges. */
export interface RuntimeGraphPlan {
  readonly startOrder: readonly MicroSystemDefinition[];
  readonly shutdownOrder: readonly MicroSystemDefinition[];
  readonly edges: readonly {
    readonly provider: MicroSystemDefinition;
    readonly consumer: MicroSystemDefinition;
    readonly serviceId: ServiceId;
    readonly providerId: ProviderId;
    readonly contractVersion: ContractVersion;
  }[];
}

/** Builds the hard Service dependency graph for one desired Runtime set. */
export class RuntimeGraph {
  private readonly graph = new Graph<{ readonly microSystemId: string }>({
    directed: true,
  });
  private readonly definitions = new Map<string, MicroSystemDefinition>();
  private readonly edges: RuntimeGraphPlan["edges"] = [];
  private readonly compatibility = new ContractCompatibilityRegistry();

  /** Validates definitions and constructs deterministic dependency edges. */
  constructor(
    definitions: readonly MicroSystemDefinition[],
    explicitServiceBindings: ReadonlyMap<ServiceId, ProviderId> = new Map(),
  ) {
    const ordered = [...definitions].sort((left, right) =>
      left.microSystemId.localeCompare(right.microSystemId),
    );
    for (const definition of ordered) {
      if (this.definitions.has(definition.microSystemId)) {
        throw runtimeKernelProblem(
          "runtime.graph.duplicate_node",
          `MicroSystem '${definition.microSystemId}' is registered more than once`,
        );
      }
      this.definitions.set(definition.microSystemId, definition);
      this.graph.setNode(definition.microSystemId, {
        microSystemId: definition.microSystemId,
      });
    }

    for (const consumer of ordered) {
      const requirements = [...consumer.serviceRequirements].sort((left, right) =>
        left.serviceId.localeCompare(right.serviceId),
      );
      for (const requirement of requirements) {
        const explicitProviderId = explicitServiceBindings.get(requirement.serviceId);
        const candidates = ordered.flatMap((provider) =>
          provider.serviceProvisions
            .filter(
              (provision) =>
                provision.serviceId === requirement.serviceId &&
                this.compatibility.isCompatible(
                  requirement.contract,
                  provision.contractVersion,
                ) &&
                (explicitProviderId === undefined ||
                  provision.providerId === explicitProviderId),
            )
            .map((provision) => ({ provider, provision })),
        );
        if (candidates.length === 0) {
          throw runtimeKernelProblem(
            explicitProviderId === undefined
              ? "runtime.service.missing"
              : "runtime.service.explicit_unavailable",
            `No eligible provider exists for Service '${requirement.serviceId}'`,
          );
        }
        if (candidates.length > 1) {
          throw runtimeKernelProblem(
            "runtime.service.ambiguous_provider",
            `More than one eligible provider exists for Service '${requirement.serviceId}'`,
          );
        }
        const [{ provider, provision }] = candidates;
        this.graph.setEdge(provider.microSystemId, consumer.microSystemId, {
          serviceId: requirement.serviceId,
          providerId: provision.providerId,
          contractVersion: provision.contractVersion,
        });
        (this.edges as Array<RuntimeGraphPlan["edges"][number]>).push({
          provider,
          consumer,
          serviceId: requirement.serviceId,
          providerId: provision.providerId,
          contractVersion: provision.contractVersion,
        });
      }
    }
  }

  /** Returns topological start order and its reverse shutdown order. */
  plan(): RuntimeGraphPlan {
    let orderedIds: string[];
    try {
      orderedIds = alg.topsort(this.graph);
    } catch (cause) {
      throw runtimeKernelProblem(
        "runtime.graph.hard_service_cycle",
        "RuntimeGraph contains a hard Service dependency cycle",
        cause,
      );
    }
    const startOrder = orderedIds.map((id) => this.definitions.get(id)!);
    return Object.freeze({
      startOrder: Object.freeze(startOrder),
      shutdownOrder: Object.freeze([...startOrder].reverse()),
      edges: Object.freeze(
        [...this.edges].sort((left, right) => {
          const providerOrder = left.provider.microSystemId.localeCompare(
            right.provider.microSystemId,
          );
          return providerOrder !== 0
            ? providerOrder
            : left.consumer.microSystemId.localeCompare(right.consumer.microSystemId);
        }),
      ),
    });
  }
}
