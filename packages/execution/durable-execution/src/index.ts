// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public durable-execution package contracts; DBOS SDK, process, and vendor
 * implementation details remain behind the adapter boundary.
 * @packageDocumentation
 */

export {
  DBOS_PACKAGE_NAME,
  DBOS_PACKAGE_VERSION,
  type DurableExecutionPackageResolution,
  type DurableExecutionLifecycleState,
  type DurableExecutionPoolOptions,
  type DurableExecutionRuntime,
  type DurableExecutionRuntimeOptions,
  type DurableExecutionSchemaProvisioner,
  type DurableExecutionSchemaProvisionerOptions,
} from "./contracts.js";
export { resolveDbosPackage } from "./provider/package.js";
export { createDurableExecutionSchemaProvisioner } from "./provider/schema-provisioner.js";
export { createDurableExecutionRuntime } from "./runtime/runtime.js";
export {
  createDurableDispatchPort,
  type DurableDispatchPortOptions,
} from "./dispatch/port.js";
