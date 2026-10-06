// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public Runtime Kernel contracts for graph planning, registries, readiness,
 * generation fencing, and lifecycle supervision above RuntimeSubstrate.
 * @packageDocumentation
 */

export type {
  CapabilityLease,
  CapabilityProvisionDescriptor,
  CapabilityRequirement,
  ContractVersion,
  ContractVersionRange,
  DesiredRuntimeSnapshot,
  RuntimeContractData,
  RuntimeContractMethod,
  RuntimeContractObject,
  MicroSystemActivationContext,
  MicroSystemActualState,
  MicroSystemDefinition,
  MicroSystemDesiredState,
  MicroSystemRole,
  OperatingMode,
  ReadinessProfileDefinition,
  ReadinessResult,
  ReadinessState,
  RuntimeGenerationRef,
  RuntimeKernelReadOnlySnapshot,
  RuntimeOwnerLifecycle,
  ServiceLease,
  ServiceProvisionDescriptor,
  ServiceRequirement,
} from "./model/contracts.js";
export type {
  ResourceAdmissionClassId,
  RuntimeWorkHandler,
  RuntimeWorkHandlerInvocation,
  RuntimeWorkHandlerInvocationReservation,
  RuntimeWorkHandlerLease,
  RuntimeWorkHandlerResult,
  WorkHandlerConfigurationBindingPolicy,
  WorkHandlerPayloadContract,
  WorkHandlerProvisionDescriptor,
  WorkHandlerRestoreReplayClass,
  WorkHandlerTarget,
  WorkQueueProfileId,
} from "./model/work-handler-contracts.js";
export {
  CONTRACT_VERSION_PATTERN,
  ContractCompatibilityRegistry,
  createContractVersion,
  exactContract,
  parseContractVersion,
} from "./model/contract-compatibility.js";
export { CapabilityRegistry } from "./registry/capability-registry.js";
export {
  createGenerationFence,
  GenerationFence,
  type GenerationInvocationReservation,
  type GenerationFenceState,
} from "./generation/generation-fence.js";
export { evaluateReadiness } from "./reconciliation/readiness.js";
export { runtimeKernelProblem } from "./problems.js";
export { RuntimeGraph, type RuntimeGraphPlan } from "./reconciliation/runtime-graph.js";
export {
  RuntimeReconciler,
  type ReconcileAction,
  type ReconcileInput,
  type ReconcilePlan,
} from "./reconciliation/reconciler.js";
export { ServiceRegistry } from "./registry/service-registry.js";
export {
  canonicalizeWorkHandlerDescriptor,
  WorkHandlerRegistry,
  workHandlerDescriptorsEqual,
} from "./registry/work-handler-registry.js";
export {
  createRuntimeLifecycleLineage,
  type RuntimeLifecycleLineage,
  type RuntimeLifecycleLineageOptions,
} from "./reconciliation/lifecycle-lineage.js";
export {
  MicroSystemSupervisor,
  type MicroSystemSupervisorOptions,
} from "./supervisor.js";
