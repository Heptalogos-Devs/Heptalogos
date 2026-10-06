// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Performs the ordered Bootstrap-to-Host ownership handoff and carries the
 * resulting fence context into the managed Host boundary.
 * @module host/handoff
 */

import {
  createBootId,
  createHostOwnershipToken,
  createProblemError,
  formatInstant,
  type ProblemError,
  type ContinuityEpochId,
} from "@heptalogos/foundation-contracts";
import {
  acquireBootstrapHostReservation,
  acquireHostLeaseConnection,
  deriveHostAdvisoryKey,
  ensureHostOwnershipSchema,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  HOST_RUNTIME_ROLE,
  HOST_DURABLE_EXECUTION_ROLE,
  inspectCanonicalHostDatabase,
  provisionHostOwnershipDatabase,
  publishHostOwnershipToken,
  type BootstrapAdminPasswordProvider,
  type BootstrapMutationAuthority,
  type HostCanonicalMigrationAuthority,
  type HostOwnershipContext,
  type HostOwnershipState,
  type HostOwnershipTimingOptions,
} from "@heptalogos/host-ownership";
import type {
  BootstrapActivityId,
  BootstrapJournal,
} from "@heptalogos/bootstrap-state";
import type { BootstrapOwnershipLease } from "../bootstrap/ownership.js";
import { assertBootstrapOwnershipFor } from "../bootstrap/ownership.js";
import type { BootstrapKeyProvider } from "../bootstrap/key-provider.js";
import {
  getPrivatePostgresMaintenanceDescriptor,
  type PrivatePostgresMaintenanceDescriptor,
  type PrivatePostgresSessionToken,
  type PrivatePostgresSessionTracker,
  type ReadyPrivatePostgres,
} from "../postgres/bootstrap.js";
import type { OwnedBootstrapStateStore } from "../bootstrap/state-access.js";
import type { BootstrapPathProfile } from "../bootstrap/roots.js";
import {
  createManagedHostContext,
  markManagedHostTerminal,
  type BootstrapManagedHostContext,
} from "./managed-host.js";
import { admitCanonicalHost } from "./admission.js";
import {
  createHostMaintenanceOperations,
  type EnteredMaintenanceWindow,
  type HostMaintenanceOperationProvenance,
} from "../maintenance/operation.js";
import { problemCodeOf } from "../shared/problem-code.js";
import { recordBootstrapStage } from "../shared/journal-stage.js";

/** Supplies key, timing, and canonical initialization seams for Host handoff. */
export interface HostOwnershipHandoffOptions {
  readonly keyProvider: BootstrapKeyProvider;
  readonly timing: HostOwnershipTimingOptions;
  readonly initializeCanonicalHost: CanonicalHostInitializer;
  readonly bootstrapHeartbeatMs?: number;
}

interface CanonicalHostInitializationContext {
  readonly authority: HostCanonicalMigrationAuthority;
  readonly expectedContinuityEpochId: ContinuityEpochId;
}

type CanonicalHostInitializer = (
  context: CanonicalHostInitializationContext,
) => Promise<void>;

/** Carries Bootstrap authority and state into one Host handoff transaction. */
interface HostHandoffContext {
  readonly installationId: ReadyPrivatePostgres["installationId"];
  readonly instanceId: ReadyPrivatePostgres["instanceId"];
  readonly bootId: ReadyPrivatePostgres["bootId"];
  readonly bootstrapActivityId: BootstrapActivityId;
  readonly paths: BootstrapPathProfile;
  readonly ownership: BootstrapOwnershipLease;
  readonly assertOwnership: () => void;
  readonly state: OwnedBootstrapStateStore;
  readonly journal: BootstrapJournal;
}

/** Carries the prepared private-PostgreSQL session into the handoff owner. */
export interface OwnedBootstrapPreludeHandoffContext extends HostHandoffContext {
  readonly privatePostgresSession: PrivatePostgresSessionTracker;
  readonly assertReady: (ready: ReadyPrivatePostgres) => PrivatePostgresSessionToken;
}

interface HandoffPrivatePostgres {
  readonly installationId: ReadyPrivatePostgres["installationId"];
  readonly instanceId: ReadyPrivatePostgres["instanceId"];
  readonly bootId: ReadyPrivatePostgres["bootId"];
  readonly port: ReadyPrivatePostgres["port"];
  readonly onHandedOff?: () => void;
  readonly onYieldedToExistingHost?: () => void;
  readonly cleanupAfterFailedHandoff?: () => Promise<void>;
}

