// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns managed Host maintenance preparation, terminal retirement, and release contracts
 * while ensuring private PostgreSQL control never occurs under a closed Host.
 * @module maintenance/operation
 */

import {
  type BootstrapActivityId,
  type BootstrapJournal,
  createMaintenanceOperationId,
  type BootstrapStateBodyV1,
  type BootstrapStateEnvelopeV1,
  type MaintenanceJournalBodyV1,
  type MaintenanceOperationId,
  type MaintenanceOperationType,
  type MaintenancePhase,
} from "@heptalogos/bootstrap-state";
import {
  inspectHostOwnershipCanonicalSnapshot,
  revokeHostOwnershipTokenForBootstrap,
  type HostOwnershipCanonicalSnapshot,
  type HostOwnershipContext,
} from "@heptalogos/host-ownership";
import { openPrivatePostgresMaintenanceController } from "@heptalogos/private-postgres";
import {
  createProblemError,
  formatInstant,
  parseBootId,
  parseHostOwnershipToken,
  ProblemError,
  type BootId,
  type InstallationId,
  type InstanceId,
  type Problem,
} from "@heptalogos/foundation-contracts";
import {
  acquireBootstrapOwnership,
  type BootstrapOwnershipLease,
} from "../bootstrap/ownership.js";
import {
  openMaintenanceStateAccess,
  type OwnedMaintenanceStateAccess,
} from "./state-access.js";
import type {
  BootstrapManagedHostContext,
  HostRuntimeRetirement,
  ManagedHostOperations,
  PreparedPrivatePostgresMaintenance,
  PrivatePostgresMaintenanceRequest,
  PrivatePostgresMaintenanceResult,
} from "../host/managed-host.js";
import type { HostOwnershipHandoffOptions } from "../host/handoff.js";
import type { PrivatePostgresMaintenanceDescriptor } from "../postgres/bootstrap.js";
import type { BootstrapPathProfile } from "../bootstrap/roots.js";
import { problemCodeOf } from "../shared/problem-code.js";
import { recordBootstrapMaintenanceCompletedBestEffort } from "../shared/journal-stage.js";

type CurrentPrivatePostgresStateEnvelope = BootstrapStateEnvelopeV1 & {
  readonly state: BootstrapStateBodyV1 & {
    readonly privatePostgres: NonNullable<BootstrapStateBodyV1["privatePostgres"]>;
  };
};

const DEFAULT_BOOTSTRAP_HEARTBEAT_MS = 1_000;

/** Captures the Bootstrap context that authorizes a maintenance window. */
interface HostMaintenanceBootstrapContext {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly bootstrapActivityId: BootstrapActivityId;
  readonly paths: BootstrapPathProfile;
  readonly journal: BootstrapJournal;
}

/** Represents an entered maintenance window after the point of entry. */
export interface EnteredMaintenanceWindow {
  readonly operationId: MaintenanceOperationId;
  readonly request: PrivatePostgresMaintenanceRequest;
  readonly lease: BootstrapOwnershipLease;
  readonly access: OwnedMaintenanceStateAccess;
  readonly journal: MaintenanceJournalBodyV1;
  /** Records the current durable maintenance phase before the next side effect. */
  advance(
    phase: MaintenancePhase,
    changes?: Partial<MaintenanceJournalBodyV1>,
  ): Promise<void>;
  /** Marks the window complete after its terminal outcome is durable. */
  complete(): void;
}

/** Supplies Host, Bootstrap, handoff, and controller seams for maintenance. */
export interface HostMaintenanceOperationProvenance {
  readonly host: HostOwnershipContext;
  readonly bootstrap: HostMaintenanceBootstrapContext;
  readonly handoff: HostOwnershipHandoffOptions;
  readonly privatePostgres: PrivatePostgresMaintenanceDescriptor;
  /** Marks the managed Host non-serving before product retirement begins. */
  readonly terminalizeManagedHost?: () => void;
  readonly beginOldHostRetirement?: () => Promise<void>;
  /** Reuses the single Host handoff owner after private PostgreSQL is ready. */
  readonly reacquireHost?: (
    window: EnteredMaintenanceWindow,
    beforeBootstrapRelease: () => Promise<void>,
  ) => Promise<BootstrapManagedHostContext>;
  readonly onOldHostTerminal?: () => void;
}

