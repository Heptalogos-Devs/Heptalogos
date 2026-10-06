// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Centralizes Bootstrap error-code extraction used to classify failures without
 * coupling callers to implementation-specific exception objects.
 * @module error-code
 */

/** Extracts a Node-style error code when the unknown value carries one. */
export function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

/** Checks a Node-style error code without trusting an arbitrary unknown value. */
export function hasNodeErrorCode(error: unknown, code: string): boolean {
  return nodeErrorCode(error) === code;
}
