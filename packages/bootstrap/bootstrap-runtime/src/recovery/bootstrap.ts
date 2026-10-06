// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inspects interrupted Bootstrap ownership and maintenance state and projects
 * it into recovery dispositions without silently performing recovery work.
 * @module recovery/bootstrap
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  BootstrapOwnerWitnessStore,
  BootstrapStateStore,
  type BootstrapActivityId,
  type BootstrapOwnerWitnessEnvelopeV1,
  type BootstrapStateLoadResult,
  type MaintenanceJournalLoadResult,
  type MaintenanceOperationId,
} from "@heptalogos/bootstrap-state";
import {
  createProblem,
  createProblemError,
  ProblemError,
  createBootId,
  createUuidV7Id,
  type BootId,
  type InstallationId,
  type InstanceId,
  type Problem,
} from "@heptalogos/foundation-contracts";
import {
  inspectBootstrapProcessIdentity,
  type BootstrapProcessIdentityStatus,
} from "../bootstrap/process-identity.js";
import {
  acquireBootstrapOwnership,
  acquireBootstrapRecoveryOwnership,
  BOOTSTRAP_RECOVERY_STALE_MS,
  type BootstrapOwnershipLease,
  type BootstrapOwnershipOptions,
} from "../bootstrap/ownership.js";
import {
  assertLocalInstallationOwnerFor,
  type LocalInstallationOwnerRecoveryPrincipal,
} from "../bootstrap/local-installation-owner.js";
import { loadBootstrapLocator } from "../bootstrap/locator.js";
import { resolveBootstrapPathProfile } from "../bootstrap/roots.js";
import { hasNodeErrorCode } from "../shared/error-code.js";
import { problemCodeOf } from "../shared/problem-code.js";
import {
  inspectMaintenanceObligation,
  type MaintenanceObligationInspection,
} from "../maintenance/obligation.js";
import {
  adoptRecoveredBootstrapOwnershipForPrelude,
  type OwnedBootstrapPrelude,
} from "../bootstrap/prelude.js";
import type { HostOwnershipHandoffOptions } from "../host/handoff.js";
import type { PreparePrivatePostgresOptions } from "../postgres/bootstrap.js";
import type { BootstrapManagedHostContext } from "../host/managed-host.js";

const BOOTSTRAP_LOCK_DIRECTORY = ".heptalogos-bootstrap.lock";
const BOOTSTRAP_STATE_DIRECTORY = "bootstrap-state";
const DEFAULT_BOOTSTRAP_HEARTBEAT_MS = 1_000;
const RECOVERY_ROOTS = ["INSTANCE"] as const;

/** Classifies whether current Bootstrap evidence requires recovery or blocks it. */
export type BootstrapRecoveryDisposition =
  | "NO_RECOVERY_REQUIRED"
  | "ACTIVE_BOOTSTRAP_OWNER"
  | "ABANDONED_OWNER_ELIGIBLE"
  | "INCOMPLETE_MAINTENANCE"
  | "BLOCKED";

/** Collects read-only lock, witness, state, and maintenance recovery evidence. */
export interface BootstrapRecoveryInspection {
  readonly anchorRoot: string;
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly instanceRoot: string;
  readonly recoveryBootId: BootId;
  readonly recoveryActivityId: BootstrapActivityId;
  readonly disposition: BootstrapRecoveryDisposition;
  readonly lockPresent: boolean;
  readonly lockAgeMs?: number;
  readonly owner?: BootstrapOwnerWitnessEnvelopeV1;
  readonly ownerProcessStatus?: BootstrapProcessIdentityStatus;
  readonly attempts: readonly BootstrapOwnerWitnessEnvelopeV1[];
  readonly attemptProcessStatuses: readonly BootstrapProcessIdentityStatus[];
  readonly releasing: readonly BootstrapOwnerWitnessEnvelopeV1[];
  readonly releasingProcessStatuses: readonly BootstrapProcessIdentityStatus[];
  readonly bootstrapState: BootstrapStateLoadResult;
  readonly operationId?: MaintenanceOperationId;
  readonly maintenance?: MaintenanceJournalLoadResult;
  readonly maintenanceIncomplete: boolean;
  readonly problem?: Problem;
}

