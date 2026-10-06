// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines Runtime Kernel MicroSystem, Service, Capability, generation, and
 * reconciliation contracts while hiding substrate and statechart mechanics.
 * @module contracts
 */

import type { ActivationResourceScope } from "@heptalogos/runtime-substrate";
import type { RuntimeActivityRunner } from "@heptalogos/execution-lineage/runtime-kernel";
import type {
  RuntimeWorkHandler,
  WorkHandlerProvisionDescriptor,
} from "./work-handler-contracts.js";
import type {
  Branded,
  CapabilityId,
  MicroSystemId,
  MicroSystemInstanceId,
  PackageGenerationId,
  ProductGenerationId,
  ProviderId,
  ServiceId,
} from "@heptalogos/foundation-contracts";

export type { CapabilityId, MicroSystemId, ProviderId, ServiceId };

/** Brands the version negotiated by a Runtime Service or Capability contract. */
export type ContractVersion = Branded<string, "ContractVersion">;
/** Describes the supported contract version range for a requirement. */
export type ContractVersionRange = {
  readonly kind: "exact";
  readonly version: ContractVersion;
};

/** Classifies the semantic role of a MicroSystem in the Runtime graph. */
export type MicroSystemRole =
  "kernel" | "system-service" | "domain-engine" | "feature" | "driver" | "provider";

/** Selects the operating mode supplied to an activated MicroSystem. */
export type OperatingMode = "NORMAL" | "SAFE" | "MAINTENANCE" | "EMERGENCY_READ_ONLY";

/** Identifies the product and optional package generation being activated. */
export interface RuntimeGenerationRef {
  readonly productGenerationId: ProductGenerationId;
  readonly packageGenerationId?: PackageGenerationId;
}

/** Declares a required Service contract for a MicroSystem. */
export interface ServiceRequirement {
  readonly serviceId: ServiceId;
  readonly contract: ContractVersionRange;
}

/** Declares a required or optional Capability contract. */
export interface CapabilityRequirement {
  readonly capabilityId: CapabilityId;
  readonly contract: ContractVersionRange;
  readonly required: boolean;
}

/** Declares a Service provider published by a MicroSystem. */
export interface ServiceProvisionDescriptor {
  readonly serviceId: ServiceId;
  readonly contractVersion: ContractVersion;
  readonly providerId: ProviderId;
}

/** Declares a prioritized Capability provider published by a MicroSystem. */
export interface CapabilityProvisionDescriptor {
  readonly capabilityId: CapabilityId;
  readonly contractVersion: ContractVersion;
  readonly providerId: ProviderId;
  readonly priority: number;
}

/**
 * Runtime Service/Capability contracts are trusted semantic contracts, not a
 * general JavaScript object-capability membrane. Provider operations are
 * methods; their boundary values are plain data or nested contract objects.
 * Runtime publication/invocation validation is authoritative because
 * TypeScript interfaces are erased.
 */
export type RuntimeContractData =
  | null
  | undefined
  | string
  | number
  | boolean
  | bigint
  | readonly RuntimeContractData[]
  | { readonly [key: string]: RuntimeContractData };

/** Describes a callable member whose inputs and outputs stay plain data. */
export type RuntimeContractMethod = (
  ...args: readonly RuntimeContractData[]
) =>
  | RuntimeContractData
  | RuntimeContractObject
  | Promise<RuntimeContractData | RuntimeContractObject>;

/** Describes the readonly data/method object surface accepted by Runtime. */
export type RuntimeContractObject = {
  readonly [key: string]: RuntimeContractData | RuntimeContractMethod;
};

/** Provides a generation-fenced Service operation selector to consumers. */
export interface ServiceLease<TContract extends object> {
  readonly serviceId: ServiceId;
  readonly providerId: ProviderId;
  readonly contractVersion: ContractVersion;
  /** Invokes a consumer-selected operation while the lease is active. */
  invoke<TResult>(
    operationId: string,
    // This callback is the consumer-side operation selector. Functions do not
    // cross into the provider contract as method arguments or results.
    call: (service: TContract) => TResult | Promise<TResult>,
  ): Promise<TResult>;
}

/** Provides a generation-fenced Capability operation selector to consumers. */
export interface CapabilityLease<TContract extends object> {
  readonly capabilityId: CapabilityId;
  readonly providerId: ProviderId;
  readonly contractVersion: ContractVersion;
  /** Invokes a consumer-selected operation while the lease is active. */
  invoke<TResult>(
    operationId: string,
    // This callback is the consumer-side operation selector. Functions do not
    // cross into the provider contract as method arguments or results.
    call: (capability: TContract) => TResult | Promise<TResult>,
  ): Promise<TResult>;
}

