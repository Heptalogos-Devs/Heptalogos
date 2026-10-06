// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns Runtime Kernel supervision, activation, reconciliation, and retirement over
 * the desired graph while delegating generic resource mechanics to Substrate.
 * @module supervisor
 */

import {
  createMicroSystemInstanceId,
  type ContributionId,
  type ProviderId,
} from "@heptalogos/foundation-contracts";
import type { RuntimeExecutionOrigin } from "@heptalogos/execution-lineage/runtime-kernel";
import type {
  ActivationResourceScope,
  RuntimeSubstrate,
  SubstrateActivationHandle,
} from "@heptalogos/runtime-substrate";
import { CapabilityRegistry } from "./registry/capability-registry.js";
import { GenerationFence } from "./generation/generation-fence.js";
import type {
  CapabilityId,
  CapabilityProvisionDescriptor,
  DesiredRuntimeSnapshot,
  MicroSystemActivationContext,
  MicroSystemActualState,
  MicroSystemDefinition,
  MicroSystemId,
  ReadinessProfileDefinition,
  ReadinessResult,
  RuntimeOwnerLifecycle,
  RuntimeKernelReadOnlySnapshot,
  ServiceId,
  ServiceProvisionDescriptor,
} from "./model/contracts.js";
import type {
  RuntimeWorkHandler,
  WorkHandlerProvisionDescriptor,
} from "./model/work-handler-contracts.js";
import { runtimeKernelProblem } from "./problems.js";
import type { ReconcileAction, ReconcilePlan } from "./reconciliation/reconciler.js";
import { RuntimeReconciler } from "./reconciliation/reconciler.js";
import { RuntimeGraph } from "./reconciliation/runtime-graph.js";
import { evaluateReadiness } from "./reconciliation/readiness.js";
import { ServiceRegistry } from "./registry/service-registry.js";
import type { RuntimeLifecycleLineage } from "./reconciliation/lifecycle-lineage.js";
import {
  WorkHandlerRegistry,
  workHandlerDescriptorsEqual,
} from "./registry/work-handler-registry.js";

interface RunningSystem {
  readonly definition: MicroSystemDefinition;
  readonly instanceId: ReturnType<typeof createMicroSystemInstanceId>;
  readonly fence: GenerationFence;
  readonly handle: SubstrateActivationHandle;
  readonly serviceProviderIds: readonly ProviderId[];
  readonly capabilityProviderIds: readonly ProviderId[];
}

interface UnsettledRetirement {
  readonly fence: GenerationFence;
  readonly serviceIds: readonly ServiceId[];
}

interface BackgroundFailureEvent {
  readonly microSystemId: MicroSystemId;
  readonly instanceId: ReturnType<typeof createMicroSystemInstanceId>;
  readonly fence: GenerationFence;
  readonly cause: unknown;
}

/** Supplies substrate, registry, lifecycle, and retirement policy to supervision. */
export interface MicroSystemSupervisorOptions {
  readonly substrate: RuntimeSubstrate;
  readonly settleTimeoutMs: number;
  readonly serviceRegistry?: ServiceRegistry;
  readonly capabilityRegistry?: CapabilityRegistry;
  readonly workHandlerRegistry?: WorkHandlerRegistry;
  readonly definitions?: readonly MicroSystemDefinition[];
  readonly lifecycleLineage?: RuntimeLifecycleLineage;
  readonly rootRuntimeOrigin?: RuntimeExecutionOrigin;
  readonly ownerLifecycle?: RuntimeOwnerLifecycle;
}

function captureDesiredRuntimeSnapshot(
  input: DesiredRuntimeSnapshot,
): DesiredRuntimeSnapshot {
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw runtimeKernelProblem(
      "runtime.supervisor.invalid_revision",
      "DesiredRuntimeSnapshot revision must be a non-negative safe integer",
    );
  }
  return Object.freeze({
    revision: input.revision,
    operatingMode: input.operatingMode,
    desired: new Map(input.desired),
    serviceBindings: new Map(input.serviceBindings),
    capabilityBindings: new Map(input.capabilityBindings),
  });
}

type SupervisorLifecycleState = "ACTIVE" | "CLOSING" | "CLOSED" | "FAILED";

/** Supervises Runtime graph activation, readiness, and retirement. */
export class MicroSystemSupervisor {
  readonly services: ServiceRegistry;
  readonly capabilities: CapabilityRegistry;
  readonly workHandlers: WorkHandlerRegistry;
  private readonly definitions = new Map<MicroSystemId, MicroSystemDefinition>();
  private readonly actual = new Map<MicroSystemId, MicroSystemActualState>();
  private readonly running = new Map<MicroSystemId, RunningSystem>();
  private readonly unsettledRetirements = new Map<MicroSystemId, UnsettledRetirement>();
  private readonly reconciler = new RuntimeReconciler();
  private readonly serviceBindings = new Map<ServiceId, ProviderId>();
  private readonly desiredServiceBindings = new Map<ServiceId, ProviderId>();
  private readonly capabilityBindings = new Map<CapabilityId, ProviderId>();
  private operatingMode: import("./model/contracts.js").OperatingMode = "NORMAL";
  private desiredRevision = 0;
  private mutationChain: Promise<void> = Promise.resolve();
  private lifecycleState: SupervisorLifecycleState = "ACTIVE";
  private readonly startingFences = new Set<GenerationFence>();
  private readonly startingActivationControllers = new Set<AbortController>();
  private terminalClosePromise: Promise<void> | undefined;
  private readonly ownerAbortListener: (() => void) | undefined;
  private ownerTerminalFailureReported = false;