/** Dispatches the selected stop or restart operation for an entered window. */
function executeHostMaintenanceWindow(
  provenance: HostMaintenanceOperationProvenance,
  window: EnteredMaintenanceWindow,
): Promise<PrivatePostgresMaintenanceResult> {
  if (window.request.kind === "STOP_PRIVATE_POSTGRES") {
    return createStopPrivatePostgresEnteredWindowExecutor(provenance)(window);
  }
  return createRestartPrivatePostgresEnteredWindowExecutor(provenance)(window);
}

function maintenanceProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "integrity",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

// Intentional duplication: maintenance and recovery each translate their
// fence values into the owner-specific Problem taxonomy.
/* jscpd:ignore-start */
function decimalRevision(value: string | number): string {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw maintenanceProblem(
    "bootstrap.maintenance.invalid_fence",
    "HostOwnershipFence revision is invalid",
    "The current HostOwnershipFence revision is not an unsigned decimal value",
  );
}
/* jscpd:ignore-end */

function stateBody(
  loaded: Awaited<ReturnType<OwnedMaintenanceStateAccess["state"]["load"]>>,
): CurrentPrivatePostgresStateEnvelope {
  if (loaded.status === "EMPTY") {
    throw maintenanceProblem(
      "bootstrap.maintenance.bootstrap_state_required",
      "BootstrapState is required for maintenance",
      "Host maintenance requires authoritative BootstrapState",
    );
  }
  if (loaded.status === "CORRUPT") throw new ProblemError(loaded.problem);
  if (loaded.status === "RECOVERED_PREVIOUS") {
    throw maintenanceProblem(
      "bootstrap.state.current_authority_required",
      "Current BootstrapState authority is required",
      "A recovered previous BootstrapState revision is inspection evidence only and cannot authorize host maintenance",
    );
  }
  if (loaded.value.state.privatePostgres === undefined) {
    throw maintenanceProblem(
      "bootstrap.maintenance.private_postgres_state_required",
      "Private PostgreSQL state is required for maintenance",
      "Maintenance requires BootstrapState with canonical private PostgreSQL identity",
    );
  }
  return loaded.value as CurrentPrivatePostgresStateEnvelope;
}

function assertPrivatePostgresIdentity(
  state: BootstrapStateBodyV1,
  descriptor: PrivatePostgresMaintenanceDescriptor,
): void {
  const persisted = state.privatePostgres;
  if (
    persisted === undefined ||
    persisted.schemaVersion !== 1 ||
    persisted.installationId !== descriptor.expectedIdentity.installationId ||
    persisted.instanceId !== descriptor.expectedIdentity.instanceId ||
    persisted.persistedPort !== descriptor.expectedIdentity.persistedPort ||
    persisted.clusterSystemIdentifier !==
      descriptor.expectedIdentity.clusterSystemIdentifier ||
    persisted.initializationProfileRevision !==
      descriptor.expectedIdentity.initializationProfileRevision
  ) {
    throw maintenanceProblem(
      "bootstrap.maintenance.private_postgres_identity_mismatch",
      "Private PostgreSQL identity does not match maintenance provenance",
      "The authoritative BootstrapState cluster identity, port, or initialization profile does not match the retained maintenance descriptor",
    );
  }
}

function assertCurrentFence(
  snapshot: HostOwnershipCanonicalSnapshot,
  host: HostOwnershipContext,
): string {
  if (snapshot.fence.length !== 1) {
    throw maintenanceProblem(
      "bootstrap.maintenance.invalid_fence",
      "HostOwnershipFence snapshot is invalid",
      "The maintenance entry snapshot did not contain exactly one HostOwnershipFence row",
    );
  }
  const row = snapshot.fence[0];
  if (
    row.instance_id !== host.instanceId ||
    row.host_ownership_token !== host.token ||
    row.boot_id !== host.bootId ||
    parseHostOwnershipToken(row.host_ownership_token) !== host.token ||
    parseBootId(row.boot_id) !== host.bootId
  ) {
    throw maintenanceProblem(
      "bootstrap.maintenance.fence_mismatch",
      "HostOwnershipFence does not match the current Host",
      "The maintenance entry snapshot did not prove the exact current Host token, BootId, and InstanceId",
      "conflict",
    );
  }
  return decimalRevision(row.ownership_revision);
}

