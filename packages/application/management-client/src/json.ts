// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Internal local JSON reads shared by discovery and claim readers.
 * @module json
 */
import { readFile } from "node:fs/promises";
/** Narrows parsed local JSON to an object before validating its owning schema. */
export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
/** Reads an optional local projection; absence and malformed JSON remain unavailable. */
export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}
