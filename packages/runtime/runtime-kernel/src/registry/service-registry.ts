// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns Service provider registration and generation-pinned leases so Runtime
 * consumers cannot use a service after its owner retires the generation.
 * @module service-registry
 */

// Intentional duplication: Service and Capability expose parallel registry
// adapters but retain separate public contracts and selection semantics.
/* jscpd:ignore-start */
import type {
  ServiceLease,
  ServiceProvisionDescriptor,
  ServiceRequirement,
} from "../model/contracts.js";
import {
  activeRegistryBindings,
  invokeRegistryBinding,
  registryBindingKey,
  RegistryStore,
  registryProviderIds,
  retireRegistryGeneration,
  type RegistryBinding,
} from "./registry-store.js";
import {
  ContractCompatibilityRegistry,
  createFencedProxy,
  GenerationFence,
  runtimeKernelProblem,
  validateSupportedContractShape,
} from "./registry-mechanics.js";
import type { ProviderId } from "@heptalogos/foundation-contracts";
import type { RuntimeActivityRunner } from "@heptalogos/execution-lineage/runtime-kernel";
/* jscpd:ignore-end */

type ServiceBinding = RegistryBinding<ServiceProvisionDescriptor>;

/** Owns Service provider registration and generation-pinned resolution. */
export class ServiceRegistry {
  private readonly bindings = new RegistryStore<ServiceBinding>();
  private readonly compatibility = new ContractCompatibilityRegistry();

  /** Registers a validated Service implementation under a generation fence. */
  register<TContract extends object>(
    descriptor: ServiceProvisionDescriptor,
    implementation: TContract,
    fence = new GenerationFence(),
    runtimeActivity?: RuntimeActivityRunner,
  ): GenerationFence {
    const key = registryBindingKey(descriptor.serviceId, descriptor.providerId);
    if (this.bindings.has(key)) {
      throw runtimeKernelProblem(
        "runtime.service.duplicate_provider",
        `Service provider '${descriptor.providerId}' is already registered for Service '${descriptor.serviceId}'`,
      );
    }
    validateSupportedContractShape(implementation);
    this.bindings.set(key, {
      descriptor,
      implementation,
      fence,
      runtimeActivity,
    });
    return fence;
  }

  /** Reports whether an eligible Service provider exists. */
  hasEligible(
    requirement: ServiceRequirement,
    explicitProviderId?: ProviderId,
  ): boolean {
    return this.selectBinding(requirement, explicitProviderId, false) !== undefined;
  }

  /** Resolves an eligible Service behind a generation-fenced proxy. */
  resolve<TContract extends object>(
    requirement: ServiceRequirement,
    explicitProviderId?: ProviderId,
  ): ServiceLease<TContract> {
    const binding = this.selectBinding(requirement, explicitProviderId, true)!;
    const proxy = createFencedProxy(
      binding.implementation,
      binding.fence,
      binding.descriptor.providerId,
    ) as TContract;
    return Object.freeze({
      serviceId: binding.descriptor.serviceId,
      providerId: binding.descriptor.providerId,
      contractVersion: binding.descriptor.contractVersion,
      async invoke<TResult>(
        operationId: string,
        call: (service: TContract) => TResult | Promise<TResult>,
      ): Promise<TResult> {
        return invokeRegistryBinding(binding, operationId, () => call(proxy), {
          kind: "service.call",
          importance: "routine",
          retentionClass: "ephemeral",
          sensitivity: "operational",
          semantic: {
            operationId,
            serviceId: binding.descriptor.serviceId,
            providerId: binding.descriptor.providerId,
            contractVersion: binding.descriptor.contractVersion,
          },
        });
      },
    });
  }

  // Intentional duplication: this wrapper preserves the Service-specific
  // public descriptor field while the shared store owns only enumeration.
  /* jscpd:ignore-start */
  /** Lists provider identities registered for a Service. */
  providerIds(
    serviceId: ServiceProvisionDescriptor["serviceId"],
  ): readonly ProviderId[] {
    return registryProviderIds(
      this.bindings,
      (descriptor) => descriptor.serviceId === serviceId,
    );
  }
  /* jscpd:ignore-end */

  /** Retires every Service binding owned by the supplied generation fence. */
  async retireGeneration(
    ownerFence: GenerationFence,
    settleTimeoutMs: number,
  ): Promise<void> {
    await retireRegistryGeneration(this.bindings, ownerFence, settleTimeoutMs);
  }

  private selectBinding(
    requirement: ServiceRequirement,
    explicitProviderId: ProviderId | undefined,
    throwOnFailure: boolean,
  ): ServiceBinding | undefined {
    // Intentional duplication: both registries filter by compatible owner
    // bindings, then apply different cardinality and failure policies.
    /* jscpd:ignore-start */
    const candidates = activeRegistryBindings(
      this.bindings,
      (binding) =>
        binding.descriptor.serviceId === requirement.serviceId &&
        this.compatibility.isCompatible(
          requirement.contract,
          binding.descriptor.contractVersion,
        ),
    );
    if (explicitProviderId !== undefined) {
      const explicit = candidates.find(
        (candidate) => candidate.descriptor.providerId === explicitProviderId,
      );
      if (explicit !== undefined) return explicit;
      if (throwOnFailure) {
        throw runtimeKernelProblem(
          "runtime.service.explicit_unavailable",
          `Explicit Service provider '${explicitProviderId}' is unavailable or incompatible`,
        );
      }
      return undefined;
    }
    /* jscpd:ignore-end */
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) {
      if (throwOnFailure) {
        throw runtimeKernelProblem(
          "runtime.service.missing",
          `No eligible provider exists for Service '${requirement.serviceId}'`,
        );
      }
      return undefined;
    }
    if (throwOnFailure) {
      throw runtimeKernelProblem(
        "runtime.service.ambiguous_provider",
        `More than one eligible provider exists for Service '${requirement.serviceId}'`,
      );
    }
    return undefined;
  }
}