  /** Creates a supervisor and registers its initial MicroSystem definitions. */
  constructor(private readonly options: MicroSystemSupervisorOptions) {
    this.services = options.serviceRegistry ?? new ServiceRegistry();
    this.capabilities = options.capabilityRegistry ?? new CapabilityRegistry();
    this.workHandlers = options.workHandlerRegistry ?? new WorkHandlerRegistry();
    for (const definition of options.definitions ?? []) this.register(definition);
    if (options.ownerLifecycle !== undefined) {
      if (options.ownerLifecycle.signal.aborted) {
        this.ownerAbortListener = undefined;
        void this.beginTerminalClose(true).catch(() => undefined);
      } else {
        const listener = () => {
          void this.beginTerminalClose(true).catch(() => undefined);
        };
        this.ownerAbortListener = listener;
        options.ownerLifecycle.signal.addEventListener("abort", listener, {
          once: true,
        });
      }
    } else {
      this.ownerAbortListener = undefined;
    }
  }

  /** Registers one MicroSystem definition before reconciliation. */
  register(definition: MicroSystemDefinition): void {
    if (this.definitions.has(definition.microSystemId)) {
      throw runtimeKernelProblem(
        "runtime.supervisor.duplicate_definition",
        `MicroSystem '${definition.microSystemId}' is already registered`,
      );
    }
    this.definitions.set(definition.microSystemId, definition);
    this.actual.set(definition.microSystemId, "STOPPED");
  }

  /** Returns the current observed state for one MicroSystem. */
  getActualState(microSystemId: MicroSystemId): MicroSystemActualState {
    return this.actual.get(microSystemId) ?? "STOPPED";
  }

  /** Returns a snapshot of all observed MicroSystem states. */
  getActualSnapshot(): ReadonlyMap<MicroSystemId, MicroSystemActualState> {
    return new Map(this.actual);
  }

  /** Reports whether this supervisor still admits and serves current Runtime work. */
  isActive(): boolean {
    return this.lifecycleState === "ACTIVE";
  }

  /** Returns a detached, data-only snapshot for Management read projections. */
  getReadOnlySnapshot(): RuntimeKernelReadOnlySnapshot {
    const systems = [...this.definitions.values()]
      .sort((left, right) => left.microSystemId.localeCompare(right.microSystemId))
      .map((definition) =>
        Object.freeze({
          microSystemId: definition.microSystemId,
          role: definition.role,
          actualState: this.getActualState(definition.microSystemId),
          generation: Object.freeze({ ...definition.generation }),
          serviceRequirements: Object.freeze(
            definition.serviceRequirements.map((requirement) => ({
              serviceId: requirement.serviceId,
              contractVersion: requirement.contract.version,
            })),
          ),
          serviceProvisions: Object.freeze(
            definition.serviceProvisions.map((provision) => ({ ...provision })),
          ),
          capabilityRequirements: Object.freeze(
            definition.capabilityRequirements.map((requirement) => ({
              capabilityId: requirement.capabilityId,
              contractVersion: requirement.contract.version,
              required: requirement.required,
            })),
          ),
          capabilityProvisions: Object.freeze(
            definition.capabilityProvisions.map((provision) => ({ ...provision })),
          ),
        }),
      );
    return Object.freeze({
      operatingMode: this.operatingMode,
      desiredRevision: this.desiredRevision,
      systems: Object.freeze(systems),
      selectedServiceBindings: Object.freeze(
        [...this.serviceBindings.entries()].map(([id, providerId]) => ({
          id,
          providerId,
        })),
      ),
      selectedCapabilityBindings: Object.freeze(
        [...this.capabilityBindings.entries()].map(([id, providerId]) => ({
          id,
          providerId,
        })),
      ),
    });
  }

  /** Evaluates a readiness profile against current Runtime bindings. */
  evaluateReadiness(profile: ReadinessProfileDefinition): ReadinessResult {
    return evaluateReadiness(
      profile,
      this.services,
      this.capabilities,
      this.desiredServiceBindings,
      this.capabilityBindings,
    );
  }

  /** Returns a registered MicroSystem definition or raises a typed Problem. */
  getDefinition(microSystemId: MicroSystemId): MicroSystemDefinition {
    const definition = this.definitions.get(microSystemId);
    if (definition === undefined) {
      throw runtimeKernelProblem(
        "runtime.supervisor.unknown_system",
        `Unknown MicroSystem '${microSystemId}'`,
      );
    }
    return definition;
  }

