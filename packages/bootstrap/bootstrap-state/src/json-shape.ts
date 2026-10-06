// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Narrows unknown decoded values to the JSON object shapes required by durable
 * Bootstrap codecs before domain-level validation is attempted.
 * @module json-shape
 */

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a nested schemaVersion only from a JSON object-shaped value. */
export function readSchemaVersion(value: unknown, property: string): unknown {
  if (!isJsonRecord(value) || !isJsonRecord(value[property])) return undefined;
  return value[property].schemaVersion;
}