function passwordProvider(
  context: HostMaintenanceBootstrapContext,
  handoff: HostOwnershipHandoffOptions,
) {
  return {
    withBootstrapPassword<T>(use: (password: Uint8Array) => Promise<T>) {
      return handoff.keyProvider.withPrivatePostgresBootstrapPassword(
        {
          installationId: context.installationId,
          instanceId: context.instanceId,
          bootId: context.bootId,
          purpose: "private-postgres-bootstrap-superuser",
        },
        use,
      );
    },
    withHostLeasePassword<T>(use: (password: Uint8Array) => Promise<T>) {
      return handoff.keyProvider.withPrivatePostgresHostLeasePassword(
        {
          installationId: context.installationId,
          instanceId: context.instanceId,
          bootId: context.bootId,
          purpose: "private-postgres-host-lease-role",
        },
        use,
      );
    },
    withRuntimePassword<T>(use: (password: Uint8Array) => Promise<T>) {
      return handoff.keyProvider.withPrivatePostgresRuntimePassword(
        {
          installationId: context.installationId,
          instanceId: context.instanceId,
          bootId: context.bootId,
          purpose: "private-postgres-runtime-role",
        },
        use,
      );
    },
    withMigrationPassword<T>(use: (password: Uint8Array) => Promise<T>) {
      return handoff.keyProvider.withPrivatePostgresMigrationPassword(
        {
          installationId: context.installationId,
          instanceId: context.instanceId,
          bootId: context.bootId,
          purpose: "private-postgres-migration-role",
        },
        use,
      );
    },
    withDurableExecutionPassword<T>(use: (password: Uint8Array) => Promise<T>) {
      return handoff.keyProvider.withPrivatePostgresDurableExecutionPassword(
        {
          installationId: context.installationId,
          instanceId: context.instanceId,
          bootId: context.bootId,
          purpose: "private-postgres-durable-execution-role",
        },
        use,
      );
    },
  };
}

function operationTypeOf(
  request: PrivatePostgresMaintenanceRequest,
): MaintenanceOperationType {
  return request.kind === "RESTART_PRIVATE_POSTGRES"
    ? "PRIVATE_POSTGRES_RESTART"
    : "PRIVATE_POSTGRES_STOP";
}

function targetPostgresOf(
  request: PrivatePostgresMaintenanceRequest,
): "RUNNING_SAME_IDENTITY" | "STOPPED" {
  return request.kind === "RESTART_PRIVATE_POSTGRES"
    ? "RUNNING_SAME_IDENTITY"
    : "STOPPED";
}

function sameMaintenanceIntent(
  candidate: MaintenanceJournalBodyV1,
  expected: MaintenanceJournalBodyV1,
): boolean {
  return (
    candidate.schemaVersion === expected.schemaVersion &&
    candidate.operationId === expected.operationId &&
    candidate.activityId === expected.activityId &&
    candidate.installationId === expected.installationId &&
    candidate.instanceId === expected.instanceId &&
    candidate.operationType === expected.operationType &&
    candidate.source.hostOwnershipToken === expected.source.hostOwnershipToken &&
    candidate.source.hostBootId === expected.source.hostBootId &&
    candidate.source.hostOwnershipRevision === expected.source.hostOwnershipRevision &&
    candidate.source.postgresClusterSystemIdentifier ===
      expected.source.postgresClusterSystemIdentifier &&
    candidate.source.persistedPort === expected.source.persistedPort &&
    candidate.target.privatePostgres === expected.target.privatePostgres
  );
}

function executionEntryUnprovenProblem(original: unknown): ProblemError {
  const originalCode = problemCodeOf(original);
  return maintenanceProblem(
    "bootstrap.maintenance.execution_entry_unproven",
    "Maintenance execution entry could not be proven",
    originalCode === undefined
      ? "The current MaintenanceJournal could not prove whether EXECUTING was published"
      : `The current MaintenanceJournal could not prove whether EXECUTING was published after ${originalCode}`,
  );
}