  /** Serializes and applies one desired Runtime reconciliation. */
  async reconcile(input: DesiredRuntimeSnapshot): Promise<ReconcilePlan> {
    this.assertActive();
    const desired = captureDesiredRuntimeSnapshot(input);
    return this.enqueueMutation(() => this.reconcileAcceptedSnapshot(desired));
  }

  private async reconcileAcceptedSnapshot(
    desired: DesiredRuntimeSnapshot,
  ): Promise<ReconcilePlan> {
    if (this.lifecycleState !== "ACTIVE") {
      throw runtimeKernelProblem(
        "runtime.supervisor.not_active",
        "Runtime supervisor does not admit reconciliation in its current lifecycle state",
      );
    }
    const previousOperatingMode = this.operatingMode;
    const result = this.reconciler.plan({
      definitions: [...this.definitions.values()],
      desired,
      actual: this.actual,
      services: this.services,
      capabilities: this.capabilities,
      currentServiceBindings: this.serviceBindings,
      currentCapabilityBindings: this.capabilityBindings,
    });
    this.operatingMode = desired.operatingMode;
    this.desiredRevision = desired.revision;
    const blockedTransition = [...result.blocked.keys()].some(
      (microSystemId) => this.getActualState(microSystemId) !== "BLOCKED",
    );
    const changesState =
      previousOperatingMode !== desired.operatingMode ||
      result.actions.length > 0 ||
      blockedTransition;
    const execute = async (): Promise<void> => {
      try {
        await this.executePlan(result);
      } finally {
        for (const serviceId of this.serviceBindings.keys()) {
          if (!result.serviceBindings.has(serviceId)) {
            this.serviceBindings.delete(serviceId);
          }
        }
        for (const [serviceId, providerId] of result.serviceBindings) {
          this.serviceBindings.set(serviceId, providerId);
        }
        for (const serviceId of this.desiredServiceBindings.keys()) {
          if (!result.desiredServiceBindings.has(serviceId)) {
            this.desiredServiceBindings.delete(serviceId);
          }
        }
        for (const [serviceId, providerId] of result.desiredServiceBindings) {
          this.desiredServiceBindings.set(serviceId, providerId);
        }
        for (const capabilityId of this.capabilityBindings.keys()) {
          if (!result.capabilityBindings.has(capabilityId)) {
            this.capabilityBindings.delete(capabilityId);
          }
        }
        for (const [capabilityId, providerId] of result.capabilityBindings) {
          this.capabilityBindings.set(capabilityId, providerId);
        }
      }
    };

    if (
      changesState &&
      this.options.lifecycleLineage !== undefined &&
      this.options.rootRuntimeOrigin !== undefined
    ) {
      await this.options.lifecycleLineage.runRetained(
        this.options.rootRuntimeOrigin,
        {
          kind: "runtime.reconcile",
          importance: "significant",
          retentionClass: "retained",
          sensitivity: "operational",
        },
        async () => execute(),
      );
    } else {
      await execute();
    }
    return result;
  }

  private async executePlan(plan: ReconcilePlan): Promise<void> {
    let firstError: unknown;
    const blockedServiceIds = this.collectUnsettledServiceIds();
    for (const action of plan.actions) {
      if (action.kind === "START" && !this.acceptsStartAdmission()) {
        throw runtimeKernelProblem(
          "runtime.supervisor.not_active",
          "Runtime supervisor admission closed before a planned MicroSystem start",
        );
      }
      if (action.kind === "START") {
        const blockedReason =
          this.generationRetirementBlockReason(action) ??
          this.hardPrerequisiteBlockReason(action, plan, blockedServiceIds);
        if (blockedReason !== undefined) {
          this.actual.set(action.microSystemId, "BLOCKED");
          continue;
        }
      }
      try {
        await this.executeAction(action);
      } catch (error) {
        firstError ??= error;
        if (action.kind === "START") {
          const blockedReason = this.hardPrerequisiteBlockReason(
            action,
            plan,
            blockedServiceIds,
          );
          const terminalState = blockedReason === undefined ? "FAILED" : "BLOCKED";
          await this.stop(action.microSystemId, terminalState).catch(() => undefined);
          this.actual.set(action.microSystemId, terminalState);
        } else if (action.kind === "STOP") {
          if (
            this.getActualState(action.microSystemId) !== "STOPPED" &&
            this.running.has(action.microSystemId)
          ) {
            this.actual.set(action.microSystemId, "FAILED");
          }
          const unsettled = this.unsettledRetirements.get(action.microSystemId);
          for (const serviceId of unsettled?.serviceIds ?? []) {
            blockedServiceIds.add(serviceId);
          }
        } else if ("microSystemId" in action) {
          this.actual.set(action.microSystemId, "FAILED");
        }
      }
    }
    for (const [microSystemId, reason] of plan.blocked) {
      if (this.getActualState(microSystemId) !== "RUNNING") {
        this.actual.set(microSystemId, "BLOCKED");
      }
      void reason;
    }
    if (firstError !== undefined) throw firstError;
  }

