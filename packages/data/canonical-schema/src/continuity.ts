// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Projects canonical-schema continuity values into validated migration inputs
 * so schema initialization preserves the current lineage boundary.
 * @module continuity
 */

import {
  parseContinuityEpochId,
  parseInstanceId,
  type ContinuityEpochId,
  type InstanceId,
} from "@heptalogos/foundation-contracts";
import type { HostCanonicalMigrationAuthority } from "@heptalogos/host-ownership";
import type { Kysely, Transaction } from "kysely";
import type { CanonicalDatabase } from "./migration-pool.js";
import { assertCanonicalAuthority } from "./migration-pool.js";
import { canonicalSchemaProblem } from "./problems.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Verifies the locked continuity singleton against the expected identities. */
export function verifyObservedContinuityRow(
  row: unknown,
  expectedInstanceId: InstanceId,
  expectedContinuityEpochId: ContinuityEpochId,
): void {
  if (
    !isRecord(row) ||
    row.singleton !== true ||
    parseInstanceId(row.instance_id) === undefined ||
    parseContinuityEpochId(row.continuity_epoch_id) === undefined
  ) {
    throw canonicalSchemaProblem(
      "canonical-schema.schema_precondition_failed",
      "The canonical continuity table did not return one valid singleton identity row",
      "integrity",
    );
  }
  if (row.instance_id !== expectedInstanceId) {
    throw canonicalSchemaProblem(
      "canonical-schema.continuity_instance_mismatch",
      "Normal canonical initialization never rewrites continuity to another Instance",
      "conflict",
    );
  }
  if (row.continuity_epoch_id !== expectedContinuityEpochId) {
    throw canonicalSchemaProblem(
      "canonical-schema.continuity_epoch_mismatch",
      "Normal canonical initialization never overwrites an existing continuity epoch",
      "conflict",
    );
  }
}

async function materializeContinuityInTransaction(
  transaction: Transaction<CanonicalDatabase>,
  expectedInstanceId: InstanceId,
  expectedContinuityEpochId: ContinuityEpochId,
): Promise<void> {
  const canonical = transaction.withSchema("heptalogos");
  await canonical
    .insertInto("instance_continuity")
    .values({
      singleton: true,
      instance_id: expectedInstanceId,
      continuity_epoch_id: expectedContinuityEpochId,
    })
    .onConflict((conflict) => conflict.column("singleton").doNothing())
    .execute();

  const rows = await canonical
    .selectFrom("instance_continuity")
    .select(["singleton", "instance_id", "continuity_epoch_id"])
    .where("singleton", "=", true)
    .forUpdate()
    .execute();
  if (rows.length !== 1) {
    throw canonicalSchemaProblem(
      "canonical-schema.schema_precondition_failed",
      "Canonical continuity materialization requires exactly one locked singleton row",
      "integrity",
    );
  }
  verifyObservedContinuityRow(rows[0], expectedInstanceId, expectedContinuityEpochId);
}

/** Materializes and rechecks canonical continuity inside one transaction. */
export async function materializeContinuity(
  db: Kysely<CanonicalDatabase>,
  authority: HostCanonicalMigrationAuthority,
  expectedInstanceId: InstanceId,
  expectedContinuityEpochId: ContinuityEpochId,
): Promise<void> {
  assertCanonicalAuthority(authority);
  await db.transaction().execute(async (transaction) => {
    await materializeContinuityInTransaction(
      transaction,
      expectedInstanceId,
      expectedContinuityEpochId,
    );
  });
  assertCanonicalAuthority(authority);
}