function initialJournalBody(
  operationId: MaintenanceOperationId,
  request: PrivatePostgresMaintenanceRequest,
  context: HostMaintenanceBootstrapContext,
  host: HostOwnershipContext,
  state: BootstrapStateEnvelopeV1,
  ownershipRevision: string,
): MaintenanceJournalBodyV1 {
  const privatePostgres = state.state.privatePostgres;
  if (privatePostgres === undefined || privatePostgres.schemaVersion !== 1) {
    throw maintenanceProblem(
      "bootstrap.maintenance.private_postgres_state_required",
      "Private PostgreSQL state is not current",
      "A canonical private PostgreSQL state revision is required",
    );
  }
  return {
    schemaVersion: 1,
    revision: 1,
    operationId,
    activityId: context.bootstrapActivityId,
    installationId: context.installationId,
    instanceId: context.instanceId,
    operationType: operationTypeOf(request),
    source: {
      hostOwnershipToken: host.token,
      hostBootId: host.bootId,
      hostOwnershipRevision: ownershipRevision,
      postgresClusterSystemIdentifier: privatePostgres.clusterSystemIdentifier,
      persistedPort: privatePostgres.persistedPort,
    },
    target: { privatePostgres: targetPostgresOf(request) },
    phase: "PREPARED",
    updatedAt: formatInstant(new Date()),
  };
}

/** Creates managed Host operations that enter and terminally close windows. */
export function createHostMaintenanceOperations(
  provenance: HostMaintenanceOperationProvenance,
): ManagedHostOperations {
  return {
    preparePrivatePostgresMaintenance(request) {
      return prepareMaintenance(provenance, request);
    },
    async shutdownKeepingPrivatePostgres(retirement: HostRuntimeRetirement) {
      provenance.terminalizeManagedHost?.();
      let firstError: unknown;
      try {
        await retirement.retire();
      } catch (error) {
        firstError = error;
      }
      try {
        await (provenance.beginOldHostRetirement?.() ?? provenance.host.close());
      } catch (error) {
        firstError ??= error;
      }
      if (provenance.host.state !== "CLOSED") {
        firstError ??= maintenanceProblem(
          "bootstrap.maintenance.host_close_unverified",
          "Host lease close could not be verified",
          "The managed Host lease did not reach CLOSED after terminal retirement",
        );
      }
      provenance.onOldHostTerminal?.();
      if (firstError !== undefined) throw firstError;
    },
  };
}

/** Creates the bounded executor for stopping private PostgreSQL. */
function createStopPrivatePostgresEnteredWindowExecutor(
  provenance: HostMaintenanceOperationProvenance,
): (window: EnteredMaintenanceWindow) => Promise<PrivatePostgresMaintenanceResult> {
  return async (window) => {
    const controller = await openPrivatePostgresMaintenanceController({
      ...provenance.privatePostgres,
      assertControlAuthority: () => window.lease.assertHeld(),
    });
    const initialState = controller.state;
    if (initialState !== "READY") {
      throw maintenanceProblem(
        "bootstrap.maintenance.postgres_not_ready",
        "Private PostgreSQL is not ready for stop",
        "Maintenance entry did not observe the existing private PostgreSQL cluster as READY",
      );
    }
    await controller.stop();
    const stoppedState = controller.state;
    if (stoppedState !== "STOPPED") {
      throw maintenanceProblem(
        "bootstrap.maintenance.postgres_stop_unverified",
        "Private PostgreSQL stop could not be verified",
        "The maintenance controller did not prove the same cluster STOPPED",
      );
    }
    await window.advance("SUCCEEDED");
    await window.lease.release();
    await recordBootstrapMaintenanceCompletedBestEffort(provenance.bootstrap);
    window.complete();
    return { kind: "STOPPED" };
  };
}

