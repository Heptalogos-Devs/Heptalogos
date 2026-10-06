// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Small PostgreSQL scalar projections shared by HostOwnership adapters.
 * @module postgres-values
 */

/** Normalizes the PostgreSQL boolean representations returned by query clients. */
export function asPostgresBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "t" || value === "true") return true;
  if (value === "f" || value === "false") return false;
  return undefined;
}
