// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Opens bounded access to maintenance state under the current Bootstrap
 * authority, preventing cleanup code from bypassing the durable store owner.
 * @module maintenance/state-access
 */

import {
  MaintenanceJournalStore,
  maintenanceOperationRef,
  type BootstrapStateBodyV1,
  type BootstrapStateEnvelopeV1,
  type BootstrapStateLoadResult,
  type MaintenanceOperationId,
  type PrivatePostgresBootstrapStateV1,
} from "@heptalogos/bootstrap-state";
import {
  assertBootstrapOwnershipFor,
  type BootstrapOwnershipLease,
} from "../bootstrap/ownership.js";
import {
  openBootstrapStateAccess,
  type BootstrapStateAccess,
  type OwnedBootstrapStateStore,
} from "../bootstrap/state-access.js";
import type { BootstrapPathProfile } from "../bootstrap/roots.js";
import { createProblemError, ProblemError } from "@heptalogos/foundation-contracts";

/** Couples the maintenance journal and current BootstrapState to one lease. */
export interface OwnedMaintenanceStateAccess {
  readonly journal: MaintenanceJournalStore;
  readonly state: OwnedBootstrapStateStore;
  /** Commits the current operation pointer only after identity checks pass. */
  commitOperationPointer(
    operationId: MaintenanceOperationId,
  ): Promise<BootstrapStateEnvelopeV1>;
}

function stateProblem(
  problemCode: string,
  title: string,
  detail: string,
): ProblemError {
  return createProblemError({
    problemCode,
    category: "integrity",
    retryClass: "manual",
    title,
    detail,
  });
}

type CurrentPrivatePostgresStateEnvelope = BootstrapStateEnvelopeV1 & {
  readonly state: BootstrapStateBodyV1 & {
    readonly privatePostgres: PrivatePostgresBootstrapStateV1;
  };
};

function requireCurrentPrivatePostgresState(
  loaded: BootstrapStateLoadResult,
  profile: BootstrapPathProfile,
): CurrentPrivatePostgresStateEnvelope {
  if (loaded.status === "EMPTY") {
    throw stateProblem(
      "maintenance.state.bootstrap_state_required",
      "BootstrapState is required for maintenance",
      "A MaintenanceJournal pointer requires authoritative BootstrapState",
    );
  }
  if (loaded.status === "CORRUPT") {
    throw new ProblemError(loaded.problem);
  }
  if (loaded.status === "RECOVERED_PREVIOUS") {
    throw stateProblem(
      "maintenance.journal.current_authority_required",
      "Current BootstrapState authority is required for maintenance",
      "A recovered previous BootstrapState revision is inspection evidence only and cannot authorize a MaintenanceJournal pointer",
    );
  }
  const privatePostgres = loaded.value.state.privatePostgres;
  if (privatePostgres === undefined) {
    throw stateProblem(
      "maintenance.state.private_postgres_required",
      "Private PostgreSQL state is required for maintenance",
      "Maintenance requires BootstrapState with canonical private PostgreSQL identity",
    );
  }
  if (
    privatePostgres.installationId !== profile.installationId ||
    privatePostgres.instanceId !== profile.instanceId
  ) {
    throw stateProblem(
      "maintenance.state.identity_mismatch",
      "BootstrapState identity does not match maintenance scope",
      "BootstrapState private PostgreSQL identity belongs to another installation or instance",
    );
  }
  return loaded.value as CurrentPrivatePostgresStateEnvelope;
}

/** Opens lease-bound maintenance state access and verifies current authority. */
export function openMaintenanceStateAccess(
  profile: BootstrapPathProfile,
  lease: BootstrapOwnershipLease,
): OwnedMaintenanceStateAccess {
  const instanceRoot = profile.resolve("INSTANCE").canonicalPath;
  const assertAuthority = (): void => {
    assertBootstrapOwnershipFor(lease, instanceRoot);
  };
  assertAuthority();

  const bootstrapAccess: BootstrapStateAccess = openBootstrapStateAccess(
    profile,
    lease,
  );
  const state: OwnedBootstrapStateStore = {
    async load() {
      assertAuthority();
      return bootstrapAccess.state.load();
    },
    async commit(candidate) {
      assertAuthority();
      return bootstrapAccess.state.commit(candidate);
    },
  };
  const journal = new MaintenanceJournalStore(instanceRoot, assertAuthority);

  return {
    journal,
    state,
    async commitOperationPointer(operationId) {
      assertAuthority();
      const current = requireCurrentPrivatePostgresState(await state.load(), profile);
      const candidate: BootstrapStateBodyV1 = {
        ...current.state,
        revision: current.state.revision + 1,
        lastCommittedOperationRef: maintenanceOperationRef(operationId),
      };
      assertAuthority();
      const committed = await state.commit(candidate);
      if (committed.state.privatePostgres === undefined) {
        throw stateProblem(
          "maintenance.state.pointer_commit_unverified",
          "Maintenance BootstrapState pointer commit is unverified",
          "The committed BootstrapState did not retain its canonical private PostgreSQL state",
        );
      }
      return committed as BootstrapStateEnvelopeV1;
    },
  };
}