/** Creates the bounded executor for restarting private PostgreSQL. */
function createRestartPrivatePostgresEnteredWindowExecutor(
  provenance: HostMaintenanceOperationProvenance,
): (window: EnteredMaintenanceWindow) => Promise<PrivatePostgresMaintenanceResult> {
  return async (window) => {
    if (provenance.reacquireHost === undefined) {
      throw maintenanceProblem(
        "bootstrap.maintenance.restart_executor_not_ready",
        "Private PostgreSQL restart executor is incomplete",
        "A restart window requires the canonical Host handoff owner for fresh ownership reacquisition",
        "unavailable",
      );
    }

    const controller = await openPrivatePostgresMaintenanceController({
      ...provenance.privatePostgres,
      assertControlAuthority: () => window.lease.assertHeld(),
    });
    const initialState = controller.state;
    if (initialState !== "READY") {
      throw maintenanceProblem(
        "bootstrap.maintenance.postgres_not_ready",
        "Private PostgreSQL is not ready for restart",
        "Reverse-handoff entry did not observe the existing private PostgreSQL cluster as READY",
      );
    }

    await controller.stop();
    const stoppedState = controller.state;
    if (stoppedState !== "STOPPED") {
      throw maintenanceProblem(
        "bootstrap.maintenance.postgres_stop_unverified",
        "Private PostgreSQL stop could not be verified",
        "The maintenance controller did not prove the same cluster STOPPED",
      );
    }

    await controller.start();
    const readyState = controller.state;
    if (readyState !== "READY") {
      throw maintenanceProblem(
        "bootstrap.maintenance.postgres_ready_unverified",
        "Private PostgreSQL readiness could not be verified",
        "The maintenance controller did not prove the same cluster READY after restart",
      );
    }

    const managedHost = await provenance.reacquireHost(window, () =>
      window.advance("SUCCEEDED"),
    );
    await recordBootstrapMaintenanceCompletedBestEffort(provenance.bootstrap);
    window.complete();
    return { kind: "RESTARTED", host: managedHost };
  };
}

async function prepareMaintenance(
  provenance: HostMaintenanceOperationProvenance,
  request: PrivatePostgresMaintenanceRequest,
): Promise<PreparedPrivatePostgresMaintenance> {
  const instanceRoot = provenance.bootstrap.paths.resolve("INSTANCE");
  const lease = await acquireBootstrapOwnership(instanceRoot, {
    heartbeatMs:
      provenance.handoff.bootstrapHeartbeatMs ?? DEFAULT_BOOTSTRAP_HEARTBEAT_MS,
    bootId: provenance.bootstrap.bootId,
  });
  let returned = false;
  try {
    const access = openMaintenanceStateAccess(provenance.bootstrap.paths, lease);
    provenance.host.assertActive();
    lease.assertHeld();
    const state = stateBody(await access.state.load());
    assertPrivatePostgresIdentity(state.state, provenance.privatePostgres);
    const provider = passwordProvider(provenance.bootstrap, provenance.handoff);
    const snapshot = await inspectHostOwnershipCanonicalSnapshot({
      port: state.state.privatePostgres.persistedPort,
      passwordProvider: provider,
    });
    lease.assertHeld();
    provenance.host.assertActive();
    const ownershipRevision = assertCurrentFence(snapshot, provenance.host);
    const operationId = createMaintenanceOperationId();
    const initial = initialJournalBody(
      operationId,
      request,
      provenance.bootstrap,
      provenance.host,
      state,
      ownershipRevision,
    );
    await access.journal.create(initial);
    await access.commitOperationPointer(operationId);
    const prepared = createPreparedMaintenance(
      provenance,
      request,
      lease,
      access,
      initial,
    );
    returned = true;
    return prepared;
  } finally {
    if (!returned) await lease.release().catch(() => undefined);
  }
}

