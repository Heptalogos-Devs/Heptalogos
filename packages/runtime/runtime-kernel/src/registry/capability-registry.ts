// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns Capability provider registration and generation-scoped leases so a
 * consumer cannot retain a capability after its runtime generation retires.
 * @module capability-registry
 */

import type {
  CapabilityLease,
  CapabilityProvisionDescriptor,
  CapabilityRequirement,
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

type CapabilityBinding = RegistryBinding<CapabilityProvisionDescriptor>;

/** Owns Capability provider registration and generation-pinned resolution. */
export class CapabilityRegistry {
  private readonly bindings = new RegistryStore<CapabilityBinding>();
  private readonly compatibility = new ContractCompatibilityRegistry();

  /** Registers a validated Capability implementation under a generation fence. */
  register<TContract extends object>(
    descriptor: CapabilityProvisionDescriptor,
    implementation: TContract,
    fence = new GenerationFence(),
    runtimeActivity?: RuntimeActivityRunner,
  ): GenerationFence {
    if (!Number.isSafeInteger(descriptor.priority)) {
      throw runtimeKernelProblem(
        "runtime.capability.invalid_priority",
        "Capability provider priority must be a safe integer",
      );
    }
    const key = registryBindingKey(descriptor.capabilityId, descriptor.providerId);
    if (this.bindings.has(key)) {
      throw runtimeKernelProblem(
        "runtime.capability.duplicate_provider",
        `Capability provider '${descriptor.providerId}' is already registered`,
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

  /** Reports whether an eligible Capability provider exists. */
  hasEligible(
    requirement: CapabilityRequirement,
    explicitProviderId?: ProviderId,
  ): boolean {
    return this.selectBinding(requirement, explicitProviderId) !== undefined;
  }

  /** Resolves an eligible Capability behind a generation-fenced proxy. */
  resolve<TContract extends object>(
    requirement: CapabilityRequirement,
    explicitProviderId?: ProviderId,
  ): CapabilityLease<TContract> | undefined {
    const binding = this.selectBinding(requirement, explicitProviderId);
    if (binding === undefined) return undefined;
    const proxy = createFencedProxy(
      binding.implementation,
      binding.fence,
      binding.descriptor.providerId,
    ) as TContract;
    return Object.freeze({
      capabilityId: binding.descriptor.capabilityId,
      providerId: binding.descriptor.providerId,
      contractVersion: binding.descriptor.contractVersion,
      async invoke<TResult>(
        operationId: string,
        call: (capability: TContract) => TResult | Promise<TResult>,
      ): Promise<TResult> {
        return invokeRegistryBinding(binding, operationId, () => call(proxy), {
          kind: "capability.invoke",
          importance: "routine",
          retentionClass: "ephemeral",
          sensitivity: "operational",
          semantic: {
            operationId,
            capabilityId: binding.descriptor.capabilityId,
            providerId: binding.descriptor.providerId,
            contractVersion: binding.descriptor.contractVersion,
          },
        });
      },
    });
  }

  /** Lists provider identities registered for a Capability. */
  providerIds(
    capabilityId: CapabilityProvisionDescriptor["capabilityId"],
  ): readonly ProviderId[] {
    return registryProviderIds(
      this.bindings,
      (descriptor) => descriptor.capabilityId === capabilityId,
    );
  }

  /** Retires every Capability binding owned by the supplied generation fence. */
  async retireGeneration(
    ownerFence: GenerationFence,
    settleTimeoutMs: number,
  ): Promise<void> {
    await retireRegistryGeneration(this.bindings, ownerFence, settleTimeoutMs);
  }

  private selectBinding(
    requirement: CapabilityRequirement,
    explicitProviderId: ProviderId | undefined,
  ): CapabilityBinding | undefined {
    const candidates = activeRegistryBindings(
      this.bindings,
      (binding) =>
        binding.descriptor.capabilityId === requirement.capabilityId &&
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
      return undefined;
    }
    const selected = [...candidates].sort((left, right) => {
      if (left.descriptor.priority !== right.descriptor.priority) {
        return right.descriptor.priority - left.descriptor.priority;
      }
      return left.descriptor.providerId.localeCompare(right.descriptor.providerId);
    })[0];
    if (selected !== undefined) return selected;
    return undefined;
  }
}