const STAGE_DATABASE_VALIDATED = "bootstrap.host.database_validated";
const STAGE_RESERVATION_ACQUIRED = "bootstrap.host.reservation_acquired";
const STAGE_LEASE_ACQUIRED = "bootstrap.host.lease_acquired";
const STAGE_FENCE_VALIDATED = "bootstrap.host.fence_validated";
const STAGE_TOKEN_PUBLISHED = "bootstrap.host.token_published";
const STAGE_STATE_AUTHORITATIVE_RELOADED =
  "bootstrap.host.state_authoritative_reloaded";
const STAGE_CANONICAL_INITIALIZATION_STARTED =
  "bootstrap.host.canonical_initialization_started";
const STAGE_CANONICAL_INITIALIZATION_SUCCEEDED =
  "bootstrap.host.canonical_initialization_succeeded";
const STAGE_CANONICAL_INITIALIZATION_FAILED =
  "bootstrap.host.canonical_initialization_failed";
const STAGE_FORWARD_HANDOFF_COMPLETED = "bootstrap.host.forward_handoff_completed";
const STAGE_EXISTING_OWNER_DETECTED = "bootstrap.host.existing_owner_detected";
const STAGE_HANDOFF_FAILED = "bootstrap.host.handoff_failed";

function handoffProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: "conflict" | "integrity" | "unavailable" = "integrity",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

function existingOwnerProblem(): ProblemError {
  return handoffProblem(
    "bootstrap.host.existing_owner_detected",
    "Another Host already owns PostgreSQL",
    "The bootstrap attempt yielded without mutating ownership state or controlling the already-running PostgreSQL process",
    "conflict",
  );
}

function releaseUncertainProblem(): ProblemError {
  return handoffProblem(
    "bootstrap.host.handoff_release_uncertain",
    "Bootstrap to Host handoff release is uncertain",
    "Bootstrap ownership could not be proven released after Host token publication",
    "integrity",
  );
}

function ownershipLostDuringHandoffProblem(): ProblemError {
  return handoffProblem(
    "bootstrap.host.ownership_lost_during_handoff",
    "Host ownership was lost during handoff",
    "The Host lease was not active after bootstrap ownership release",
    "integrity",
  );
}

function currentBootstrapStateRequiredProblem(): ProblemError {
  return handoffProblem(
    "bootstrap.host.current_state_required",
    "Current BootstrapState is required for Host handoff",
    "Canonical Host initialization requires the current committed BootstrapState; empty, corrupt, or recovered state cannot authorize normal Host exposure",
    "integrity",
  );
}

async function recordStage(
  context: HostHandoffContext,
  stage: string,
  outcome: "STARTED" | "SUCCEEDED" | "FAILED",
  problemCode?: string,
): Promise<void> {
  await recordBootstrapStage(
    context,
    stage,
    formatInstant(new Date()),
    outcome,
    problemCode,
  );
}

