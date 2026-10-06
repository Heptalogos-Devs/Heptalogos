// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns the installation-scoped Bootstrap lease and its release/fencing rules;
 * higher orchestration must establish this authority before touching private
 * PostgreSQL or durable Bootstrap state.
 * @module bootstrap/ownership
 */

// Load the adopted provider before bootstrap-state's write-file-atomic transitive
// signal-exit adapter so provider exit cleanup remains registered.
import "@bybrave/proper-lockfile2";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  createProblem,
  formatInstant,
  ProblemError,
  type BootId,
  type Problem,
} from "@heptalogos/foundation-contracts";
import {
  BootstrapOwnerWitnessStore,
  createBootstrapLockGenerationId,
  type BootstrapOwnerWitnessBodyV1,
} from "@heptalogos/bootstrap-state";
import type { ResolvedLifecycleRoot } from "./roots.js";
import { currentBootstrapProcessIdentity } from "./process-identity.js";
import { nodeErrorCode } from "../shared/error-code.js";

type ProperLockOptions = {
  readonly stale: number;
  readonly update: number;
  readonly retries: number;
  readonly realpath: boolean;
  readonly lockfilePath: string;
  readonly onCompromised: (error: Error) => void;
  readonly onReclaimed?: () => void;
};

type ProperLockfile = {
  lock(file: string, options: ProperLockOptions): Promise<() => Promise<void>>;
};

const require = createRequire(import.meta.url);
const properLockfile = require("@bybrave/proper-lockfile2") as ProperLockfile;

const BOOTSTRAP_LOCK_DIRECTORY = ".heptalogos-bootstrap.lock";
const NO_AUTOMATIC_STALE_RECLAIM_MS = Number.MAX_SAFE_INTEGER;
/** Recovery-only stale threshold; normal acquisition never reclaims blindly. */
export const BOOTSTRAP_RECOVERY_STALE_MS = 30_000;
const MAX_RECOVERY_HEARTBEAT_MS = 15_000;

/** States the Bootstrap lease's authority and release progress. */
export type BootstrapOwnershipState = "HELD" | "RELEASING" | "COMPROMISED" | "RELEASED";

/** Represents the capability required to act under Bootstrap ownership. */
export interface BootstrapOwnershipLease {
  readonly state: BootstrapOwnershipState;
  readonly signal: AbortSignal;
  /** Throws when ownership has been released or its fence was compromised. */
  assertHeld(): void;
  /** Releases the lease once and shares the same completion promise on repeats. */
  release(): Promise<void>;
}

/** Supplies heartbeat and boot identity inputs for lease acquisition. */
export interface BootstrapOwnershipOptions {
  readonly heartbeatMs: number;
  readonly bootId: BootId;
}

interface IssuedOwnershipRecord {
  readonly canonicalInstanceRoot: string;
  readonly assertHeld: () => void;
}

const issuedOwnership = new WeakMap<BootstrapOwnershipLease, IssuedOwnershipRecord>();

function ownershipProblem(
  problemCode: string,
  category: string,
  retryClass: Problem["retryClass"],
  title: string,
  detail: string,
): Problem {
  return createProblem({
    problemCode,
    category,
    retryClass,
    title,
    detail,
  });
}

function assertHeartbeat(heartbeatMs: number): void {
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 1000) {
    throw new ProblemError(
      ownershipProblem(
        "bootstrap.ownership.invalid_heartbeat",
        "validation",
        "manual",
        "Bootstrap ownership heartbeat is invalid",
        "Bootstrap ownership heartbeatMs must be an integer of at least 1000 milliseconds",
      ),
    );
  }
}

function assertRecoveryHeartbeat(heartbeatMs: number): void {
  if (
    !Number.isInteger(heartbeatMs) ||
    heartbeatMs < 1_000 ||
    heartbeatMs > MAX_RECOVERY_HEARTBEAT_MS
  ) {
    throw new ProblemError(
      ownershipProblem(
        "bootstrap.ownership.invalid_recovery_heartbeat",
        "validation",
        "manual",
        "Bootstrap recovery heartbeat is invalid",
        "Recovery bootstrap heartbeatMs must be an integer between 1000 and 15000 milliseconds",
      ),
    );
  }
}