  private hardPrerequisiteBlockReason(
    action: Extract<ReconcileAction, { kind: "START" }>,
    plan: ReconcilePlan,
    blockedServiceIds: ReadonlySet<ServiceId> = new Set(),
  ): string | undefined {
    const definition = this.getDefinition(action.microSystemId);
    for (const requirement of definition.serviceRequirements) {
      if (blockedServiceIds.has(requirement.serviceId)) {
        return "runtime.service.blocked_dependency";
      }
      const providerId = plan.serviceBindings.get(requirement.serviceId);
      if (providerId === undefined) {
        return "runtime.service.missing";
      }

      const provider = [...this.definitions.values()].find((candidate) =>
        candidate.serviceProvisions.some(
          (provision) =>
            provision.serviceId === requirement.serviceId &&
            provision.providerId === providerId &&
            provision.contractVersion === requirement.contract.version,
        ),
      );
      if (
        provider === undefined ||
        this.getActualState(provider.microSystemId) !== "RUNNING" ||
        !this.services.hasEligible(requirement, providerId)
      ) {
        return "runtime.service.blocked_dependency";
      }
    }
    return undefined;
  }

  private generationRetirementBlockReason(
    action: Extract<ReconcileAction, { kind: "START" }>,
  ): string | undefined {
    const retirement = this.unsettledRetirements.get(action.microSystemId);
    if (retirement === undefined) return undefined;
    if (retirement.fence.state === "RETIRED") {
      this.unsettledRetirements.delete(action.microSystemId);
      return undefined;
    }
    return "runtime.generation.settlement_timeout";
  }

  private collectUnsettledServiceIds(): Set<ServiceId> {
    const serviceIds = new Set<ServiceId>();
    for (const [microSystemId, retirement] of this.unsettledRetirements) {
      if (retirement.fence.state === "RETIRED") {
        this.unsettledRetirements.delete(microSystemId);
        continue;
      }
      for (const serviceId of retirement.serviceIds) serviceIds.add(serviceId);
    }
    return serviceIds;
  }

  /** Closes the supervisor after draining active and unsettled generations. */
  close(): Promise<void> {
    return this.beginTerminalClose(false);
  }

  private beginTerminalClose(reportOwnerFailure: boolean): Promise<void> {
    if (this.terminalClosePromise !== undefined) {
      if (reportOwnerFailure) {
        void this.terminalClosePromise.catch((error) =>
          this.reportOwnerTerminalFailure(error),
        );
      }
      return this.terminalClosePromise;
    }
    if (this.lifecycleState === "CLOSED") return Promise.resolve();
    this.lifecycleState = "CLOSING";
    this.closeGenerationAdmission();
    const cleanup = this.enqueueMutation(() => this.performClose());
    this.terminalClosePromise = cleanup.then(
      () => {
        this.lifecycleState = "CLOSED";
        this.removeOwnerAbortListener();
      },
      (error) => {
        this.lifecycleState = "FAILED";
        this.removeOwnerAbortListener();
        throw error;
      },
    );
    if (reportOwnerFailure) {
      void this.terminalClosePromise.catch((error) =>
        this.reportOwnerTerminalFailure(error),
      );
    }
    return this.terminalClosePromise;
  }