interface LockObservation {
  readonly present: boolean;
  readonly ageMs?: number;
  readonly problem?: Problem;
}

type MaintenanceObservation = MaintenanceObligationInspection;

function problem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "integrity",
): Problem {
  return createProblem({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

function recoveryConflict(
  problemCode: string,
  title: string,
  detail: string,
): ProblemError {
  return createProblemError({
    problemCode,
    category: "conflict",
    retryClass: "manual",
    title,
    detail,
  });
}

async function observeLock(instanceRoot: string): Promise<LockObservation> {
  try {
    const entry = await stat(join(instanceRoot, BOOTSTRAP_LOCK_DIRECTORY));
    return {
      present: true,
      ageMs: Math.max(0, Date.now() - entry.mtimeMs),
    };
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) return { present: false };
    return {
      present: false,
      problem: problem(
        "bootstrap.recovery.lock_inspection_failed",
        "Bootstrap lock could not be inspected",
        "The bootstrap lock could not be stat-ed without changing it",
        "unavailable",
      ),
    };
  }
}

function classify(
  lock: LockObservation,
  ownerProcessStatus: BootstrapProcessIdentityStatus | undefined,
  hasOwnerWitness: boolean,
  attemptProcessStatuses: readonly BootstrapProcessIdentityStatus[],
  releasingProcessStatuses: readonly BootstrapProcessIdentityStatus[],
  maintenance: MaintenanceObservation,
): BootstrapRecoveryDisposition {
  if (lock.problem !== undefined || maintenance.problem !== undefined) {
    return "BLOCKED";
  }

  const statuses = [
    ...(ownerProcessStatus === undefined ? [] : [ownerProcessStatus]),
    ...attemptProcessStatuses,
    ...(lock.present && !hasOwnerWitness ? releasingProcessStatuses : []),
  ];
  if (!lock.present) {
    const ownerAttemptStatuses = [
      ...(ownerProcessStatus === undefined ? [] : [ownerProcessStatus]),
      ...attemptProcessStatuses,
    ];
    if (
      ownerAttemptStatuses.includes("SAME_PROCESS") ||
      ownerAttemptStatuses.includes("UNKNOWN")
    ) {
      return "BLOCKED";
    }
    return maintenance.incomplete ? "INCOMPLETE_MAINTENANCE" : "NO_RECOVERY_REQUIRED";
  }

  if (statuses.includes("SAME_PROCESS")) return "ACTIVE_BOOTSTRAP_OWNER";
  if (statuses.includes("UNKNOWN")) return "BLOCKED";

  if ((lock.ageMs ?? 0) < BOOTSTRAP_RECOVERY_STALE_MS) return "BLOCKED";
  if (statuses.length === 0) return "BLOCKED";

  // An old lock with only PROCESS_DEAD evidence is the one case in which the
  // existing lock protocol may be asked to reclaim ownership. The
  // maintenance pointer is returned alongside this disposition so the later
  // executor can recover the bounded operation under the newly held lease.
  return "ABANDONED_OWNER_ELIGIBLE";
}

/** Inspects current Bootstrap recovery evidence without mutating ownership. */
export async function inspectBootstrapRecovery(
  anchorRoot: string,
): Promise<BootstrapRecoveryInspection> {
  const locator = await loadBootstrapLocator(anchorRoot);
  const paths = await resolveBootstrapPathProfile(locator, RECOVERY_ROOTS);
  const instanceRoot = paths.resolve("INSTANCE").canonicalPath;
  const installationId = locator.installationId;
  const instanceId = locator.instanceId;
  const recoveryBootId = createBootId();
  const recoveryActivityId = createUuidV7Id("ActivityId");
  const lock = await observeLock(instanceRoot);
  const witnessStore = new BootstrapOwnerWitnessStore(instanceRoot);
  let owner: BootstrapOwnerWitnessEnvelopeV1 | undefined;
  let attempts: readonly BootstrapOwnerWitnessEnvelopeV1[] = [];
  let releasing: readonly BootstrapOwnerWitnessEnvelopeV1[] = [];
  let witnessProblem: Problem | undefined;
  try {
    owner = await witnessStore.readOwner();
    attempts = await witnessStore.listAttempts();
    releasing = await witnessStore.listReleasing();
  } catch (error) {
    witnessProblem = problem(
      "bootstrap.recovery.witness_inspection_failed",
      "Bootstrap owner witness could not be inspected",
      problemCodeOf(error) ??
        "Bootstrap owner or attempt witness evidence is corrupt or unavailable",
    );
  }

  const ownerProcessStatus =
    owner === undefined
      ? undefined
      : await inspectBootstrapProcessIdentity({
          pid: owner.witness.pid,
          startedAtMs: owner.witness.processStartedAtMs,
        });
  const attemptProcessStatuses = await Promise.all(
    attempts.map((attempt) =>
      inspectBootstrapProcessIdentity({
        pid: attempt.witness.pid,
        startedAtMs: attempt.witness.processStartedAtMs,
      }),
    ),
  );
  const releasingProcessStatuses = await Promise.all(
    releasing.map((witness) =>
      inspectBootstrapProcessIdentity({
        pid: witness.witness.pid,
        startedAtMs: witness.witness.processStartedAtMs,
      }),
    ),
  );

  let bootstrapState: BootstrapStateLoadResult = { status: "EMPTY" };
  let stateProblem: Problem | undefined;
  try {
    bootstrapState = await new BootstrapStateStore(
      join(instanceRoot, BOOTSTRAP_STATE_DIRECTORY),
    ).load();
  } catch (error) {
    stateProblem = problem(
      "bootstrap.recovery.state_inspection_failed",
      "BootstrapState could not be inspected",
      problemCodeOf(error) ?? "BootstrapState could not be loaded read-only",
      "unavailable",
    );
  }

  const maintenance =
    stateProblem === undefined
      ? await inspectMaintenanceObligation(instanceRoot, bootstrapState)
      : { incomplete: false, problem: stateProblem };
  const effectiveProblem = lock.problem ?? witnessProblem ?? maintenance.problem;
  const disposition = classify(
    effectiveProblem === undefined ? lock : { ...lock, problem: effectiveProblem },
    ownerProcessStatus,
    owner !== undefined,
    attemptProcessStatuses,
    releasingProcessStatuses,
    maintenance,
  );

  return {
    anchorRoot,
    installationId,
    instanceId,
    instanceRoot,
    recoveryBootId,
    recoveryActivityId,
    disposition,
    lockPresent: lock.present,
    ...(lock.ageMs === undefined ? {} : { lockAgeMs: lock.ageMs }),
    ...(owner === undefined ? {} : { owner, ownerProcessStatus }),
    attempts,
    attemptProcessStatuses,
    releasing,
    releasingProcessStatuses,
    bootstrapState,
    maintenanceIncomplete: maintenance.incomplete,
    ...(maintenance.operationId === undefined
      ? {}
      : { operationId: maintenance.operationId }),
    ...(maintenance.maintenance === undefined
      ? {}
      : { maintenance: maintenance.maintenance }),
    ...(effectiveProblem === undefined ? {} : { problem: effectiveProblem }),
  };
}

/** Reclaims an abandoned owner only after the local installation owner is proved. */
export async function reclaimAbandonedBootstrapOwnership(
  anchorRoot: string,
  principal: LocalInstallationOwnerRecoveryPrincipal,
  options: BootstrapOwnershipOptions,
): Promise<BootstrapOwnershipLease> {
  return acquireBootstrapRecoveryLease(anchorRoot, principal, options, [
    "ABANDONED_OWNER_ELIGIBLE",
  ]);
}

/** Acquires and rechecks a recovery lease for an explicitly allowed disposition. */
export async function acquireBootstrapRecoveryLease(
  anchorRoot: string,
  principal: LocalInstallationOwnerRecoveryPrincipal,
  options: BootstrapOwnershipOptions,
  allowedDispositions: readonly BootstrapRecoveryDisposition[] = [
    "ABANDONED_OWNER_ELIGIBLE",
    "INCOMPLETE_MAINTENANCE",
  ],
): Promise<BootstrapOwnershipLease> {
  const locator = await loadBootstrapLocator(anchorRoot);
  const paths = await resolveBootstrapPathProfile(locator, RECOVERY_ROOTS);
  const instanceRoot = paths.resolve("INSTANCE");
  assertLocalInstallationOwnerFor(
    principal,
    locator.installationId,
    locator.instanceId,
    instanceRoot.canonicalPath,
  );

  const inspection = await inspectBootstrapRecovery(anchorRoot);
  if (!allowedDispositions.includes(inspection.disposition)) {
    throw recoveryConflict(
      "bootstrap.recovery.not_eligible",
      "Bootstrap ownership is not eligible for recovery",
      `Recovery does not allow ${inspection.disposition} for this operation`,
    );
  }

  const lease =
    inspection.disposition === "ABANDONED_OWNER_ELIGIBLE"
      ? await acquireBootstrapRecoveryOwnership(instanceRoot, options)
      : await acquireBootstrapOwnership(instanceRoot, options);
  try {
    const rechecked = await inspectBootstrapRecovery(anchorRoot);
    if (rechecked.disposition !== "ACTIVE_BOOTSTRAP_OWNER") {
      throw recoveryConflict(
        "bootstrap.recovery.eligibility_changed",
        "Bootstrap recovery eligibility changed during acquisition",
        `The recovered lease did not re-read as ACTIVE_BOOTSTRAP_OWNER; observed ${rechecked.disposition}`,
      );
    }
    return lease;
  } catch (error) {
    await lease.release().catch(() => undefined);
    throw error;
  }
}

/** Supplies the authority and handoff inputs for abandoned Bootstrap continuation. */
export interface AbandonedBootstrapContinuationOptions {
  readonly anchorRoot: string;
  readonly principal: LocalInstallationOwnerRecoveryPrincipal;
  readonly bootstrapHeartbeatMs?: number;
  readonly preparePrivatePostgres: PreparePrivatePostgresOptions;
  readonly handoff: HostOwnershipHandoffOptions;
}

/** Completes an eligible abandoned Bootstrap flow and hands it to Host ownership. */
export async function recoverAbandonedBootstrapToHost(
  options: AbandonedBootstrapContinuationOptions,
): Promise<BootstrapManagedHostContext> {
  const inspection = await inspectBootstrapRecovery(options.anchorRoot);
  if (
    inspection.disposition !== "ABANDONED_OWNER_ELIGIBLE" ||
    inspection.maintenanceIncomplete
  ) {
    throw recoveryConflict(
      "bootstrap.recovery.bootstrap_continuation_not_eligible",
      "Abandoned bootstrap continuation is not eligible",
      `Bootstrap continuation requires ABANDONED_OWNER_ELIGIBLE without incomplete maintenance; observed ${inspection.disposition} (maintenanceIncomplete=${inspection.maintenanceIncomplete})`,
    );
  }

  const recoveryBootId = createBootId();
  const recoveryActivityId = createUuidV7Id("ActivityId");
  const ownership = await acquireBootstrapRecoveryLease(
    options.anchorRoot,
    options.principal,
    {
      heartbeatMs: options.bootstrapHeartbeatMs ?? DEFAULT_BOOTSTRAP_HEARTBEAT_MS,
      bootId: recoveryBootId,
    },
    ["ABANDONED_OWNER_ELIGIBLE"],
  );

  let owned: OwnedBootstrapPrelude | undefined;
  try {
    owned = await adoptRecoveredBootstrapOwnershipForPrelude(
      options.anchorRoot,
      ownership,
      { bootId: recoveryBootId, bootstrapActivityId: recoveryActivityId },
    );
    const ready = await owned.preparePrivatePostgres(options.preparePrivatePostgres);
    return await owned.handoffPrivatePostgresToHost(ready, options.handoff);
  } catch (error) {
    if (owned !== undefined) {
      await owned.close().catch(() => undefined);
    } else {
      await ownership.release().catch(() => undefined);
    }
    throw error;
  }
}