function passwordProvider(
  context: HostHandoffContext,
  keyProvider: BootstrapKeyProvider,
): BootstrapAdminPasswordProvider {
  return {
    withBootstrapPassword(use) {
      return keyProvider.withPrivatePostgresBootstrapPassword(
        {
          installationId: context.installationId,
          instanceId: context.instanceId,
          bootId: context.bootId,
          purpose: "private-postgres-bootstrap-superuser",
        },
        use,
      );
    },
    withHostLeasePassword(use) {
      return keyProvider.withPrivatePostgresHostLeasePassword(
        {
          installationId: context.installationId,
          instanceId: context.instanceId,
          bootId: context.bootId,
          purpose: "private-postgres-host-lease-role",
        },
        use,
      );
    },
    withRuntimePassword(use) {
      return keyProvider.withPrivatePostgresRuntimePassword(
        {
          installationId: context.installationId,
          instanceId: context.instanceId,
          bootId: context.bootId,
          purpose: "private-postgres-runtime-role",
        },
        use,
      );
    },
    withMigrationPassword(use) {
      return keyProvider.withPrivatePostgresMigrationPassword(
        {
          installationId: context.installationId,
          instanceId: context.instanceId,
          bootId: context.bootId,
          purpose: "private-postgres-migration-role",
        },
        use,
      );
    },
    withDurableExecutionPassword(use) {
      return keyProvider.withPrivatePostgresDurableExecutionPassword(
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

function stateOf(connection: {
  readonly state: "ACQUIRING" | "ACTIVE" | "FENCED" | "CLOSING" | "CLOSED";
}): HostOwnershipState {
  return connection.state === "ACQUIRING" ? "FENCED" : connection.state;
}

function createContext(
  context: HostHandoffContext,
  connection: Awaited<ReturnType<typeof acquireHostLeaseConnection>>,
  token: ReturnType<typeof createHostOwnershipToken>,
  bootId: ReadyPrivatePostgres["bootId"] = context.bootId,
): HostOwnershipContext {
  return Object.freeze({
    installationId: context.installationId,
    instanceId: context.instanceId,
    bootId,
    token,
    get state() {
      return stateOf(connection);
    },
    signal: connection.signal,
    assertActive() {
      connection.assertActive();
    },
    close() {
      return connection.close();
    },
  });
}

interface HostHandoffSuccess {
  readonly kind: "HOST";
  readonly host: HostOwnershipContext;
  readonly managedHost?: BootstrapManagedHostContext;
  readonly continuityEpochId: ContinuityEpochId;
}

type HostHandoffResult = HostHandoffSuccess | { readonly kind: "YIELDED" };

interface HandoffFinalization {
  readonly beforeBootstrapRelease: () => Promise<void>;
}

function createManagedHostFromRawHost(
  context: HostHandoffContext,
  options: HostOwnershipHandoffOptions,
  privatePostgres: PrivatePostgresMaintenanceDescriptor,
  raw: HostOwnershipContext,
  continuityEpochId: ContinuityEpochId,
): BootstrapManagedHostContext {
  let managed: BootstrapManagedHostContext;
  let oldHostRetirementPromise: Promise<void> | undefined;
  const terminalizeManagedHost = (): void => {
    markManagedHostTerminal(managed);
  };
  const beginOldHostRetirement = (): Promise<void> => {
    if (oldHostRetirementPromise !== undefined) {
      return oldHostRetirementPromise;
    }
    terminalizeManagedHost();
    try {
      oldHostRetirementPromise = raw.close();
    } catch (error) {
      oldHostRetirementPromise = Promise.reject(error);
    }
    return oldHostRetirementPromise;
  };
  const provenance: HostMaintenanceOperationProvenance = {
    host: raw,
    bootstrap: context,
    handoff: options,
    privatePostgres,
    terminalizeManagedHost,
    beginOldHostRetirement,
    reacquireHost: (window, beforeBootstrapRelease) =>
      handoffRestartedPrivatePostgresToManagedHost(
        createMaintenanceHandoffContext(context, window),
        options,
        privatePostgres,
        beforeBootstrapRelease,
      ),
  };
  managed = createManagedHostContext(
    raw,
    createHostMaintenanceOperations(provenance),
    {
      continuityEpochId,
      target: {
        host: "127.0.0.1",
        port: privatePostgres.expectedIdentity.persistedPort,
        database: HOST_OWNERSHIP_CANONICAL_DATABASE,
        user: HOST_RUNTIME_ROLE,
      },
      withRuntimeDatabasePassword(use) {
        return options.keyProvider.withPrivatePostgresRuntimePassword(
          {
            installationId: context.installationId,
            instanceId: context.instanceId,
            bootId: raw.bootId,
            purpose: "private-postgres-runtime-role",
          },
          use,
        );
      },
    },
    {
      continuityEpochId,
      target: {
        host: "127.0.0.1",
        port: privatePostgres.expectedIdentity.persistedPort,
        database: HOST_OWNERSHIP_CANONICAL_DATABASE,
        user: HOST_DURABLE_EXECUTION_ROLE,
      },
      withDurableExecutionDatabasePassword(use) {
        return options.keyProvider.withPrivatePostgresDurableExecutionPassword(
          {
            installationId: context.installationId,
            instanceId: context.instanceId,
            bootId: raw.bootId,
            purpose: "private-postgres-durable-execution-role",
          },
          use,
        );
      },
    },
  );
  return managed;
}

async function handoffPrivatePostgresToHostInternal(
  context: HostHandoffContext,
  privatePostgres: HandoffPrivatePostgres,
  options: HostOwnershipHandoffOptions,
  privatePostgresDescriptor?: PrivatePostgresMaintenanceDescriptor,
): Promise<HostHandoffResult> {
  if (
    privatePostgres.installationId !== context.installationId ||
    privatePostgres.instanceId !== context.instanceId ||
    privatePostgres.bootId !== context.bootId
  ) {
    throw handoffProblem(
      "bootstrap.host.ready_identity_mismatch",
      "Ready private PostgreSQL identity does not match bootstrap ownership",
      "The private PostgreSQL handoff context does not belong to this owned bootstrap prelude",
      "integrity",
    );
  }

  const provider = passwordProvider(context, options.keyProvider);
  const mutationAuthority: BootstrapMutationAuthority = Object.freeze({
    assertCurrent: context.assertOwnership,
  });
  const advisoryKey = deriveHostAdvisoryKey(context.instanceId);
  let reservation: Awaited<ReturnType<typeof acquireBootstrapHostReservation>> =
    undefined;
  let reservationReleased = false;
  let leaseConnection:
    Awaited<ReturnType<typeof acquireHostLeaseConnection>> | undefined;
  let token: ReturnType<typeof createHostOwnershipToken> | undefined;
  let continuityEpochId: ContinuityEpochId | undefined;
  let canonicalInitializationStarted = false;
  let canonicalInitializationSucceeded = false;
  let terminalHandoff = false;

  try {
    context.assertOwnership();
    const databaseInspection = await inspectCanonicalHostDatabase({
      port: privatePostgres.port,
      passwordProvider: provider,
      mutationAuthority,
    });

    if (databaseInspection.exists) {
      reservation = await acquireBootstrapHostReservation({
        port: privatePostgres.port,
        advisoryKey,
        passwordProvider: provider,
        mutationAuthority,
      });
    } else {
      await provisionHostOwnershipDatabase({
        port: privatePostgres.port,
        passwordProvider: provider,
        mutationAuthority,
      });
      reservation = await acquireBootstrapHostReservation({
        port: privatePostgres.port,
        advisoryKey,
        passwordProvider: provider,
        mutationAuthority,
      });
    }
    if (reservation === undefined) {
      context.assertOwnership();
      await recordStage(context, STAGE_EXISTING_OWNER_DETECTED, "SUCCEEDED");
      context.assertOwnership();
      privatePostgres.onYieldedToExistingHost?.();
      terminalHandoff = true;
      return { kind: "YIELDED" };
    }
    if (databaseInspection.exists) {
      await provisionHostOwnershipDatabase({
        port: privatePostgres.port,
        passwordProvider: provider,
        mutationAuthority,
      });
    }
    context.assertOwnership();
    await recordStage(context, STAGE_DATABASE_VALIDATED, "SUCCEEDED");
    context.assertOwnership();
    await recordStage(context, STAGE_RESERVATION_ACQUIRED, "SUCCEEDED");

    await ensureHostOwnershipSchema({
      port: privatePostgres.port,
      instanceId: context.instanceId,
      passwordProvider: provider,
      mutationAuthority,
    });
    context.assertOwnership();
    await recordStage(context, STAGE_FENCE_VALIDATED, "SUCCEEDED");

    context.assertOwnership();
    await reservation.release();
    context.assertOwnership();
    reservationReleased = true;
    reservation = undefined;

    leaseConnection = await acquireHostLeaseConnection({
      target: {
        host: "127.0.0.1" as const,
        port: privatePostgres.port,
        database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      },
      advisoryKey,
      timing: options.timing,
      passwordProvider: provider,
      mutationAuthority,
    });
    context.assertOwnership();
    await recordStage(context, STAGE_LEASE_ACQUIRED, "SUCCEEDED");

    token = createHostOwnershipToken();
    await publishHostOwnershipToken({
      connection: leaseConnection,
      instanceId: context.instanceId,
      bootId: context.bootId,
      token,
      fenceLockTimeoutMs: options.timing.fenceLockTimeoutMs,
      statementTimeoutMs: options.timing.statementTimeoutMs,
      mutationAuthority,
    });
    context.assertOwnership();
    await recordStage(context, STAGE_TOKEN_PUBLISHED, "SUCCEEDED");

    const activeLeaseConnection = leaseConnection;
    const activeToken = token;
    if (activeLeaseConnection === undefined || activeToken === undefined) {
      throw handoffProblem(
        "bootstrap.host.migration_authority_unavailable",
        "Canonical migration authority is unavailable",
        "Host token and lease must both be present before canonical initialization",
        "integrity",
      );
    }
    const admission = await admitCanonicalHost({
      installationId: context.installationId,
      instanceId: context.instanceId,
      bootId: context.bootId,
      token: activeToken,
      port: privatePostgres.port,
      bootstrapOwnership: context.ownership,
      hostLeaseConnection: activeLeaseConnection,
      keyProvider: options.keyProvider,
      loadCurrentContinuityEpochId: async () => {
        const currentState = await context.state.load();
        if (currentState.status !== "CURRENT") {
          throw currentBootstrapStateRequiredProblem();
        }
        continuityEpochId = currentState.value.state.continuityEpochId;
        context.assertOwnership();
        await recordStage(context, STAGE_STATE_AUTHORITATIVE_RELOADED, "SUCCEEDED");
        return continuityEpochId;
      },
      initializeCanonicalHost: async (initialization) => {
        canonicalInitializationStarted = true;
        await recordStage(context, STAGE_CANONICAL_INITIALIZATION_STARTED, "STARTED");
        await options.initializeCanonicalHost(initialization);
      },
    });
    const admittedContinuityEpochId = admission.continuityEpochId;
    canonicalInitializationSucceeded = true;
    await recordStage(context, STAGE_CANONICAL_INITIALIZATION_SUCCEEDED, "SUCCEEDED");

    context.assertOwnership();
    privatePostgres.onHandedOff?.();
    const host = createContext(context, activeLeaseConnection, activeToken);
    const handoff: HostHandoffSuccess = {
      kind: "HOST",
      host,
      ...(privatePostgresDescriptor === undefined
        ? {}
        : {
            managedHost: createManagedHostFromRawHost(
              context,
              options,
              privatePostgresDescriptor,
              host,
              admittedContinuityEpochId,
            ),
          }),
      continuityEpochId: admittedContinuityEpochId,
    };
    try {
      host.assertActive();
    } catch {
      throw ownershipLostDuringHandoffProblem();
    }
    terminalHandoff = true;
    return handoff;
  } catch (error) {
    if (reservation !== undefined && !reservationReleased) {
      await reservation.release().catch(() => undefined);
    }
    if (leaseConnection !== undefined) {
      await leaseConnection.close().catch(() => undefined);
    }

    if (
      !terminalHandoff &&
      reservationReleased &&
      privatePostgres.cleanupAfterFailedHandoff !== undefined
    ) {
      await privatePostgres.cleanupAfterFailedHandoff().catch(() => undefined);
    }

    if (!terminalHandoff) {
      if (canonicalInitializationStarted && !canonicalInitializationSucceeded) {
        await recordStage(
          context,
          STAGE_CANONICAL_INITIALIZATION_FAILED,
          "FAILED",
          problemCodeOf(error) ?? "bootstrap.host.canonical_initialization_failed",
        ).catch(() => undefined);
      }
      await recordStage(
        context,
        STAGE_HANDOFF_FAILED,
        "FAILED",
        problemCodeOf(error),
      ).catch(() => undefined);
    }
    throw error;
  }
}

async function releaseBootstrapOwnershipAfterHandoff(
  context: HostHandoffContext,
  handoff: HostHandoffResult,
  beforeBootstrapRelease?: () => Promise<void>,
): Promise<HostHandoffSuccess> {
  if (handoff.kind === "YIELDED") {
    context.assertOwnership();
    await context.ownership.release();
    throw existingOwnerProblem();
  }
  try {
    await beforeBootstrapRelease?.();
    context.assertOwnership();
    await recordStage(context, STAGE_FORWARD_HANDOFF_COMPLETED, "SUCCEEDED");
  } catch (error) {
    await handoff.host.close().catch(() => undefined);
    throw error;
  }
  try {
    await context.ownership.release();
  } catch {
    await handoff.host.close().catch(() => undefined);
    throw releaseUncertainProblem();
  }
  try {
    handoff.host.assertActive();
  } catch {
    await handoff.host.close().catch(() => undefined);
    throw ownershipLostDuringHandoffProblem();
  }
  return handoff;
}

function preparedHandoffPrivatePostgres(
  context: OwnedBootstrapPreludeHandoffContext,
  ready: ReadyPrivatePostgres,
): HandoffPrivatePostgres {
  const sessionToken = context.assertReady(ready);
  return {
    installationId: ready.installationId,
    instanceId: ready.instanceId,
    bootId: ready.bootId,
    port: ready.port,
    onHandedOff: () => context.privatePostgresSession.markHandedOff(sessionToken),
    onYieldedToExistingHost: () =>
      context.privatePostgresSession.markYieldedToExistingHost(sessionToken),
    cleanupAfterFailedHandoff: async () => {
      if (
        ready.startupDisposition !== "STARTED_BY_THIS_BOOTSTRAP" ||
        context.privatePostgresSession.state !== "READY"
      ) {
        return;
      }
      context.assertOwnership();
      await ready.stop();
    },
  };
}

/**
 * Runs the ordinary forward Host handoff while allowing a selected recovery
 * owner to durably finalize its witness before Bootstrap ownership release.
 * Token publication, canonical admission, and Host context construction all
 * remain in the ordinary handoff implementation above.
 */
export async function handoffPrivatePostgresToManagedHostForOwnedPreludeWithFinalization(
  context: OwnedBootstrapPreludeHandoffContext,
  ready: ReadyPrivatePostgres,
  options: HostOwnershipHandoffOptions,
  finalization: HandoffFinalization,
): Promise<BootstrapManagedHostContext> {
  const privatePostgres = getPrivatePostgresMaintenanceDescriptor(ready);
  const handoff = await handoffPrivatePostgresToHostInternal(
    context,
    preparedHandoffPrivatePostgres(context, ready),
    options,
    privatePostgres,
  );
  return (
    await releaseBootstrapOwnershipAfterHandoff(
      context,
      handoff,
      finalization.beforeBootstrapRelease,
    )
  ).managedHost!;
}

/** Transfers an owned private PostgreSQL session into raw Host ownership. */
export async function handoffPrivatePostgresToHostForOwnedPrelude(
  context: OwnedBootstrapPreludeHandoffContext,
  ready: ReadyPrivatePostgres,
  options: HostOwnershipHandoffOptions,
): Promise<HostOwnershipContext> {
  const handoff = await handoffPrivatePostgresToHostInternal(
    context,
    preparedHandoffPrivatePostgres(context, ready),
    options,
  );
  return (await releaseBootstrapOwnershipAfterHandoff(context, handoff)).host;
}

/** Transfers an owned private PostgreSQL session into the managed Host wrapper. */
export async function handoffPrivatePostgresToManagedHostForOwnedPrelude(
  context: OwnedBootstrapPreludeHandoffContext,
  ready: ReadyPrivatePostgres,
  options: HostOwnershipHandoffOptions,
): Promise<BootstrapManagedHostContext> {
  const privatePostgres = getPrivatePostgresMaintenanceDescriptor(ready);
  const handoff = await handoffPrivatePostgresToHostInternal(
    context,
    preparedHandoffPrivatePostgres(context, ready),
    options,
    privatePostgres,
  );
  return (await releaseBootstrapOwnershipAfterHandoff(context, handoff)).managedHost!;
}

function createMaintenanceHandoffContext(
  context: HostHandoffContext,
  window: EnteredMaintenanceWindow,
): HostHandoffContext {
  const instanceRoot = context.paths.resolve("INSTANCE").canonicalPath;
  return {
    installationId: context.installationId,
    instanceId: context.instanceId,
    bootId: createBootId(),
    bootstrapActivityId: context.bootstrapActivityId,
    paths: context.paths,
    ownership: window.lease,
    assertOwnership: () => assertBootstrapOwnershipFor(window.lease, instanceRoot),
    state: window.access.state,
    journal: context.journal,
  };
}

/** Reuses the ordinary Host handoff owner after maintenance restart readiness. */
async function handoffRestartedPrivatePostgresToManagedHost(
  context: HostHandoffContext,
  options: HostOwnershipHandoffOptions,
  privatePostgres: PrivatePostgresMaintenanceDescriptor,
  beforeBootstrapRelease: () => Promise<void>,
): Promise<BootstrapManagedHostContext> {
  const expected = privatePostgres.expectedIdentity;
  if (
    expected.installationId !== context.installationId ||
    expected.instanceId !== context.instanceId
  ) {
    throw handoffProblem(
      "bootstrap.host.private_postgres_identity_mismatch",
      "Private PostgreSQL identity does not match Host handoff",
      "Fresh Host reacquisition requires the current maintenance cluster identity",
      "integrity",
    );
  }
  const handoff = await handoffPrivatePostgresToHostInternal(
    context,
    {
      installationId: expected.installationId,
      instanceId: expected.instanceId,
      bootId: context.bootId,
      port: expected.persistedPort,
    },
    options,
    privatePostgres,
  );
  return (
    await releaseBootstrapOwnershipAfterHandoff(
      context,
      handoff,
      beforeBootstrapRelease,
    )
  ).managedHost!;
}
