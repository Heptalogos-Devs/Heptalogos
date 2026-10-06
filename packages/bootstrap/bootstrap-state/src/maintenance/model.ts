// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the compact durable witness for one private-PostgreSQL maintenance
 * operation. The journal records current truth and phase, not a replayable
 * substep program.
 * @module maintenance/model
 */

import type {
  BootId,
  HostOwnershipToken,
  InstallationId,
  InstanceId,
  Problem,
  Sha256Digest,
  UuidV7Id,
} from "@heptalogos/foundation-contracts";

/** Identifies one durable private-PostgreSQL maintenance operation. */
export type MaintenanceOperationId = UuidV7Id<"MaintenanceOperationId">;
/** Identifies the Activity retained for one maintenance operation. */
export type MaintenanceActivityId = UuidV7Id<"ActivityId">;

/** Selects restart or stop behavior for a maintenance window. */
export type MaintenanceOperationType =
  "PRIVATE_POSTGRES_RESTART" | "PRIVATE_POSTGRES_STOP";

/** Records the current phase of one one-way maintenance operation. */
export type MaintenancePhase =
  "PREPARED" | "EXECUTING" | "RECOVERY_REQUIRED" | "SUCCEEDED" | "ABORTED";

/** Versioned durable witness for one Host/private-PostgreSQL operation. */
export interface MaintenanceJournalBodyV1 {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly operationId: MaintenanceOperationId;
  readonly activityId: MaintenanceActivityId;
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly operationType: MaintenanceOperationType;

  readonly source: {
    readonly hostOwnershipToken: HostOwnershipToken;
    readonly hostBootId: BootId;
    readonly hostOwnershipRevision: string;
    readonly postgresClusterSystemIdentifier: string;
    readonly persistedPort: number;
  };

  readonly target: {
    readonly privatePostgres: "RUNNING_SAME_IDENTITY" | "STOPPED";
  };

  readonly phase: MaintenancePhase;
  readonly updatedAt: string;
  readonly problemCode?: string;
}

/** Couples maintenance state with its canonical digest. */
export interface MaintenanceJournalEnvelopeV1 {
  readonly state: MaintenanceJournalBodyV1;
  readonly digest: Sha256Digest;
}

/** Reports an authenticated maintenance envelope or a parse Problem. */
export type MaintenanceJournalParseResult =
  | { readonly ok: true; readonly value: MaintenanceJournalEnvelopeV1 }
  | { readonly ok: false; readonly problem: Problem };

/** Reports empty, current, recovered-previous, or corrupt journal state. */
export type MaintenanceJournalLoadResult =
  | { readonly status: "EMPTY" }
  | {
      readonly status: "CURRENT";
      readonly value: MaintenanceJournalEnvelopeV1;
    }
  | {
      readonly status: "RECOVERED_PREVIOUS";
      readonly value: MaintenanceJournalEnvelopeV1;
      readonly problem: Problem;
    }
  | { readonly status: "CORRUPT"; readonly problem: Problem };