/** Supplies an activated MicroSystem with owned runtime resources and registries. */
export interface MicroSystemActivationContext {
  readonly microSystemId: MicroSystemId;
  readonly microSystemInstanceId: MicroSystemInstanceId;
  readonly generation: RuntimeGenerationRef;
  readonly operatingMode: OperatingMode;
  readonly scope: ActivationResourceScope;
  readonly signal: AbortSignal;
  readonly runtimeActivity?: RuntimeActivityRunner;
  /** Resolves a required Service or raises the owning runtime Problem. */
  requireService<TContract extends object>(
    requirement: ServiceRequirement,
  ): ServiceLease<TContract>;
  /** Resolves an eligible Capability for this generation. */
  resolveCapability<TContract extends object>(
    requirement: CapabilityRequirement,
  ): CapabilityLease<TContract> | undefined;
  /** Publishes a validated Service implementation into the current generation. */
  publishService<TContract extends object>(
    descriptor: ServiceProvisionDescriptor,
    implementation: TContract,
  ): void;
  /** Publishes a validated Capability implementation into the current generation. */
  publishCapability<TContract extends object>(
    descriptor: CapabilityProvisionDescriptor,
    implementation: TContract,
  ): void;
  /** Publishes a generation-pinned WorkHandler declaration and implementation. */
  publishWorkHandler(
    descriptor: WorkHandlerProvisionDescriptor,
    implementation: RuntimeWorkHandler,
  ): void;
}

/** Declares the desired activation, dependencies, and providers of a MicroSystem. */
export interface MicroSystemDefinition {
  readonly microSystemId: MicroSystemId;
  readonly role: MicroSystemRole;
  readonly generation: RuntimeGenerationRef;
  readonly operatingModes: readonly OperatingMode[];
  readonly serviceRequirements: readonly ServiceRequirement[];
  readonly capabilityRequirements: readonly CapabilityRequirement[];
  readonly serviceProvisions: readonly ServiceProvisionDescriptor[];
  readonly capabilityProvisions: readonly CapabilityProvisionDescriptor[];
  readonly workHandlerProvisions?: readonly WorkHandlerProvisionDescriptor[];
  readonly activate: (context: MicroSystemActivationContext) => Promise<void>;
}

/** States whether a MicroSystem should be active in the desired snapshot. */
export type MicroSystemDesiredState = "RUNNING" | "STOPPED";

/** Canonical desired Runtime state consumed by reconciliation. */
export interface DesiredRuntimeSnapshot {
  readonly revision: number;
  readonly operatingMode: OperatingMode;
  readonly desired: ReadonlyMap<MicroSystemId, MicroSystemDesiredState>;
  readonly serviceBindings: ReadonlyMap<ServiceId, ProviderId>;
  readonly capabilityBindings: ReadonlyMap<CapabilityId, ProviderId>;
}

/** Receives terminal owner failure and exposes its cancellation signal. */
export interface RuntimeOwnerLifecycle {
  readonly signal: AbortSignal;
  /** Reports a terminal activation or lifecycle failure to the owner. */
  onTerminalFailure(error: unknown): void;
}

/** Reports the observed lifecycle state of a MicroSystem. */
export type MicroSystemActualState =
  "STOPPED" | "BLOCKED" | "STARTING" | "RUNNING" | "QUIESCING" | "FAILED";

/** Declares required and optional Runtime readiness dependencies. */
export interface ReadinessProfileDefinition {
  readonly profileId: string;
  readonly requiredServices: readonly ServiceRequirement[];
  readonly requiredCapabilities: readonly CapabilityRequirement[];
  readonly optionalCapabilities: readonly CapabilityRequirement[];
}

/** Classifies aggregate Runtime readiness. */
export type ReadinessState = "READY" | "DEGRADED" | "BLOCKED";

/** Reports readiness state and the dependencies preventing full readiness. */
export interface ReadinessResult {
  readonly profileId: string;
  readonly state: ReadinessState;
  readonly missingServices: readonly ServiceId[];
  readonly missingRequiredCapabilities: readonly CapabilityId[];
  readonly missingOptionalCapabilities: readonly CapabilityId[];
}

/** Exposes only data needed by read-only Management Runtime projections. */
export interface RuntimeKernelReadOnlySnapshot {
  readonly operatingMode: OperatingMode;
  readonly desiredRevision: number;
  readonly systems: readonly {
    readonly microSystemId: MicroSystemId;
    readonly role: MicroSystemRole;
    readonly actualState: MicroSystemActualState;
    readonly generation: RuntimeGenerationRef;
    readonly serviceRequirements: readonly {
      readonly serviceId: ServiceId;
      readonly contractVersion: ContractVersion;
    }[];
    readonly serviceProvisions: readonly ServiceProvisionDescriptor[];
    readonly capabilityRequirements: readonly {
      readonly capabilityId: CapabilityId;
      readonly contractVersion: ContractVersion;
      readonly required: boolean;
    }[];
    readonly capabilityProvisions: readonly CapabilityProvisionDescriptor[];
  }[];
  readonly selectedServiceBindings: readonly {
    readonly id: ServiceId;
    readonly providerId: ProviderId;
  }[];
  readonly selectedCapabilityBindings: readonly {
    readonly id: CapabilityId;
    readonly providerId: ProviderId;
  }[];
}
