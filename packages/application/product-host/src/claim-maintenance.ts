// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns the single process-local first-administrator claim timer. Canonical
 * claim mutation remains in Management; Product Host owns local publication.
 * @module claim-maintenance
 */

import type { FirstClaimMaterial } from "@heptalogos/management";

const CLAIM_RENEWAL_RETRY_MS = 5_000;

/** Package-private clock seam for deterministic claim lifecycle tests. */
export interface ClaimMaintenanceClock {
  /** Returns the current clock value in epoch milliseconds. */
  now(): number;
  /** Schedules one process-local callback. */
  setTimeout(callback: () => void, delayMs: number): unknown;
  /** Cancels one process-local callback. */
  clearTimeout(token: unknown): void;
}

const systemClock: ClaimMaintenanceClock = {
  now: Date.now,
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(token) {
    clearTimeout(token as ReturnType<typeof setTimeout>);
  },
};

/** The bounded local lifecycle owned by one running Product Host. */
export interface FirstClaimMaintenance {
  /** Stops renewal and removes the claim projection after successful claim. */
  administratorClaimed(): Promise<void>;
  /** Cancels renewal when the owning Host closes. */
  close(): void;
}

/** Starts local publication and renewal for an unclaimed installation. */
export async function startFirstClaimMaintenance(options: {
  readonly readLocalClaim: () => Promise<FirstClaimMaterial | undefined>;
  readonly ensureClaim: (
    localClaim?: FirstClaimMaterial,
  ) => Promise<FirstClaimMaterial | undefined>;
  readonly publishClaim: (claim: FirstClaimMaterial) => Promise<void>;
  readonly removeClaim: () => Promise<void>;
  readonly clock?: ClaimMaintenanceClock;
}): Promise<FirstClaimMaintenance> {
  const clock = options.clock ?? systemClock;
  let active = true;
  let timer: unknown;

  const cancelTimer = (): void => {
    if (timer === undefined) return;
    clock.clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (delayMs: number, operation: () => Promise<void>): void => {
    cancelTimer();
    timer = clock.setTimeout(
      () => {
        timer = undefined;
        void operation();
      },
      Math.max(0, delayMs),
    );
  };
  const scheduleClaim = (claim: FirstClaimMaterial): void => {
    schedule(Date.parse(claim.expiresAt) - clock.now(), renew);
  };
  const renew = async (): Promise<void> => {
    if (!active) return;
    try {
      const claim = await options.ensureClaim();
      if (!active) return;
      if (claim === undefined) {
        active = false;
        await options.removeClaim();
        return;
      }
      await options.publishClaim(claim);
      if (active) scheduleClaim(claim);
    } catch {
      if (active) schedule(CLAIM_RENEWAL_RETRY_MS, renew);
    }
  };

  const localClaim = await options.readLocalClaim();
  const claim = await options.ensureClaim(localClaim);
  if (claim === undefined) {
    active = false;
    await options.removeClaim();
  } else {
    await options.publishClaim(claim);
    scheduleClaim(claim);
  }

  return Object.freeze({
    async administratorClaimed() {
      active = false;
      cancelTimer();
      await options.removeClaim();
    },
    close() {
      active = false;
      cancelTimer();
    },
  });
}
