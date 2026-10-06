// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns Host lease acquisition, heartbeat, fencing, and release orchestration
 * over the single canonical PostgreSQL ownership Authority.
 * @module host-ownership
 */

import {
  createProblemError,
  parseBootId,
  parseHostOwnershipToken,
  ProblemError,
  type BootId,
  type HostOwnershipToken,
  type InstanceId,
} from "@heptalogos/foundation-contracts";
import { HOST_OWNERSHIP_FENCE_TABLE, HOST_OWNERSHIP_SCHEMA } from "./contracts.js";
import type { HostLeaseConnection } from "./host-lease-connection.js";
import type { BootstrapMutationAuthority } from "./bootstrap-authority.js";
import {
  FENCE_AFTER_COMMIT,
  FENCE_FOR_UPDATE,
  type HostOwnershipFenceRow,
} from "./fence-queries.js";

/** Supplies connection, token, and authority inputs for token publication. */
export interface PublishHostOwnershipTokenOptions {
  readonly connection: HostLeaseConnection;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly token: HostOwnershipToken;
  readonly fenceLockTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly mutationAuthority: BootstrapMutationAuthority;
}

/** Reports the fence revision before and after token publication. */
export interface HostOwnershipPublicationResult {
  readonly previousRevision: string;
  readonly publishedRevision: string;
}

async function authorizedConnectionQuery<Row = never>(
  connection: HostLeaseConnection,
  authority: BootstrapMutationAuthority,
  text: string,
  values?: readonly unknown[],
): Promise<{ readonly rows: readonly Row[] }> {
  authority.assertCurrent();
  const result = await connection.query<Row>(text, values);
  authority.assertCurrent();
  return result;
}

function publicationProblem(
  problemCode: string,
  title: string,
  detail: string,
): ProblemError {
  return createProblemError({
    problemCode,
    category: "host-ownership",
    retryClass: "manual",
    title,
    detail,
  });
}

function invalidFenceProblem(): ProblemError {
  return publicationProblem(
    "host-ownership.fence.incompatible",
    "HostOwnershipFence row is incompatible",
    "The canonical HostOwnershipFence row did not satisfy the expected singleton identity shape",
  );
}

function instanceMismatchProblem(): ProblemError {
  return publicationProblem(
    "host-ownership.fence.instance_mismatch",
    "HostOwnershipFence belongs to another instance",
    "The current HostOwnershipFence row has a different InstanceId",
  );
}

function publicationCommittedUnverifiedProblem(): ProblemError {
  return publicationProblem(
    "host-ownership.publication.committed_unverified",
    "HostOwnershipToken publication could not be verified",
    "The committed HostOwnershipFence row did not contain the new token and BootId",
  );
}

function publicationKnownNotCommittedProblem(): ProblemError {
  return publicationProblem(
    "host-ownership.publication.known_not_committed",
    "HostOwnershipToken publication was not committed",
    "The publication transaction failed before COMMIT and was rolled back",
  );
}

function publicationCommitUncertainProblem(): ProblemError {
  return publicationProblem(
    "host-ownership.publication.commit_uncertain",
    "HostOwnershipToken publication commit is uncertain",
    "The publication COMMIT was issued but its outcome could not be proven",
  );
}

function revisionText(value: string | number): string {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw invalidFenceProblem();
}

function nextRevision(previousRevision: string): string {
  return (BigInt(previousRevision) + 1n).toString();
}

function assertFenceRow(row: HostOwnershipFenceRow, instanceId: InstanceId): string {
  if (
    row.singleton !== true ||
    row.instance_id !== instanceId ||
    (row.host_ownership_token !== null &&
      parseHostOwnershipToken(row.host_ownership_token) === undefined) ||
    (row.boot_id !== null && parseBootId(row.boot_id) === undefined)
  ) {
    if (row.instance_id !== instanceId) throw instanceMismatchProblem();
    throw invalidFenceProblem();
  }
  return revisionText(row.ownership_revision);
}

function assertPublishedRow(
  row: HostOwnershipFenceRow,
  instanceId: InstanceId,
  token: HostOwnershipToken,
  bootId: BootId,
): void {
  if (
    row.singleton !== true ||
    row.instance_id !== instanceId ||
    row.host_ownership_token !== token ||
    row.boot_id !== bootId
  ) {
    throw publicationCommittedUnverifiedProblem();
  }
}

/** Publishes the current Host token through the database-visible fence. */
export async function publishHostOwnershipToken(
  options: PublishHostOwnershipTokenOptions,
): Promise<HostOwnershipPublicationResult> {
  const { connection } = options;
  connection.assertActive();
  let commitIssued = false;
  let commitAcknowledged = false;
  let transactionOpen = false;
  try {
    await authorizedConnectionQuery(connection, options.mutationAuthority, "BEGIN");
    transactionOpen = true;
    await authorizedConnectionQuery(
      connection,
      options.mutationAuthority,
      "SELECT set_config('lock_timeout', $1, true)",
      [`${options.fenceLockTimeoutMs}ms`],
    );
    await authorizedConnectionQuery(
      connection,
      options.mutationAuthority,
      "SELECT set_config('statement_timeout', $1, true)",
      [`${options.statementTimeoutMs}ms`],
    );
    const locked = await authorizedConnectionQuery<HostOwnershipFenceRow>(
      connection,
      options.mutationAuthority,
      FENCE_FOR_UPDATE,
    );
    if (locked.rows.length !== 1) throw invalidFenceProblem();
    const previousRevision = assertFenceRow(locked.rows[0], options.instanceId);
    await authorizedConnectionQuery(
      connection,
      options.mutationAuthority,
      `UPDATE "${HOST_OWNERSHIP_SCHEMA}"."${HOST_OWNERSHIP_FENCE_TABLE}"
SET ownership_revision = ownership_revision + 1,
    host_ownership_token = $1,
    boot_id = $2
WHERE singleton = true`,
      [options.token, options.bootId],
    );
    options.mutationAuthority.assertCurrent();
    commitIssued = true;
    try {
      await connection.query("COMMIT");
    } catch {
      throw publicationCommitUncertainProblem();
    }
    commitAcknowledged = true;
    transactionOpen = false;

    let verified: { readonly rows: readonly HostOwnershipFenceRow[] };
    try {
      verified = await authorizedConnectionQuery<HostOwnershipFenceRow>(
        connection,
        options.mutationAuthority,
        FENCE_AFTER_COMMIT,
      );
    } catch {
      throw publicationCommittedUnverifiedProblem();
    }
    if (verified.rows.length !== 1) throw publicationCommittedUnverifiedProblem();
    assertPublishedRow(
      verified.rows[0],
      options.instanceId,
      options.token,
      options.bootId,
    );
    const publishedRevision = nextRevision(previousRevision);
    if (revisionText(verified.rows[0].ownership_revision) !== publishedRevision) {
      throw publicationCommittedUnverifiedProblem();
    }
    return { previousRevision, publishedRevision };
  } catch (error) {
    if (!commitIssued && transactionOpen && connection.state === "ACTIVE") {
      await connection.query("ROLLBACK").catch(() => undefined);
      transactionOpen = false;
    }
    if (connection.state === "ACTIVE") connection.fence("token publication failure");
    if (error instanceof ProblemError) throw error;
    if (commitIssued && !commitAcknowledged) {
      throw publicationCommitUncertainProblem();
    }
    if (commitAcknowledged) throw publicationCommittedUnverifiedProblem();
    throw publicationKnownNotCommittedProblem();
  }
}
