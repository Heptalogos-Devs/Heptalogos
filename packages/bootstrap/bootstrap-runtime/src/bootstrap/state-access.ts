// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Couples BootstrapState store access to an acquired Bootstrap lease so state
 * reads and writes cannot outlive the authority that opened them.
 * @module bootstrap/state-access
 */

import { join } from "node:path";
import {
  BootstrapJournal,
  BootstrapStateStore,
  type BootstrapStateBody,
  type BootstrapStateEnvelope,
  type BootstrapStateLoadResult,
} from "@heptalogos/bootstrap-state";
import {
  assertBootstrapOwnershipFor,
  type BootstrapOwnershipLease,
} from "./ownership.js";
import type { BootstrapPathProfile } from "./roots.js";

/** Exposes BootstrapState operations bound to a live Bootstrap ownership lease. */
export interface OwnedBootstrapStateStore {
  /** Loads the current durable BootstrapState evidence. */
  load(): Promise<BootstrapStateLoadResult>;
  /** Commits a new state body through the owned atomic store. */
  commit(candidate: BootstrapStateBody): Promise<BootstrapStateEnvelope>;
}

/** Groups the store and journal handles used by the Bootstrap prelude. */
export interface BootstrapStateAccess {
  readonly journal: BootstrapJournal;
  readonly state: OwnedBootstrapStateStore;
}

const BOOTSTRAP_STATE_DIRECTORY = "bootstrap-state";

/** Opens BootstrapState stores under the supplied ownership capability. */
export function openBootstrapStateAccess(
  profile: BootstrapPathProfile,
  lease: BootstrapOwnershipLease,
): BootstrapStateAccess {
  const instanceRoot = profile.resolve("INSTANCE").canonicalPath;
  assertBootstrapOwnershipFor(lease, instanceRoot);
  const rawState = new BootstrapStateStore(
    join(instanceRoot, BOOTSTRAP_STATE_DIRECTORY),
  );
  const journal = new BootstrapJournal(instanceRoot);

  return {
    journal,
    state: {
      load(): Promise<BootstrapStateLoadResult> {
        return rawState.load();
      },
      async commit(candidate: BootstrapStateBody): Promise<BootstrapStateEnvelope> {
        assertBootstrapOwnershipFor(lease, instanceRoot);
        return rawState.commit(candidate);
      },
    },
  };
}
