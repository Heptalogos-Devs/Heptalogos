// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns canonical PostgreSQL baseline initialization while requiring the caller
 * to supply the Host-owned connection and migration authority context.
 * @module initializer
 */

import type {
  CanonicalSchemaInitializer,
  CanonicalSchemaRuntimeOptions,
} from "./contracts.js";
import { Migrator } from "kysely/migration";
import { ProblemError } from "@heptalogos/foundation-contracts";
import {
  assertCanonicalAuthority,
  createMigrationDatabase,
  verifyMigrationSchemaPrecondition,
  type MigrationDatabase,
} from "./migration-pool.js";
import { materializeContinuity } from "./continuity.js";
import { canonicalMigrationProvider } from "./migration-provider.js";
import { canonicalSchemaProblem } from "./problems.js";

function normalizedFailure(
  error: unknown,
  authority: Parameters<typeof assertCanonicalAuthority>[0],
): ProblemError {
  if (
    error instanceof ProblemError &&
    error.problem.problemCode.startsWith("canonical-schema.")
  ) {
    return error;
  }
  try {
    authority.assertCurrent();
  } catch {
    return canonicalSchemaProblem(
      "canonical-schema.authority_lost",
      "Canonical initialization stopped because the bootstrap and Host authority window was lost",
      "conflict",
    );
  }
  return canonicalSchemaProblem(
    "canonical-schema.migration_failed",
    "The current canonical schema baseline did not complete",
    "unavailable",
  );
}

function migrationResultFailed(result: {
  readonly error?: unknown;
  readonly results?: readonly { readonly status: string }[];
}): boolean {
  return (
    result.error !== undefined ||
    result.results?.some((item) => item.status !== "Success") === true
  );
}

/** Creates an initializer for the current canonical PostgreSQL schema baseline. */
export function createCanonicalSchemaInitializer(
  options: CanonicalSchemaRuntimeOptions,
): CanonicalSchemaInitializer {
  return async ({ authority, expectedContinuityEpochId }) => {
    let database: MigrationDatabase | undefined;
    let failure: ProblemError | undefined;
    try {
      assertCanonicalAuthority(authority);
      if (authority.continuityEpochId !== expectedContinuityEpochId) {
        throw canonicalSchemaProblem(
          "canonical-schema.continuity_epoch_mismatch",
          "Canonical initialization requires one exact ContinuityEpochId across BootstrapState and Host authority",
          "integrity",
        );
      }
      database = createMigrationDatabase(authority, options);
      await verifyMigrationSchemaPrecondition(database.db);
      assertCanonicalAuthority(authority);
      const result = await new Migrator({
        db: database.db,
        provider: canonicalMigrationProvider,
        migrationTableName: "foundation_schema_migration",
        migrationLockTableName: "foundation_schema_migration_lock",
        migrationTableSchema: "heptalogos",
        allowUnorderedMigrations: false,
      }).migrateToLatest();
      if (migrationResultFailed(result)) {
        throw canonicalSchemaProblem(
          "canonical-schema.migration_failed",
          "The static current canonical migration set was not applied successfully",
          "unavailable",
        );
      }
      assertCanonicalAuthority(authority);
      await materializeContinuity(
        database.db,
        authority,
        authority.instanceId,
        expectedContinuityEpochId,
      );
      assertCanonicalAuthority(authority);
    } catch (error) {
      failure = normalizedFailure(error, authority);
    }

    if (database !== undefined) {
      try {
        await database.close();
      } catch {
        const closeFailure = canonicalSchemaProblem(
          "canonical-schema.close_failed",
          "The Kysely migration database did not prove closed after initialization",
          "unavailable",
        );
        if (failure === undefined) {
          failure = closeFailure;
        } else {
          try {
            options.onBackgroundError(closeFailure);
          } catch {
            // A diagnostic sink cannot replace the authoritative initialization failure.
          }
        }
      }
    }
    if (failure !== undefined) throw failure;
  };
}