function lockPresentProblem(): Problem {
  return ownershipProblem(
    "bootstrap.ownership.lock_present",
    "conflict",
    "after-change",
    "Bootstrap ownership could not be acquired",
    "The instance bootstrap lock is present; it may belong to an active bootstrap attempt or require recovery",
  );
}

function compromisedProblem(): Problem {
  return ownershipProblem(
    "bootstrap.ownership.compromised",
    "integrity",
    "manual",
    "Bootstrap ownership was compromised",
    "The bootstrap ownership lease can no longer authorize mutation",
  );
}

function notHeldProblem(): Problem {
  return ownershipProblem(
    "bootstrap.ownership.not_held",
    "conflict",
    "after-change",
    "Bootstrap ownership is not held",
    "The bootstrap ownership lease is no longer held by this attempt",
  );
}

function invalidCapabilityProblem(): Problem {
  return ownershipProblem(
    "bootstrap.ownership.invalid_capability",
    "integrity",
    "manual",
    "Bootstrap ownership capability is invalid",
    "The bootstrap ownership capability was not issued by the bootstrap ownership adapter",
  );
}

function scopeMismatchProblem(): Problem {
  return ownershipProblem(
    "bootstrap.ownership.scope_mismatch",
    "conflict",
    "manual",
    "Bootstrap ownership scope does not match",
    "The bootstrap ownership capability is bound to a different instance",
  );
}

/** Verifies that a lease was issued for the requested canonical instance root. */
export function assertBootstrapOwnershipFor(
  lease: BootstrapOwnershipLease,
  canonicalInstanceRoot: string,
): void {
  const issued = issuedOwnership.get(lease);
  if (!issued) {
    throw new ProblemError(invalidCapabilityProblem());
  }
  if (issued.canonicalInstanceRoot !== canonicalInstanceRoot) {
    throw new ProblemError(scopeMismatchProblem());
  }
  issued.assertHeld();
}

