// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Revokes the current Host token and closes its mutation fence so ownership
 * loss is represented durably before the connection is released.
 * @module ownership-revocation
 */

import {
  createProblemError,
  parseBootId,
  parseHostOwnershipToken,
  ProblemError,
  type BootId,
  type HostOwnershipToken,
  type InstanceId,
  type Problem,
} from "@heptalogos/foundation-contracts";
import {
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  HOST_OWNERSHIP_FENCE_TABLE,
  HOST_OWNERSHIP_SCHEMA,
} from "./contracts.js";
import {
  type BootstrapAdminPasswordProvider,
  withBootstrapAdminClient,
} from "./bootstrap-admin.js";
import type { BootstrapMutationAuthority } from "./bootstrap-authority.js";
import { queryWithAuthority as authorizedQuery } from "./authorized-query.js";
import {
  FENCE_AFTER_COMMIT,
  FENCE_FOR_UPDATE,
  type HostOwnershipFenceRow,
} from "./fence-queries.js";

/** Reports the fence revision before and after token revocation. */
export interface HostOwnershipRevocationResult {
  readonly previousRevision: string;
  readonly revokedRevision: string;
}

/** Supplies Bootstrap-admin and identity inputs for Host token revocation. */
export interface RevokeHostOwnershipTokenOptions {
  readonly port: number;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly token: HostOwnershipToken;
  readonly lockTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly passwordProvider: BootstrapAdminPasswordProvider;
  readonly mutationAuthority: BootstrapMutationAuthority;
}

