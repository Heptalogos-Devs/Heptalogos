// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public Bootstrap runtime contracts for installation/recovery orchestration,
 * Host handoff, and managed maintenance; private Authority adapters remain
 * behind these stable exports.
 * @packageDocumentation
 */

// Evaluate the ownership adapter before the public entry point's other runtime
// dependencies so its adopted provider registers exit cleanup first.
import "./bootstrap/ownership.js";

/** Identifies the public Bootstrap runtime package for discovery and diagnostics. */
export const BOOTSTRAP_RUNTIME_PACKAGE = "@heptalogos/bootstrap-runtime" as const;
export { loadBootstrapLocator, type BootstrapLocatorV1 } from "./bootstrap/locator.js";
export {
  resolveBootstrapPathProfile,
  type BootstrapPathProfile,
  type ResolvedLifecycleRoot,
} from "./bootstrap/roots.js";
export {
  resolveRuntimeLocations,
  type RuntimeLocations,
} from "./bootstrap/runtime-locations.js";
export type {
  BootstrapOwnershipLease,
  BootstrapOwnershipOptions,
  BootstrapOwnershipState,
} from "./bootstrap/ownership.js";
export {
  proveLocalInstallationOwner,
  type LocalInstallationOwnerRecoveryPrincipal,
} from "./bootstrap/local-installation-owner.js";
export {
  inspectBootstrapRecovery,
  type BootstrapRecoveryDisposition,
  type BootstrapRecoveryInspection,
} from "./recovery/bootstrap.js";
export {
  executeBootstrapRecoveryCommand,
  parseBootstrapRecoveryCommand,
  type BootstrapRecoveryCommand,
  type BootstrapRecoveryCommandContext,
  type BootstrapRecoveryCommandResult,
} from "./recovery/command.js";
export type { OwnedBootstrapStateStore } from "./bootstrap/state-access.js";
export {
  prepareBootstrapPrelude,
  type BootstrapStateGenesisSelection,
  type OwnedBootstrapPrelude,
  type PreparedBootstrapPrelude,
} from "./bootstrap/prelude.js";
export type {
  PreparePrivatePostgresOptions,
  ReadyPrivatePostgres,
} from "./postgres/bootstrap.js";
export type { HostOwnershipHandoffOptions } from "./host/handoff.js";
export type {
  BootstrapKeyProvider,
  BootstrapKeyRequestContext,
} from "./bootstrap/key-provider.js";
export type {
  BootstrapManagedHostContext,
  HostRuntimeRetirement,
  PreparedPrivatePostgresMaintenance,
  PreparedMaintenanceState,
  PrivatePostgresMaintenanceRequest,
  PrivatePostgresMaintenanceResult,
} from "./host/managed-host.js";
