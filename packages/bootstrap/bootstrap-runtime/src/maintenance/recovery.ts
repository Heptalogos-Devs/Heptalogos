// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Converges an interrupted Host maintenance operation from inspected current
 * truth. Recovery never replays historical maintenance substeps or rebuilds
 * the old Runtime/DBOS composition.
 * @module maintenance/recovery
 */

import {
  BootstrapJournal,
  maintenanceOperationRef,
  type BootstrapActivityId,
  type BootstrapStateEnvelopeV1,
  type BootstrapStateLoadResult,
  type MaintenanceJournalBodyV1,
  type MaintenanceOperationId,
} from "@heptalogos/bootstrap-state";
import {
  createBootId,
  createProblemError,
  createUuidV7Id,
  formatInstant,
  parseBootId,
  parseHostOwnershipToken,
  ProblemError,
  type BootId,
  type Problem,
} from "@heptalogos/foundation-contracts";
import {
  acquireHostLeaseConnection,
  deriveHostAdvisoryKey,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  inspectHostAdvisoryLease,
  inspectHostOwnershipCanonicalSnapshot,
  revokeHostOwnershipTokenForBootstrap,
  type HostOwnershipCanonicalSnapshot,
  type HostOwnershipTimingOptions,
} from "@heptalogos/host-ownership";
import { openPrivatePostgresMaintenanceController } from "@heptalogos/private-postgres";
import type { BootstrapKeyProvider } from "../bootstrap/key-provider.js";
import {
  acquireBootstrapRecoveryLease,
  inspectBootstrapRecovery,
} from "../recovery/bootstrap.js";
import type { BootstrapOwnershipLease } from "../bootstrap/ownership.js";
import {
  adoptRecoveredBootstrapOwnershipForMaintenance,
  handoffRecoveredMaintenanceToManagedHost,
  type OwnedBootstrapPrelude,
} from "../bootstrap/prelude.js";
import { type PrivatePostgresMaintenanceDescriptor } from "../postgres/bootstrap.js";
import { openMaintenanceStateAccess } from "./state-access.js";
import { problemCodeOf } from "../shared/problem-code.js";
import { recordBootstrapMaintenanceCompletedBestEffort } from "../shared/journal-stage.js";
import type {
  BootstrapManagedHostContext,
  PrivatePostgresMaintenanceResult,
} from "../host/managed-host.js";
import type { HostOwnershipHandoffOptions } from "../host/handoff.js";
import { loadBootstrapLocator } from "../bootstrap/locator.js";
import {
  resolveBootstrapPathProfile,
  type BootstrapPathProfile,
} from "../bootstrap/roots.js";

const DEFAULT_BOOTSTRAP_HEARTBEAT_MS = 1_000;
const RECOVERY_MAINTENANCE_ROOTS = ["INSTANCE", "DATA", "LOG", "TEMP"] as const;

type HostLeaseConnection = Awaited<ReturnType<typeof acquireHostLeaseConnection>>;

/** Supplies owner, identity, timing, and private-PostgreSQL inputs for recovery. */
export interface HostMaintenanceRecoveryOptions {
  readonly anchorRoot: string;
  readonly principal: import("../bootstrap/local-installation-owner.js").LocalInstallationOwnerRecoveryPrincipal;
  readonly expectedOperationId?: MaintenanceOperationId;
  readonly keyProvider: BootstrapKeyProvider;
  readonly initializeCanonicalHost: HostOwnershipHandoffOptions["initializeCanonicalHost"];
  readonly timing: HostOwnershipTimingOptions;
  readonly privatePostgres: PrivatePostgresMaintenanceDescriptor;
  readonly bootstrapHeartbeatMs?: number;
}