function revocationProblem(
  problemCode: string,
  category: Problem["category"],
  title: string,
  detail: string,
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

function knownNotCommitted(): ProblemError {
  return revocationProblem(
    "host-ownership.revocation.known_not_committed",
    "unavailable",
    "Host ownership revocation was not committed",
    "The fixed revocation transaction failed before COMMIT and was rolled back",
  );
}

function commitUncertain(): ProblemError {
  return revocationProblem(
    "host-ownership.revocation.commit_uncertain",
    "integrity",
    "Host ownership revocation commit is uncertain",
    "The revocation COMMIT was issued but its outcome could not be proven",
  );
}

function committedUnverified(): ProblemError {
  return revocationProblem(
    "host-ownership.revocation.committed_unverified",
    "integrity",
    "Host ownership revocation was committed but not verified",
    "The post-COMMIT HostOwnershipFence reread did not prove the exact revoked state",
  );
}

function revisionText(value: string | number): string {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw revocationProblem(
    "host-ownership.revocation.revision_mismatch",
    "integrity",
    "Host ownership revision is invalid",
    "The HostOwnershipFence ownership_revision is not an unsigned decimal value",
  );
}

function nextRevision(previousRevision: string): string {
  return (BigInt(previousRevision) + 1n).toString();
}

function assertSourceFence(
  row: HostOwnershipFenceRow,
  options: RevokeHostOwnershipTokenOptions,
): string {
  if (row.singleton !== true || row.instance_id !== options.instanceId) {
    throw revocationProblem(
      "host-ownership.revocation.instance_mismatch",
      "integrity",
      "Host ownership fence belongs to another instance",
      "The locked HostOwnershipFence row did not contain the current InstanceId",
    );
  }

  const previousRevision = revisionText(row.ownership_revision);
  if (
    row.host_ownership_token === null ||
    parseHostOwnershipToken(row.host_ownership_token) !== options.token ||
    row.host_ownership_token !== options.token
  ) {
    throw revocationProblem(
      "host-ownership.revocation.token_mismatch",
      "conflict",
      "Host ownership token does not match",
      "The locked HostOwnershipFence row did not contain the current HostOwnershipToken",
    );
  }
  if (
    row.boot_id === null ||
    parseBootId(row.boot_id) !== options.bootId ||
    row.boot_id !== options.bootId
  ) {
    throw revocationProblem(
      "host-ownership.revocation.boot_mismatch",
      "conflict",
      "Host ownership BootId does not match",
      "The locked HostOwnershipFence row did not contain the current BootId",
    );
  }
  return previousRevision;
}

function assertRevokedFence(
  row: HostOwnershipFenceRow,
  options: RevokeHostOwnershipTokenOptions,
  expectedRevision: string,
): void {
  if (
    row.singleton !== true ||
    row.instance_id !== options.instanceId ||
    revisionText(row.ownership_revision) !== expectedRevision ||
    row.host_ownership_token !== null ||
    row.boot_id !== null
  ) {
    throw committedUnverified();
  }
}

/** Revokes a Host token through the Bootstrap-authorized database path. */
export async function revokeHostOwnershipTokenForBootstrap(
  options: RevokeHostOwnershipTokenOptions,
): Promise<HostOwnershipRevocationResult> {
  let commitIssued = false;
  let commitAcknowledged = false;
  let transactionOpen = false;

  try {
    return await withBootstrapAdminClient(
      {
        port: options.port,
        database: HOST_OWNERSHIP_CANONICAL_DATABASE,
        passwordProvider: options.passwordProvider,
      },
      async (client) => {
        try {
          await authorizedQuery(client, options.mutationAuthority, "BEGIN");
          transactionOpen = true;
          await authorizedQuery(
            client,
            options.mutationAuthority,
            "SELECT set_config('lock_timeout', $1, true)",
            [`${options.lockTimeoutMs}ms`],
          );
          await authorizedQuery(
            client,
            options.mutationAuthority,
            "SELECT set_config('statement_timeout', $1, true)",
            [`${options.statementTimeoutMs}ms`],
          );

          const locked = await authorizedQuery<HostOwnershipFenceRow>(
            client,
            options.mutationAuthority,
            FENCE_FOR_UPDATE,
          );
          if (locked.rows.length !== 1) {
            throw revocationProblem(
              "host-ownership.revocation.revision_mismatch",
              "integrity",
              "Host ownership fence row is invalid",
              "The fixed HostOwnershipFence revocation query did not return exactly one row",
            );
          }
          const previousRevision = assertSourceFence(locked.rows[0], options);
          const revokedRevision = nextRevision(previousRevision);

          await authorizedQuery(
            client,
            options.mutationAuthority,
            `UPDATE "${HOST_OWNERSHIP_SCHEMA}"."${HOST_OWNERSHIP_FENCE_TABLE}"
SET ownership_revision = ownership_revision + 1,
    host_ownership_token = NULL,
    boot_id = NULL
WHERE singleton = true`,
          );

          options.mutationAuthority.assertCurrent();
          commitIssued = true;
          try {
            await client.query("COMMIT");
          } catch {
            throw commitUncertain();
          }
          commitAcknowledged = true;
          transactionOpen = false;

          try {
            options.mutationAuthority.assertCurrent();
          } catch {
            throw committedUnverified();
          }

          let verified: { readonly rows: readonly HostOwnershipFenceRow[] };
          try {
            verified = await client.query<HostOwnershipFenceRow>(FENCE_AFTER_COMMIT);
          } catch {
            throw committedUnverified();
          }
          if (verified.rows.length !== 1) throw committedUnverified();
          assertRevokedFence(verified.rows[0], options, revokedRevision);
          return { previousRevision, revokedRevision };
        } catch (error) {
          if (!commitIssued && transactionOpen) {
            await client.query("ROLLBACK").catch(() => undefined);
            transactionOpen = false;
          }
          if (error instanceof ProblemError) throw error;
          if (commitIssued && !commitAcknowledged) throw commitUncertain();
          if (commitAcknowledged) throw committedUnverified();
          throw knownNotCommitted();
        }
      },
    );
  } catch (error) {
    if (error instanceof ProblemError) throw error;
    if (commitIssued && !commitAcknowledged) throw commitUncertain();
    if (commitAcknowledged) throw committedUnverified();
    throw knownNotCommitted();
  }
}