function createPreparedMaintenance(
  provenance: HostMaintenanceOperationProvenance,
  request: PrivatePostgresMaintenanceRequest,
  lease: BootstrapOwnershipLease,
  access: OwnedMaintenanceStateAccess,
  initial: MaintenanceJournalBodyV1,
): PreparedPrivatePostgresMaintenance {
  let body = initial;
  let oldHostRetirementPromise: Promise<void> | undefined;
  let executePromise: Promise<PrivatePostgresMaintenanceResult> | undefined;
  let executionEntryState: "NOT_ENTERED" | "ENTERED" | "UNPROVEN" = "NOT_ENTERED";
  let executionEntryFailure: ProblemError | undefined;

  const beginOldHostRetirement = (): Promise<void> => {
    if (oldHostRetirementPromise !== undefined) {
      return oldHostRetirementPromise;
    }
    try {
      oldHostRetirementPromise =
        provenance.beginOldHostRetirement?.() ?? provenance.host.close();
    } catch (error) {
      oldHostRetirementPromise = Promise.reject(error);
    }
    return oldHostRetirementPromise;
  };

  const advance = async (
    phase: MaintenancePhase,
    changes: Partial<MaintenanceJournalBodyV1> = {},
  ): Promise<void> => {
    const valid =
      (body.phase === "PREPARED" && (phase === "EXECUTING" || phase === "ABORTED")) ||
      (body.phase === "EXECUTING" &&
        (phase === "RECOVERY_REQUIRED" || phase === "SUCCEEDED")) ||
      (body.phase === "RECOVERY_REQUIRED" && phase === "RECOVERY_REQUIRED");
    if (!valid) {
      throw maintenanceProblem(
        "bootstrap.maintenance.invalid_phase_transition",
        "Maintenance phase transition is invalid",
        `Maintenance cannot advance from ${body.phase} to ${phase}`,
        "conflict",
      );
    }
    const next: MaintenanceJournalBodyV1 = {
      ...body,
      ...changes,
      revision: body.revision + 1,
      phase,
      updatedAt: formatInstant(new Date()),
    };
    await access.journal.advance(next);
    body = next;
  };

  const publishExecuting = async (): Promise<void> => {
    const expectedExecuting: MaintenanceJournalBodyV1 = {
      ...body,
      revision: body.revision + 1,
      phase: "EXECUTING",
      updatedAt: formatInstant(new Date()),
    };
    try {
      await access.journal.advance(expectedExecuting);
      body = expectedExecuting;
      executionEntryState = "ENTERED";
      return;
    } catch (originalError) {
      let current: Awaited<ReturnType<OwnedMaintenanceStateAccess["journal"]["load"]>>;
      try {
        current = await access.journal.load(body.operationId);
      } catch {
        executionEntryState = "UNPROVEN";
        executionEntryFailure = executionEntryUnprovenProblem(originalError);
        if (lease.state === "HELD") await lease.release().catch(() => undefined);
        throw executionEntryFailure;
      }

      if (
        current.status === "CURRENT" &&
        current.value.state.phase === "PREPARED" &&
        current.value.state.revision === body.revision &&
        sameMaintenanceIntent(current.value.state, body)
      ) {
        body = current.value.state;
        throw originalError;
      }

      if (
        current.status === "CURRENT" &&
        current.value.state.phase === "EXECUTING" &&
        current.value.state.revision === expectedExecuting.revision &&
        sameMaintenanceIntent(current.value.state, expectedExecuting)
      ) {
        body = current.value.state;
        executionEntryState = "ENTERED";
        return;
      }

      executionEntryState = "UNPROVEN";
      executionEntryFailure = executionEntryUnprovenProblem(originalError);
      if (lease.state === "HELD") await lease.release().catch(() => undefined);
      throw executionEntryFailure;
    }
  };

  const markRecoveryRequired = async (error: unknown): Promise<void> => {
    if (
      executionEntryState !== "ENTERED" ||
      lease.state !== "HELD" ||
      (body.phase !== "EXECUTING" && body.phase !== "RECOVERY_REQUIRED")
    ) {
      return;
    }
    await advance("RECOVERY_REQUIRED", {
      problemCode: problemCodeOf(error),
    }).catch(() => undefined);
  };

  const executeOnce = async (
    retirement: HostRuntimeRetirement,
  ): Promise<PrivatePostgresMaintenanceResult> => {
    if (body.phase !== "PREPARED") {
      throw maintenanceProblem(
        "bootstrap.maintenance.invalid_state",
        "Prepared maintenance capability is not executable",
        `The maintenance capability is ${body.phase}`,
        "conflict",
      );
    }
    let retirementFailure: unknown;
    try {
      lease.assertHeld();
      provenance.host.assertActive();
      const provider = passwordProvider(provenance.bootstrap, provenance.handoff);
      const sourceSnapshot = await inspectHostOwnershipCanonicalSnapshot({
        port: body.source.persistedPort,
        passwordProvider: provider,
      });
      lease.assertHeld();
      const sourceRevision = assertCurrentFence(sourceSnapshot, provenance.host);
      if (sourceRevision !== body.source.hostOwnershipRevision) {
        throw maintenanceProblem(
          "bootstrap.maintenance.source_fence_changed",
          "The prepared Host fence is no longer current",
          "Maintenance requires the original Host token, BootId, and ownership revision to remain current before execution",
          "conflict",
        );
      }

      await publishExecuting();
      provenance.terminalizeManagedHost?.();
      try {
        await retirement.retire();
      } catch (error) {
        retirementFailure = error;
      }

      const hostStateAfterRetirement = provenance.host.state;
      if (hostStateAfterRetirement !== "ACTIVE") {
        let hostFailure = retirementFailure ?? provenance.host.signal.reason;
        try {
          await beginOldHostRetirement();
        } catch (error) {
          hostFailure ??= error;
        }
        const hostStateAfterClose = provenance.host.state;
        if (hostStateAfterClose !== "CLOSED") {
          hostFailure ??= maintenanceProblem(
            "bootstrap.maintenance.host_close_unverified",
            "Host lease close could not be verified",
            "The managed Host lease did not reach CLOSED after Host authority became unavailable",
          );
        }
        provenance.onOldHostTerminal?.();
        throw (
          hostFailure ??
          maintenanceProblem(
            "bootstrap.maintenance.host_not_active",
            "Host authority is not active",
            "Maintenance cannot continue after the source Host became unavailable",
          )
        );
      }

      let executionFailure: unknown = retirementFailure;
      try {
        lease.assertHeld();
        await revokeHostOwnershipTokenForBootstrap({
          port: body.source.persistedPort,
          instanceId: provenance.host.instanceId,
          bootId: body.source.hostBootId,
          token: body.source.hostOwnershipToken,
          lockTimeoutMs: provenance.handoff.timing.fenceLockTimeoutMs,
          statementTimeoutMs: provenance.handoff.timing.statementTimeoutMs,
          passwordProvider: provider,
          mutationAuthority: { assertCurrent: () => lease.assertHeld() },
        });
      } catch (error) {
        executionFailure ??= error;
      }

      try {
        await beginOldHostRetirement();
      } catch (error) {
        executionFailure ??= error;
      }
      const hostStateAfterClose = provenance.host.state;
      if (hostStateAfterClose !== "CLOSED") {
        executionFailure ??= maintenanceProblem(
          "bootstrap.maintenance.host_close_unverified",
          "Host lease close could not be verified",
          "The managed Host lease did not reach CLOSED during terminal maintenance entry",
        );
      }
      if (hostStateAfterClose === "CLOSED") {
        provenance.onOldHostTerminal?.();
      }
      if (executionFailure !== undefined) throw executionFailure;

      return await executeHostMaintenanceWindow(provenance, {
        operationId: body.operationId,
        request,
        lease,
        access,
        get journal() {
          return body;
        },
        advance,
        complete() {
          if (body.phase !== "SUCCEEDED") {
            throw maintenanceProblem(
              "bootstrap.maintenance.invalid_completion",
              "Maintenance completion phase is invalid",
              `The maintenance capability is ${body.phase}`,
              "conflict",
            );
          }
        },
      });
    } catch (error) {
      await markRecoveryRequired(error);
      throw error;
    }
  };

  const execute = (
    retirement: HostRuntimeRetirement,
  ): Promise<PrivatePostgresMaintenanceResult> => {
    if (executePromise !== undefined) return executePromise;
    const attempt = executeOnce(retirement);
    executePromise = attempt;
    void attempt.catch(() => {
      if (executionEntryState === "NOT_ENTERED" && body.phase === "PREPARED") {
        executePromise = undefined;
      }
    });
    return executePromise;
  };

  const abortBeforeExecute = async (): Promise<void> => {
    if (executionEntryFailure !== undefined) throw executionEntryFailure;
    if (executePromise !== undefined || body.phase !== "PREPARED") {
      throw maintenanceProblem(
        "bootstrap.maintenance.abort_after_entry",
        "Maintenance capability cannot abort after entry",
        "abortBeforeExecute is legal only before execute() enters its durable execution boundary",
        "conflict",
      );
    }
    await advance("ABORTED");
    await lease.release();
  };

  return {
    operationId: body.operationId,
    get state() {
      if (executionEntryFailure !== undefined) throw executionEntryFailure;
      return body.phase;
    },
    signal: lease.signal,
    execute,
    abortBeforeExecute,
  };
}