async function acquireBootstrapOwnershipWithStalePolicy(
  instanceRoot: ResolvedLifecycleRoot,
  options: BootstrapOwnershipOptions,
  stale: number,
  recovery: boolean,
): Promise<BootstrapOwnershipLease> {
  if (recovery) assertRecoveryHeartbeat(options.heartbeatMs);
  else assertHeartbeat(options.heartbeatMs);

  const witnessStore = new BootstrapOwnerWitnessStore(instanceRoot.canonicalPath);
  const lockGenerationId = createBootstrapLockGenerationId();
  const processIdentity = currentBootstrapProcessIdentity();
  const createdAt = formatInstant(new Date());
  const attemptWitness: BootstrapOwnerWitnessBodyV1 = {
    schemaVersion: 1,
    phase: "ATTEMPT",
    lockGenerationId,
    bootId: options.bootId,
    pid: processIdentity.pid,
    processStartedAtMs: processIdentity.startedAtMs,
    heartbeatMs: options.heartbeatMs,
    createdAt,
  };
  await witnessStore.createAttempt(attemptWitness);

  let state: BootstrapOwnershipState = "HELD";
  let safeCompromisedCause: Problem | undefined;
  const abortController = new AbortController();
  const lockfilePath = join(instanceRoot.canonicalPath, BOOTSTRAP_LOCK_DIRECTORY);

  let releaseLock: () => Promise<void>;
  try {
    releaseLock = await properLockfile.lock(instanceRoot.canonicalPath, {
      stale,
      update: options.heartbeatMs,
      retries: 0,
      realpath: true,
      lockfilePath,
      onCompromised: () => {
        safeCompromisedCause = compromisedProblem();
        state = "COMPROMISED";
        abortController.abort();
      },
    });
  } catch (error) {
    try {
      await witnessStore.removeAttempt(lockGenerationId);
    } catch {
      throw new ProblemError(
        ownershipProblem(
          "bootstrap.ownership.witness_cleanup_failed",
          "integrity",
          "manual",
          "Bootstrap ownership witness cleanup failed",
          "The failed bootstrap ownership attempt could not remove its own ATTEMPT witness",
        ),
      );
    }
    if (nodeErrorCode(error) === "ELOCKED") {
      throw new ProblemError(lockPresentProblem());
    }
    throw new ProblemError(
      ownershipProblem(
        "bootstrap.ownership.acquire_failed",
        "unavailable",
        "manual",
        "Bootstrap ownership could not be acquired",
        "The bootstrap ownership lock could not be acquired",
      ),
    );
  }

  try {
    for (const releasing of await witnessStore.listReleasing()) {
      await witnessStore.removeReleasing(releasing.witness.lockGenerationId);
    }
    const ownerWitness: BootstrapOwnerWitnessBodyV1 = {
      ...attemptWitness,
      phase: "OWNER",
    };
    await witnessStore.publishOwner(ownerWitness);
    await witnessStore.removeAttempt(lockGenerationId);
  } catch (error) {
    const releasingWitness: BootstrapOwnerWitnessBodyV1 & {
      readonly phase: "RELEASING";
    } = {
      ...attemptWitness,
      phase: "RELEASING",
    };
    await witnessStore.publishReleasing(releasingWitness).catch(() => undefined);
    await witnessStore
      .removeCurrentOwnerWhileHeld(lockGenerationId)
      .catch(() => undefined);
    await releaseLock().catch(() => undefined);
    await witnessStore.removeReleasing(lockGenerationId).catch(() => undefined);
    await witnessStore.removeAttempt(lockGenerationId).catch(() => undefined);
    throw error;
  }

  let releasePromise: Promise<void> | undefined;
  const internalAssertHeld = (): void => {
    if (state === "HELD") return;
    if (state === "COMPROMISED") {
      throw new ProblemError(safeCompromisedCause ?? compromisedProblem());
    }
    throw new ProblemError(notHeldProblem());
  };

  const lease: BootstrapOwnershipLease = {
    get state() {
      return state;
    },
    get signal() {
      return abortController.signal;
    },
    assertHeld: internalAssertHeld,
    release() {
      if (releasePromise) return releasePromise;
      if (state === "RELEASED") return Promise.resolve();
      const releaseLockIsRequired = state === "HELD";
      state = "RELEASING";
      abortController.abort();
      releasePromise = (async () => {
        if (!releaseLockIsRequired) {
          state = "RELEASED";
          return;
        }
        const releasingWitness: BootstrapOwnerWitnessBodyV1 & {
          readonly phase: "RELEASING";
        } = {
          ...attemptWitness,
          phase: "RELEASING",
        };
        let providerLockReleased = false;
        try {
          await witnessStore.publishReleasing(releasingWitness);
          await witnessStore.removeCurrentOwnerWhileHeld(lockGenerationId);
          await releaseLock();
          providerLockReleased = true;
          await witnessStore.removeReleasing(lockGenerationId);
          if (safeCompromisedCause) {
            state = "COMPROMISED";
            throw new ProblemError(safeCompromisedCause);
          }
          state = "RELEASED";
        } catch {
          if (!providerLockReleased) {
            await releaseLock().catch(() => undefined);
          }
          safeCompromisedCause ??= compromisedProblem();
          state = "COMPROMISED";
          throw new ProblemError(safeCompromisedCause);
        }
      })();
      return releasePromise;
    },
  };

  issuedOwnership.set(lease, {
    canonicalInstanceRoot: instanceRoot.canonicalPath,
    assertHeld: internalAssertHeld,
  });
  Object.freeze(lease);

  return lease;
}

/** Acquires the normal non-reclaiming Bootstrap ownership lease. */
export async function acquireBootstrapOwnership(
  instanceRoot: ResolvedLifecycleRoot,
  options: BootstrapOwnershipOptions,
): Promise<BootstrapOwnershipLease> {
  return acquireBootstrapOwnershipWithStalePolicy(
    instanceRoot,
    options,
    NO_AUTOMATIC_STALE_RECLAIM_MS,
    false,
  );
}

/** Acquires Bootstrap ownership using the explicit recovery stale policy. */
export async function acquireBootstrapRecoveryOwnership(
  instanceRoot: ResolvedLifecycleRoot,
  options: BootstrapOwnershipOptions,
): Promise<BootstrapOwnershipLease> {
  return acquireBootstrapOwnershipWithStalePolicy(
    instanceRoot,
    options,
    BOOTSTRAP_RECOVERY_STALE_MS,
    true,
  );
}
