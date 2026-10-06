// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public private-PostgreSQL toolchain, cluster, lifecycle, and maintenance
 * contracts; process and profile mechanics remain behind controller adapters.
 * @packageDocumentation
 */

export {
  PRIVATE_POSTGRES_ARCHITECTURE_MAJOR,
  PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME,
  PRIVATE_POSTGRES_DATA_LAYOUT_VERSION,
  PRIVATE_POSTGRES_QUALIFIED_VERSION,
  PRIVATE_POSTGRES_RELATIVE_DATA_PATH,
  type PrivatePostgresClusterIdentity,
  type PrivatePostgresControlGuard,
  type PrivatePostgresExpectedIdentity,
  type PrivatePostgresInitializationProfileRevision,
  type PrivatePostgresInitializationProfile,
  type PrivatePostgresInitializationResult,
  type PrivatePostgresLifecycleOptions,
  type PrivatePostgresPlacement,
  type PrivatePostgresStartupDisposition,
  type PrivatePostgresToolchain,
  type ReadyPrivatePostgresMechanics,
} from "./contracts.js";
export { resolvePrivatePostgresToolchain } from "./toolchain.js";
export {
  classifyClusterDirectory,
  resolvePrivatePostgresPlacement,
  type ClusterDirectoryState,
} from "./cluster-layout.js";
export {
  inspectPrivatePostgresCluster,
  parsePgControldata,
  readPrivatePostgresMajor,
  type ParsedPgControldata,
  type PrivatePostgresClusterInspection,
} from "./cluster-inspection.js";
export {
  createPrivatePostgresInitializationProfile,
  createPrivatePostgresInitializationProfileRevision,
  initializePrivatePostgresCluster,
  type InitializePrivatePostgresClusterOptions,
  startPrivatePostgresCluster,
  type StartPrivatePostgresClusterOptions,
  type ValidateExistingPrivatePostgresClusterOptions,
  validateExistingCluster,
} from "./controller.js";
export {
  openPrivatePostgresMaintenanceController,
  type OpenPrivatePostgresMaintenanceControllerOptions,
  type PrivatePostgresMaintenanceController,
} from "./maintenance-controller.js";
export {
  createCanonicalHbaProfile,
  createCanonicalRuntimeProfile,
  inspectEffectivePrivatePostgresProfile,
  readCanonicalHbaProfile,
  writeCanonicalPrivatePostgresRuntimeProfile,
  type EffectivePrivatePostgresProfile,
} from "./runtime-profile.js";
