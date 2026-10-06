// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public Host ownership contracts and PostgreSQL fence operations; raw clients,
 * statechart objects, and provisioning mechanics remain adapter-internal.
 * @packageDocumentation
 */

export { deriveHostAdvisoryKey, type HostAdvisoryKey } from "./advisory-key.js";
export { encodePostgresScramSha256Verifier } from "./scram-verifier.js";
export {
  acquireBootstrapHostReservation,
  inspectHostAdvisoryLease,
  inspectCanonicalHostDatabase,
  inspectHostOwnershipCanonicalSnapshot,
  provisionHostOwnershipDatabase,
  type BootstrapHostReservation,
  type HostAdvisoryLeaseInspection,
  type HostAdvisoryLeaseInspectionOptions,
  type BootstrapAdminInspectionOptions,
  type CanonicalHostDatabaseInspection,
  type HostOwnershipCanonicalSnapshot,
  type HostOwnershipCanonicalSnapshotOptions,
  type BootstrapHostReservationOptions,
  type BootstrapAdminPasswordProvider,
  type BootstrapAdminProvisioningOptions,
  type BootstrapAdminProvisioningResult,
} from "./bootstrap-admin.js";
export {
  ensureHostOwnershipSchema,
  type OwnershipSchemaOptions,
  type OwnershipSchemaResult,
} from "./ownership-schema.js";
export {
  publishHostOwnershipToken,
  type HostOwnershipPublicationResult,
  type PublishHostOwnershipTokenOptions,
} from "./host-ownership.js";
export {
  revokeHostOwnershipTokenForBootstrap,
  type HostOwnershipRevocationResult,
  type RevokeHostOwnershipTokenOptions,
} from "./ownership-revocation.js";
export { acquireHostLeaseConnection } from "./host-lease-connection.js";
export type { BootstrapMutationAuthority } from "./bootstrap-authority.js";
export {
  HOST_LEASE_ROLE,
  HOST_LEASE_SCRAM_ITERATIONS,
  HOST_LEASE_SCRAM_SALT_BYTES,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  HOST_OWNERSHIP_FENCE_TABLE,
  HOST_OWNERSHIP_FENCE_LOCK_FUNCTION,
  HOST_OWNERSHIP_OWNER_ROLE,
  HOST_OWNERSHIP_SCHEMA,
  HOST_RUNTIME_ROLE,
  HOST_MIGRATION_ROLE,
  HOST_DURABLE_EXECUTION_ROLE,
  type HostOwnershipConnectionTarget,
  type HostOwnershipContext,
  type HostCanonicalMigrationAuthority,
  type HostMigrationDatabaseTarget,
  type HostPersistenceAuthority,
  type HostRuntimeDatabaseTarget,
  type HostDurableExecutionDatabaseTarget,
  type HostDurableExecutionAuthority,
  type HostOwnershipState,
  type HostOwnershipTimingOptions,
  type PostgresScramVerifierOptions,
} from "./contracts.js";