function recoveryProblem(
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

// Intentional duplication: recovery validates the same scalar under its own
// recovery Problem taxonomy rather than coupling to HostOwnership revocation.
/* jscpd:ignore-start */
function canonicalFenceRevision(value: string | number): string {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw recoveryProblem(
    "bootstrap.recovery.invalid_fence_revision",
    "HostOwnershipFence revision is invalid",
    "Recovery cannot compare the current fence without an unsigned decimal ownership revision",
  );
}
/* jscpd:ignore-end */

function requireBootstrapState(
  loaded: BootstrapStateLoadResult,
  profile: BootstrapPathProfile,
  descriptor: PrivatePostgresMaintenanceDescriptor,
): BootstrapStateEnvelopeV1 {
  if (loaded.status === "EMPTY") {
    throw recoveryProblem(
      "bootstrap.recovery.bootstrap_state_required",
      "BootstrapState is required for maintenance recovery",
      "Maintenance recovery requires authoritative BootstrapState",
    );
  }
  if (loaded.status === "CORRUPT") throw new ProblemError(loaded.problem);
  if (loaded.status === "RECOVERED_PREVIOUS") {
    throw recoveryProblem(
      "bootstrap.state.current_authority_required",
      "Current BootstrapState authority is required",
      "A recovered previous BootstrapState revision is inspection evidence only and cannot authorize maintenance recovery",
    );
  }
  const value = loaded.value;
  const persisted = value.state.privatePostgres;
  if (
    persisted === undefined ||
    persisted.schemaVersion !== 1 ||
    persisted.installationId !== profile.installationId ||
    persisted.instanceId !== profile.instanceId ||
    persisted.installationId !== descriptor.expectedIdentity.installationId ||
    persisted.instanceId !== descriptor.expectedIdentity.instanceId ||
    persisted.postgresMajor !== descriptor.expectedIdentity.postgresMajor ||
    persisted.bootstrapRoleName !== descriptor.expectedIdentity.bootstrapRoleName ||
    persisted.persistedPort !== descriptor.expectedIdentity.persistedPort ||
    persisted.clusterSystemIdentifier !==
      descriptor.expectedIdentity.clusterSystemIdentifier ||
    persisted.initializationProfileRevision !==
      descriptor.expectedIdentity.initializationProfileRevision ||
    persisted.dataPlacement.rootId !== descriptor.expectedIdentity.placement.rootId ||
    persisted.dataPlacement.relativePath !==
      descriptor.expectedIdentity.placement.relativePath ||
    persisted.dataPlacement.dataLayoutVersion !==
      descriptor.expectedIdentity.placement.dataLayoutVersion
  ) {
    throw recoveryProblem(
      "bootstrap.recovery.private_postgres_identity_mismatch",
      "Private PostgreSQL identity does not match recovery authority",
      "BootstrapState and the retained private PostgreSQL descriptor do not identify the same authoritative cluster",
    );
  }
  return value;
}

function requireJournalScope(
  body: MaintenanceJournalBodyV1,
  operationId: MaintenanceOperationId,
  descriptor: PrivatePostgresMaintenanceDescriptor,
  installationId: PrivatePostgresMaintenanceDescriptor["expectedIdentity"]["installationId"],
  instanceId: PrivatePostgresMaintenanceDescriptor["expectedIdentity"]["instanceId"],
): void {
  if (
    body.operationId !== operationId ||
    body.installationId !== installationId ||
    body.instanceId !== instanceId ||
    body.source.postgresClusterSystemIdentifier !==
      descriptor.expectedIdentity.clusterSystemIdentifier ||
    body.source.persistedPort !== descriptor.expectedIdentity.persistedPort ||
    parseBootId(body.source.hostBootId) !== body.source.hostBootId ||
    parseHostOwnershipToken(body.source.hostOwnershipToken) !==
      body.source.hostOwnershipToken
  ) {
    throw recoveryProblem(
      "bootstrap.recovery.journal_scope_mismatch",
      "MaintenanceJournal does not match recovery authority",
      "The operation, installation, instance, source Host, or cluster identity is outside the retained maintenance scope",
    );
  }
  const expectedPrivatePostgres =
    body.operationType === "PRIVATE_POSTGRES_RESTART"
      ? "RUNNING_SAME_IDENTITY"
      : "STOPPED";
  if (body.target.privatePostgres !== expectedPrivatePostgres) {
    throw recoveryProblem(
      "bootstrap.recovery.target_postgres_mismatch",
      "MaintenanceJournal target does not match its operation",
      "Recovery refuses to infer a different PostgreSQL target from an operation type",
    );
  }
}

function passwordProvider(
  options: HostMaintenanceRecoveryOptions,
  installationId: typeof options.privatePostgres.expectedIdentity.installationId,
  instanceId: typeof options.privatePostgres.expectedIdentity.instanceId,
  bootId: BootId,
) {
  return {
    withBootstrapPassword<T>(use: (password: Uint8Array) => Promise<T>) {
      return options.keyProvider.withPrivatePostgresBootstrapPassword(
        {
          installationId,
          instanceId,
          bootId,
          purpose: "private-postgres-bootstrap-superuser",
        },
        use,
      );
    },
    withHostLeasePassword<T>(use: (password: Uint8Array) => Promise<T>) {
      return options.keyProvider.withPrivatePostgresHostLeasePassword(
        {
          installationId,
          instanceId,
          bootId,
          purpose: "private-postgres-host-lease-role",
        },
        use,
      );
    },
    withRuntimePassword<T>(use: (password: Uint8Array) => Promise<T>) {
      return options.keyProvider.withPrivatePostgresRuntimePassword(
        {
          installationId,
          instanceId,
          bootId,
          purpose: "private-postgres-runtime-role",
        },
        use,
      );
    },
    withMigrationPassword<T>(use: (password: Uint8Array) => Promise<T>) {
      return options.keyProvider.withPrivatePostgresMigrationPassword(
        {
          installationId,
          instanceId,
          bootId,
          purpose: "private-postgres-migration-role",
        },
        use,
      );
    },
    withDurableExecutionPassword<T>(use: (password: Uint8Array) => Promise<T>) {
      return options.keyProvider.withPrivatePostgresDurableExecutionPassword(
        {
          installationId,
          instanceId,
          bootId,
          purpose: "private-postgres-durable-execution-role",
        },
        use,
      );
    },
  };
}

function sourceFenceIsCurrent(
  snapshot: HostOwnershipCanonicalSnapshot,
  body: MaintenanceJournalBodyV1,
): boolean {
  if (snapshot.fence.length !== 1) {
    throw recoveryProblem(
      "bootstrap.recovery.invalid_fence",
      "HostOwnershipFence snapshot is invalid",
      "Recovery did not observe exactly one canonical HostOwnershipFence row",
    );
  }
  const row = snapshot.fence[0];
  if (row.instance_id !== body.instanceId) {
    throw recoveryProblem(
      "bootstrap.recovery.fence_instance_mismatch",
      "HostOwnershipFence belongs to another instance",
      "Recovery refuses to inspect a fence row outside the MaintenanceJournal instance scope",
    );
  }
  if (row.host_ownership_token === null) {
    if (row.boot_id !== null) {
      throw recoveryProblem(
        "bootstrap.recovery.fence_inconsistent",
        "HostOwnershipFence is internally inconsistent",
        "A null Host token must have a null fence BootId",
      );
    }
    return false;
  }
  const token = parseHostOwnershipToken(row.host_ownership_token);
  if (token === undefined || token !== row.host_ownership_token) {
    throw recoveryProblem(
      "bootstrap.recovery.fence_token_invalid",
      "HostOwnershipFence token is invalid",
      "Recovery refuses to adjudicate an unparseable HostOwnershipToken",
    );
  }
  if (token !== body.source.hostOwnershipToken) {
    throw recoveryProblem(
      "bootstrap.recovery.unexpected_fence_token",
      "HostOwnershipFence contains unexpected ownership",
      "Recovery will not revoke a token outside the exact durable source Host identity",
      "conflict",
    );
  }
  if (
    row.boot_id === null ||
    parseBootId(row.boot_id) !== body.source.hostBootId ||
    row.boot_id !== body.source.hostBootId
  ) {
    throw recoveryProblem(
      "bootstrap.recovery.fence_boot_mismatch",
      "HostOwnershipFence BootId is unexpected",
      "The source Host token is only recoverable under its durable source BootId",
    );
  }
  return (
    canonicalFenceRevision(row.ownership_revision) === body.source.hostOwnershipRevision
  );
}

function nextBody(
  body: MaintenanceJournalBodyV1,
  phase: MaintenanceJournalBodyV1["phase"],
  problemCode?: string,
): MaintenanceJournalBodyV1 {
  const { problemCode: _previousProblemCode, ...withoutProblem } = body;
  const next = {
    ...withoutProblem,
    revision: body.revision + 1,
    phase,
    updatedAt: formatInstant(new Date()),
    ...(problemCode === undefined ? {} : { problemCode }),
  };
  return next;
}

async function acquireNoLiveHostLease(
  options: HostMaintenanceRecoveryOptions,
  provider: ReturnType<typeof passwordProvider>,
  lease: BootstrapOwnershipLease,
): Promise<HostLeaseConnection> {
  const advisoryKey = deriveHostAdvisoryKey(
    options.privatePostgres.expectedIdentity.instanceId,
  );
  const advisory = await inspectHostAdvisoryLease({
    port: options.privatePostgres.expectedIdentity.persistedPort,
    advisoryKey,
    passwordProvider: provider,
  });
  if (advisory.live) {
    throw recoveryProblem(
      "bootstrap.recovery.live_host_owner",
      "A live Host advisory owner blocks recovery",
      "Recovery will not control PostgreSQL while another Host lease is active",
      "conflict",
    );
  }
  return acquireHostLeaseConnection({
    target: {
      host: "127.0.0.1",
      port: options.privatePostgres.expectedIdentity.persistedPort,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
    },
    advisoryKey,
    timing: options.timing,
    passwordProvider: provider,
    mutationAuthority: { assertCurrent: () => lease.assertHeld() },
  });
}

async function revokeSourceIfPresent(
  options: HostMaintenanceRecoveryOptions,
  provider: ReturnType<typeof passwordProvider>,
  lease: BootstrapOwnershipLease,
  body: MaintenanceJournalBodyV1,
): Promise<void> {
  const snapshot = await inspectHostOwnershipCanonicalSnapshot({
    port: body.source.persistedPort,
    passwordProvider: provider,
  });
  if (!sourceFenceIsCurrent(snapshot, body)) return;
  await revokeHostOwnershipTokenForBootstrap({
    port: body.source.persistedPort,
    instanceId: body.instanceId,
    bootId: body.source.hostBootId,
    token: body.source.hostOwnershipToken,
    lockTimeoutMs: options.timing.fenceLockTimeoutMs,
    statementTimeoutMs: options.timing.statementTimeoutMs,
    passwordProvider: provider,
    mutationAuthority: { assertCurrent: () => lease.assertHeld() },
  });
}

function bootstrapContext(
  profile: BootstrapPathProfile,
  installationId: HostMaintenanceRecoveryOptions["privatePostgres"]["expectedIdentity"]["installationId"],
  instanceId: HostMaintenanceRecoveryOptions["privatePostgres"]["expectedIdentity"]["instanceId"],
  bootId: BootId,
  activityId: BootstrapActivityId,
) {
  return {
    installationId,
    instanceId,
    bootId,
    bootstrapActivityId: activityId,
    paths: profile,
    journal: new BootstrapJournal(profile.resolve("INSTANCE").canonicalPath),
  };
}

/** Recovers an interrupted maintenance operation by converging current truth. */
export async function recoverInterruptedHostMaintenance(
  options: HostMaintenanceRecoveryOptions,
): Promise<PrivatePostgresMaintenanceResult> {
  const initialInspection = await inspectBootstrapRecovery(options.anchorRoot);
  const operationId = initialInspection.operationId;
  const maintenance = initialInspection.maintenance;
  if (operationId === undefined || maintenance === undefined) {
    throw recoveryProblem(
      "bootstrap.recovery.operation_required",
      "An incomplete MaintenanceJournal operation is required",
      "Recovery cannot run without the committed current maintenance operation",
    );
  }
  if (
    options.expectedOperationId !== undefined &&
    operationId !== options.expectedOperationId
  ) {
    throw recoveryProblem(
      "bootstrap.recovery.operation_mismatch",
      "Requested recovery operation does not match BootstrapState",
      "Recovery refuses to select a different MaintenanceJournal operation implicitly",
      "conflict",
    );
  }

  const locator = await loadBootstrapLocator(options.anchorRoot);
  const profile = await resolveBootstrapPathProfile(
    locator,
    RECOVERY_MAINTENANCE_ROOTS,
  );
  const recoveryBootId = createBootId();
  const recoveryActivityId = createUuidV7Id("ActivityId");
  const lease = await acquireBootstrapRecoveryLease(
    options.anchorRoot,
    options.principal,
    {
      heartbeatMs: options.bootstrapHeartbeatMs ?? DEFAULT_BOOTSTRAP_HEARTBEAT_MS,
      bootId: recoveryBootId,
    },
  );
  let body: MaintenanceJournalBodyV1 | undefined;
  let hostLease: HostLeaseConnection | undefined;
  let prelude: OwnedBootstrapPrelude | undefined;
  let managedHost: BootstrapManagedHostContext | undefined;

  const markRecoveryRequired = async (error: unknown): Promise<void> => {
    if (
      body === undefined ||
      body.phase === "PREPARED" ||
      body.phase === "SUCCEEDED" ||
      body.phase === "ABORTED" ||
      lease.state !== "HELD"
    ) {
      return;
    }
    try {
      const access = openMaintenanceStateAccess(profile, lease);
      const current = await access.journal.load(body.operationId);
      if (current.status !== "CURRENT") return;
      const next = nextBody(
        current.value.state,
        "RECOVERY_REQUIRED",
        problemCodeOf(error),
      );
      await access.journal.advance(next);
      body = next;
    } catch {
      // The original failure remains authoritative when current journal truth
      // cannot be safely updated.
    }
  };

  try {
    const access = openMaintenanceStateAccess(profile, lease);
    const state = requireBootstrapState(
      await access.state.load(),
      profile,
      options.privatePostgres,
    );
    if (
      state.state.lastCommittedOperationRef !== maintenanceOperationRef(operationId)
    ) {
      throw recoveryProblem(
        "bootstrap.recovery.operation_pointer_changed",
        "BootstrapState operation pointer changed during recovery selection",
        "Recovery refuses to execute a MaintenanceJournal that is not the current committed operation pointer",
        "conflict",
      );
    }
    const loaded = await access.journal.load(operationId);
    if (loaded.status !== "CURRENT") {
      throw recoveryProblem(
        "bootstrap.recovery.current_journal_required",
        "Current MaintenanceJournal authority is required",
        "Recovery will not execute a missing, corrupt, or recovered-previous journal revision",
      );
    }
    body = loaded.value.state;
    requireJournalScope(
      body,
      operationId,
      options.privatePostgres,
      locator.installationId,
      locator.instanceId,
    );

    const provider = passwordProvider(
      options,
      locator.installationId,
      locator.instanceId,
      recoveryBootId,
    );

    if (body.phase === "PREPARED") {
      const advisory = await inspectHostAdvisoryLease({
        port: body.source.persistedPort,
        advisoryKey: deriveHostAdvisoryKey(body.instanceId),
        passwordProvider: provider,
      });
      if (advisory.live) {
        throw recoveryProblem(
          "bootstrap.recovery.live_host_owner",
          "A live Host owner blocks PREPARED maintenance recovery",
          "Recovery will not mutate a prepared maintenance intent while a normal Host advisory lease is active",
          "conflict",
        );
      }
      const aborted = nextBody(body, "ABORTED");
      await access.journal.advance(aborted);
      body = aborted;
      await lease.release();
      await recordBootstrapMaintenanceCompletedBestEffort(
        bootstrapContext(
          profile,
          locator.installationId,
          locator.instanceId,
          recoveryBootId,
          recoveryActivityId,
        ),
      );
      return { kind: "ABORTED" };
    }

    if (body.phase === "SUCCEEDED" || body.phase === "ABORTED") {
      throw recoveryProblem(
        "bootstrap.recovery.terminal_operation",
        "Maintenance operation is already terminal",
        `Recovery cannot execute a ${body.phase} MaintenanceJournal operation`,
        "conflict",
      );
    }

    hostLease = await acquireNoLiveHostLease(options, provider, lease);
    await revokeSourceIfPresent(options, provider, lease, body);
    await hostLease.close();
    hostLease = undefined;

    if (body.operationType === "PRIVATE_POSTGRES_STOP") {
      const controller = await openPrivatePostgresMaintenanceController({
        ...options.privatePostgres,
        assertControlAuthority: () => lease.assertHeld(),
      });
      if (controller.state === "READY") await controller.stop();
      if (controller.state !== "STOPPED") {
        throw recoveryProblem(
          "bootstrap.recovery.postgres_stop_unverified",
          "Private PostgreSQL stop could not be verified",
          "Recovery did not prove the validated same cluster STOPPED",
        );
      }
      const succeeded = nextBody(body, "SUCCEEDED");
      await access.journal.advance(succeeded);
      body = succeeded;
      await lease.release();
      await recordBootstrapMaintenanceCompletedBestEffort(
        bootstrapContext(
          profile,
          locator.installationId,
          locator.instanceId,
          recoveryBootId,
          recoveryActivityId,
        ),
      );
      return { kind: "STOPPED" };
    }

    prelude = await adoptRecoveredBootstrapOwnershipForMaintenance(
      options.anchorRoot,
      lease,
      { bootId: recoveryBootId, bootstrapActivityId: recoveryActivityId },
    );
    const ready = await prelude.preparePrivatePostgres({
      toolchainBinDirectory: options.privatePostgres.toolchain.binDirectory,
      lifecycle: options.privatePostgres.lifecycle,
      keyProvider: options.keyProvider,
    });
    const handoff: HostOwnershipHandoffOptions = {
      keyProvider: options.keyProvider,
      initializeCanonicalHost: options.initializeCanonicalHost,
      timing: options.timing,
      bootstrapHeartbeatMs: options.bootstrapHeartbeatMs,
    };
    managedHost = await handoffRecoveredMaintenanceToManagedHost(
      prelude,
      ready,
      handoff,
      async () => {
        const current = await access.journal.load(operationId);
        if (current.status !== "CURRENT") {
          throw recoveryProblem(
            "bootstrap.recovery.current_journal_required",
            "Current MaintenanceJournal authority is required",
            "Recovery cannot finalize maintenance from a non-current journal revision",
          );
        }
        const succeeded = nextBody(current.value.state, "SUCCEEDED");
        await access.journal.advance(succeeded);
        body = succeeded;
      },
    );
    await recordBootstrapMaintenanceCompletedBestEffort(
      bootstrapContext(
        profile,
        locator.installationId,
        locator.instanceId,
        recoveryBootId,
        recoveryActivityId,
      ),
    );
    return { kind: "RESTARTED", host: managedHost };
  } catch (error) {
    await hostLease?.close().catch(() => undefined);
    if (prelude !== undefined && prelude.ownershipState === "HELD") {
      await prelude.close().catch(() => undefined);
    }
    if (managedHost !== undefined) {
      // The returned managed Host is never exposed on a failed recovery.
      try {
        managedHost.assertActive();
      } catch {
        // Already terminal; no further action is required.
      }
    }
    await markRecoveryRequired(error);
    if (lease.state === "HELD") await lease.release().catch(() => undefined);
    throw error;
  }
}
