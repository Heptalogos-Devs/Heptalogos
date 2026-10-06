// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public canonical-schema contracts for materializing the current PostgreSQL
 * baseline; migration and connection mechanics remain behind the initializer.
 * @packageDocumentation
 */

export type {
  CanonicalSchemaRuntimeOptions,
  CanonicalSchemaInitializer,
} from "./contracts.js";

export { createCanonicalSchemaInitializer } from "./initializer.js";