  private async performClose(): Promise<void> {
    const failures: unknown[] = [];
    for (const microSystemId of this.currentShutdownOrder()) {
      try {
        await this.stop(microSystemId);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await this.options.substrate.close();
    } catch (error) {
      failures.push(error);
    }
    const unresolved = [...this.unsettledRetirements.entries()].filter(
      ([, retirement]) => retirement.fence.state !== "RETIRED",
    );
    if (unresolved.length > 0) {
      failures.push(
        runtimeKernelProblem(
          "runtime.supervisor.close_failed",
          `${unresolved.length} runtime generation retirement(s) remain unresolved`,
        ),
      );
    }
    if (failures.length > 0) {
      throw runtimeKernelProblem(
        "runtime.supervisor.close_failed",
        "Runtime supervisor close failed",
        new AggregateError(failures, "Runtime supervisor close failed"),
      );
    }
  }

  private currentShutdownOrder(): readonly MicroSystemId[] {
    let ids: readonly MicroSystemId[];
    try {
      ids = new RuntimeGraph(
        [...this.running.values()].map((running) => running.definition),
        this.serviceBindings,
      )
        .plan()
        .shutdownOrder.map((definition) => definition.microSystemId);
    } catch {
      // The Map preserves activation order; reversing it is the last-resort
      // acquisition-order projection, not a lexical ordering claim.
      ids = [...this.running.keys()].reverse();
    }
    const seen = new Set(ids);
    return [
      ...ids,
      ...[...this.running.keys()].reverse().filter((id) => !seen.has(id)),
    ];
  }

  private closeGenerationAdmission(): void {
    for (const running of this.running.values()) {
      running.fence.beginRetirement();
    }
    for (const fence of this.startingFences) fence.beginRetirement();
    for (const controller of this.startingActivationControllers) controller.abort();
  }

  private acceptsStartAdmission(): boolean {
    return this.lifecycleState === "ACTIVE";
  }

  private assertActive(): void {
    if (this.lifecycleState !== "ACTIVE") {
      throw runtimeKernelProblem(
        "runtime.supervisor.not_active",
        "Runtime supervisor does not admit this operation in its current lifecycle state",
      );
    }
  }

  private removeOwnerAbortListener(): void {
    if (
      this.options.ownerLifecycle !== undefined &&
      this.ownerAbortListener !== undefined
    ) {
      this.options.ownerLifecycle.signal.removeEventListener(
        "abort",
        this.ownerAbortListener,
      );
    }
  }

  private reportOwnerTerminalFailure(error: unknown): void {
    if (this.ownerTerminalFailureReported) return;
    this.ownerTerminalFailureReported = true;
    try {
      this.options.ownerLifecycle?.onTerminalFailure(error);
    } catch {
      // Terminal failure reporting cannot replace the cleanup outcome.
    }
  }

  private async executeAction(action: ReconcileAction): Promise<void> {
    switch (action.kind) {
      case "START":
        {
          const definition = this.getDefinition(action.microSystemId);
          const instanceId = createMicroSystemInstanceId();
          const start = () => this.start(action.microSystemId, instanceId);
          if (this.options.lifecycleLineage !== undefined) {
            await this.options.lifecycleLineage.runRetained(
              this.runtimeOrigin(definition, instanceId),
              {
                kind: "runtime.lifecycle.activate",
                importance: "significant",
                retentionClass: "retained",
                sensitivity: "operational",
                semantic: { featureId: definition.microSystemId },
              },
              async () => start(),
            );
          } else {
            await start();
          }
        }
        return;
      case "QUIESCE":
        if (this.running.has(action.microSystemId)) {
          this.actual.set(action.microSystemId, "QUIESCING");
        }
        return;
      case "STOP":
        {
          const running = this.running.get(action.microSystemId);
          const stop = () => this.stop(action.microSystemId);
          if (running !== undefined && this.options.lifecycleLineage !== undefined) {
            await this.options.lifecycleLineage.runRetained(
              this.runtimeOrigin(running.definition, running.instanceId),
              {
                kind: "runtime.lifecycle.deactivate",
                importance: "significant",
                retentionClass: "retained",
                sensitivity: "operational",
                semantic: { featureId: running.definition.microSystemId },
              },
              async () => stop(),
            );
          } else {
            await stop();
          }
        }
        return;
      case "REBIND_SERVICE":
        this.serviceBindings.set(action.serviceId, action.providerId);
        return;
      case "REBIND_CAPABILITY":
        if (action.providerId === undefined) {
          this.capabilityBindings.delete(action.capabilityId);
        } else {
          this.capabilityBindings.set(action.capabilityId, action.providerId);
        }
        return;
    }
  }

  private async start(
    microSystemId: MicroSystemId,
    instanceId = createMicroSystemInstanceId(),
  ): Promise<void> {
    if (!this.acceptsStartAdmission()) {
      throw runtimeKernelProblem(
        "runtime.supervisor.not_active",
        "Runtime supervisor admission closed before a MicroSystem start",
      );
    }
    const existing = this.running.get(microSystemId);
    if (existing !== undefined) {
      if (existing.fence.state !== "ACTIVE") {
        throw runtimeKernelProblem(
          "runtime.generation.retired",
          `MicroSystem '${microSystemId}' generation no longer admits activation`,
        );
      }
      this.actual.set(microSystemId, "RUNNING");
      return;
    }
    const definition = this.getDefinition(microSystemId);
    this.actual.set(microSystemId, "STARTING");
    const fence = new GenerationFence();
    const serviceProviderIds: ProviderId[] = [];
    const capabilityProviderIds: ProviderId[] = [];
    const publishedServiceBindings = new Set<string>();
    const publishedCapabilityBindings = new Set<string>();
    const publishedWorkHandlerBindings = new Set<string>();
    let backgroundFailure = false;
    let backgroundFailureCause: unknown;
    let activationCommitted = false;
    let handle: SubstrateActivationHandle | undefined;
    const activationController = new AbortController();
    this.startingActivationControllers.add(activationController);
    this.startingFences.add(fence);

    try {
      handle = await this.options.substrate.activate({
        label: `microsystem:${definition.microSystemId}:${instanceId}`,
        activate: async (scope) => {
          const context = this.createActivationContext(
            definition,
            instanceId,
            fence,
            scope,
            serviceProviderIds,
            capabilityProviderIds,
            publishedServiceBindings,
            publishedCapabilityBindings,
            publishedWorkHandlerBindings,
            AbortSignal.any([scope.signal, activationController.signal]),
          );
          await definition.activate(context);
          for (const provision of definition.serviceProvisions) {
            if (
              !publishedServiceBindings.has(
                `${provision.serviceId}\u0000${provision.providerId}`,
              )
            ) {
              throw runtimeKernelProblem(
                "runtime.activation.missing_service_publication",
                `MicroSystem '${definition.microSystemId}' did not publish declared Service '${provision.serviceId}'`,
              );
            }
          }
          for (const provision of definition.capabilityProvisions) {
            if (
              !publishedCapabilityBindings.has(
                `${provision.capabilityId}\u0000${provision.providerId}`,
              )
            ) {
              throw runtimeKernelProblem(
                "runtime.activation.missing_capability_publication",
                `MicroSystem '${definition.microSystemId}' did not publish declared Capability '${provision.capabilityId}'`,
              );
            }
          }
          for (const provision of definition.workHandlerProvisions ?? []) {
            if (
              !publishedWorkHandlerBindings.has(
                `${provision.contributionId}\u0000${definition.generation.packageGenerationId ?? ""}`,
              )
            ) {
              throw runtimeKernelProblem(
                "runtime.activation.missing_work_handler_publication",
                `MicroSystem '${definition.microSystemId}' did not publish declared WorkHandler '${provision.contributionId}'`,
              );
            }
          }
        },
        onFailure: (failure) => {
          if (failure.phase === "BACKGROUND") {
            this.revokeGenerationAdmission(fence);
            if (!activationCommitted) {
              backgroundFailure = true;
              backgroundFailureCause = failure.cause;
              return;
            }
            const event: BackgroundFailureEvent = {
              microSystemId,
              instanceId,
              fence,
              cause: failure.cause,
            };
            void this.enqueueMutation(() => this.handleBackgroundFailure(event)).catch(
              () => undefined,
            );
          }
        },
      });
      if (!this.acceptsStartAdmission() || fence.state !== "ACTIVE") {
        throw runtimeKernelProblem(
          "runtime.supervisor.not_active",
          `MicroSystem '${definition.microSystemId}' activation was not admitted by the Runtime supervisor`,
        );
      }
      if (backgroundFailure) {
        throw runtimeKernelProblem(
          "runtime.activation.background_failure",
          `MicroSystem '${definition.microSystemId}' observed a background failure during activation`,
          backgroundFailureCause,
        );
      }
      const running: RunningSystem = {
        definition,
        instanceId,
        fence,
        handle,
        serviceProviderIds,
        capabilityProviderIds,
      };
      this.running.set(microSystemId, running);
      activationCommitted = true;
      this.actual.set(microSystemId, "RUNNING");
    } catch (error) {
      await this.withdrawProviders(fence).catch(() => undefined);
      if (handle !== undefined) {
        await handle.dispose().catch(() => undefined);
      }
      await fence.retire(this.options.settleTimeoutMs).catch(() => undefined);
      this.actual.set(microSystemId, "FAILED");
      if (this.options.lifecycleLineage !== undefined) {
        await this.options.lifecycleLineage
          .runRetained(
            this.runtimeOrigin(definition, instanceId),
            {
              kind: "runtime.lifecycle.failure",
              importance: "critical",
              retentionClass: "retained",
              sensitivity: "operational",
              semantic: { featureId: definition.microSystemId },
            },
            async () => undefined,
          )
          .catch(() => undefined);
      }
      throw error;
    } finally {
      this.startingActivationControllers.delete(activationController);
      this.startingFences.delete(fence);
    }
  }

  private async stop(
    microSystemId: MicroSystemId,
    terminalState: "STOPPED" | "FAILED" | "BLOCKED" = "STOPPED",
  ): Promise<void> {
    const running = this.running.get(microSystemId);
    if (running === undefined) {
      const unsettled = this.unsettledRetirements.get(microSystemId);
      if (unsettled !== undefined && unsettled.fence.state !== "RETIRED") {
        this.actual.set(microSystemId, "FAILED");
        return;
      }
      this.unsettledRetirements.delete(microSystemId);
      this.actual.set(microSystemId, terminalState);
      return;
    }
    this.actual.set(microSystemId, "QUIESCING");
    this.running.delete(microSystemId);
    const serviceIds = [
      ...new Set(
        running.definition.serviceProvisions
          .filter((provision) =>
            running.serviceProviderIds.includes(provision.providerId),
          )
          .map((provision) => provision.serviceId),
      ),
    ];
    let firstError: unknown;
    try {
      await this.withdrawProviders(running.fence);
    } catch (error) {
      firstError ??= error;
    }
    try {
      await running.handle.dispose();
    } catch (error) {
      firstError ??= error;
    }
    try {
      await running.fence.retire(this.options.settleTimeoutMs);
    } catch (error) {
      firstError ??= error;
    }
    if (running.fence.state !== "RETIRED") {
      this.unsettledRetirements.set(microSystemId, {
        fence: running.fence,
        serviceIds,
      });
    }
    this.actual.set(microSystemId, firstError === undefined ? terminalState : "FAILED");
    if (firstError !== undefined) throw firstError;
  }

  private async handleBackgroundFailure(event: BackgroundFailureEvent): Promise<void> {
    const failed = this.definitions.get(event.microSystemId);
    const failedRunning = this.running.get(event.microSystemId);
    if (
      failed === undefined ||
      failedRunning === undefined ||
      failedRunning.instanceId !== event.instanceId ||
      failedRunning.fence !== event.fence
    ) {
      return;
    }
    this.actual.set(event.microSystemId, "FAILED");

    if (this.options.lifecycleLineage !== undefined) {
      await this.options.lifecycleLineage
        .runRetained(
          this.runtimeOrigin(failedRunning.definition, failedRunning.instanceId),
          {
            kind: "runtime.lifecycle.failure",
            importance: "critical",
            retentionClass: "retained",
            sensitivity: "operational",
            semantic: { featureId: failed.microSystemId },
          },
          async () => {
            throw event.cause;
          },
        )
        .catch(() => undefined);
    }

    let shutdownOrder = [...this.running.keys()].reverse();
    const dependents = new Map<MicroSystemId, Set<MicroSystemId>>();
    try {
      const currentPlan = new RuntimeGraph(
        [...this.running.values()].map((running) => running.definition),
        this.serviceBindings,
      ).plan();
      shutdownOrder = currentPlan.shutdownOrder.map(
        (definition) => definition.microSystemId,
      );
      for (const edge of currentPlan.edges) {
        let children = dependents.get(edge.provider.microSystemId);
        if (children === undefined) {
          children = new Set();
          dependents.set(edge.provider.microSystemId, children);
        }
        children.add(edge.consumer.microSystemId);
      }
    } catch {
      // The current runtime graph is expected to be valid. The activation
      // order fallback still closes the known running owner set safely.
    }

    const closure = new Set<MicroSystemId>([event.microSystemId]);
    const pending = [event.microSystemId];
    while (pending.length > 0) {
      const current = pending.shift()!;
      for (const dependent of dependents.get(current) ?? []) {
        if (closure.has(dependent)) continue;
        closure.add(dependent);
        pending.push(dependent);
      }
    }

    for (const dependentId of shutdownOrder) {
      if (dependentId === event.microSystemId || !closure.has(dependentId)) continue;
      await this.stop(dependentId, "BLOCKED").catch(() => undefined);
    }
    await this.stop(event.microSystemId, "FAILED").catch(() => undefined);
  }

  private revokeGenerationAdmission(fence: GenerationFence): void {
    fence.beginRetirement();
  }

  private enqueueMutation<TResult>(
    operation: () => TResult | Promise<TResult>,
  ): Promise<TResult> {
    const run = this.mutationChain.then(operation);
    this.mutationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async withdrawProviders(ownerFence: GenerationFence): Promise<void> {
    let firstError: unknown;
    try {
      await this.services.retireGeneration(ownerFence, this.options.settleTimeoutMs);
    } catch (error) {
      firstError ??= error;
    }
    try {
      await this.capabilities.retireGeneration(
        ownerFence,
        this.options.settleTimeoutMs,
      );
    } catch (error) {
      firstError ??= error;
    }
    try {
      await this.workHandlers.retireGeneration(
        ownerFence,
        this.options.settleTimeoutMs,
      );
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) throw firstError;
  }

  private runtimeOrigin(
    definition: MicroSystemDefinition,
    instanceId: ReturnType<typeof createMicroSystemInstanceId>,
    contributionId?: ContributionId,
  ): RuntimeExecutionOrigin {
    return {
      productGenerationId: definition.generation.productGenerationId,
      ...(definition.generation.packageGenerationId
        ? { packageGenerationId: definition.generation.packageGenerationId }
        : {}),
      microSystemId: definition.microSystemId,
      microSystemInstanceId: instanceId,
      ...(contributionId ? { contributionId } : {}),
    };
  }

  private createActivationContext(
    definition: MicroSystemDefinition,
    instanceId: ReturnType<typeof createMicroSystemInstanceId>,
    fence: GenerationFence,
    scope: ActivationResourceScope,
    serviceProviderIds: ProviderId[],
    capabilityProviderIds: ProviderId[],
    publishedServiceBindings: Set<string>,
    publishedCapabilityBindings: Set<string>,
    publishedWorkHandlerBindings: Set<string>,
    signal: AbortSignal,
  ): MicroSystemActivationContext {
    const runtimeActivity = this.options.lifecycleLineage?.runner(
      this.runtimeOrigin(definition, instanceId),
    );
    const declaredService = (descriptor: ServiceProvisionDescriptor): boolean =>
      definition.serviceProvisions.some(
        (candidate) =>
          candidate.serviceId === descriptor.serviceId &&
          candidate.providerId === descriptor.providerId &&
          candidate.contractVersion === descriptor.contractVersion,
      );
    const declaredCapability = (descriptor: CapabilityProvisionDescriptor): boolean =>
      definition.capabilityProvisions.some(
        (candidate) =>
          candidate.capabilityId === descriptor.capabilityId &&
          candidate.providerId === descriptor.providerId &&
          candidate.contractVersion === descriptor.contractVersion &&
          candidate.priority === descriptor.priority,
      );
    const declaredWorkHandler = (descriptor: WorkHandlerProvisionDescriptor): boolean =>
      (definition.workHandlerProvisions ?? []).some((candidate) =>
        workHandlerDescriptorsEqual(candidate, descriptor),
      );
    return {
      microSystemId: definition.microSystemId,
      microSystemInstanceId: instanceId,
      generation: definition.generation,
      operatingMode: this.operatingMode,
      scope,
      signal,
      runtimeActivity,
      requireService: (requirement) => {
        if (
          !definition.serviceRequirements.some(
            (candidate) =>
              candidate.serviceId === requirement.serviceId &&
              candidate.contract.version === requirement.contract.version,
          )
        ) {
          throw runtimeKernelProblem(
            "runtime.activation.undeclared_service_access",
            `MicroSystem '${definition.microSystemId}' requested an undeclared Service`,
          );
        }
        return this.services.resolve(
          requirement,
          this.serviceBindings.get(requirement.serviceId),
        );
      },
      resolveCapability: (requirement) => {
        if (
          !definition.capabilityRequirements.some(
            (candidate) =>
              candidate.capabilityId === requirement.capabilityId &&
              candidate.contract.version === requirement.contract.version,
          )
        ) {
          throw runtimeKernelProblem(
            "runtime.activation.undeclared_capability_access",
            `MicroSystem '${definition.microSystemId}' requested an undeclared Capability`,
          );
        }
        return this.capabilities.resolve(
          requirement,
          this.capabilityBindings.get(requirement.capabilityId),
        );
      },
      publishService: (descriptor, implementation) => {
        fence.assertActive();
        if (!declaredService(descriptor)) {
          throw runtimeKernelProblem(
            "runtime.activation.undeclared_service_publication",
            `MicroSystem '${definition.microSystemId}' published an undeclared Service`,
          );
        }
        const bindingKey = `${descriptor.serviceId}\u0000${descriptor.providerId}`;
        if (publishedServiceBindings.has(bindingKey)) {
          throw runtimeKernelProblem(
            "runtime.activation.duplicate_service_publication",
            `MicroSystem '${definition.microSystemId}' published a Service twice`,
          );
        }
        this.services.register(descriptor, implementation, fence, runtimeActivity);
        publishedServiceBindings.add(bindingKey);
        serviceProviderIds.push(descriptor.providerId);
      },
      publishCapability: (descriptor, implementation) => {
        fence.assertActive();
        if (!declaredCapability(descriptor)) {
          throw runtimeKernelProblem(
            "runtime.activation.undeclared_capability_publication",
            `MicroSystem '${definition.microSystemId}' published an undeclared Capability`,
          );
        }
        const bindingKey = `${descriptor.capabilityId}\u0000${descriptor.providerId}`;
        if (publishedCapabilityBindings.has(bindingKey)) {
          throw runtimeKernelProblem(
            "runtime.activation.duplicate_capability_publication",
            `MicroSystem '${definition.microSystemId}' published a Capability twice`,
          );
        }
        this.capabilities.register(descriptor, implementation, fence, runtimeActivity);
        publishedCapabilityBindings.add(bindingKey);
        capabilityProviderIds.push(descriptor.providerId);
      },
      publishWorkHandler: (
        descriptor: WorkHandlerProvisionDescriptor,
        implementation: RuntimeWorkHandler,
      ) => {
        fence.assertActive();
        const packageGenerationId = definition.generation.packageGenerationId;
        if (packageGenerationId === undefined) {
          throw runtimeKernelProblem(
            "runtime.work_handler.package_generation_required",
            `MicroSystem '${definition.microSystemId}' must have a PackageGenerationId to publish a WorkHandler`,
          );
        }
        if (!declaredWorkHandler(descriptor)) {
          throw runtimeKernelProblem(
            "runtime.activation.undeclared_work_handler_publication",
            `MicroSystem '${definition.microSystemId}' published an undeclared WorkHandler`,
          );
        }
        const bindingKey = `${descriptor.contributionId}\u0000${packageGenerationId}`;
        if (publishedWorkHandlerBindings.has(bindingKey)) {
          throw runtimeKernelProblem(
            "runtime.activation.duplicate_work_handler_publication",
            `MicroSystem '${definition.microSystemId}' published a WorkHandler twice`,
          );
        }
        const contributionActivity = this.options.lifecycleLineage?.runner(
          this.runtimeOrigin(definition, instanceId, descriptor.contributionId),
        );
        this.workHandlers.register(
          {
            microSystemId: definition.microSystemId,
            productGenerationId: definition.generation.productGenerationId,
            packageGenerationId,
          },
          descriptor,
          implementation,
          fence,
          contributionActivity,
        );
        publishedWorkHandlerBindings.add(bindingKey);
      },
    };
  }
}
