// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extracts process error codes for private PostgreSQL disposition mapping while
 * keeping subprocess-library error shapes out of public lifecycle contracts.
 * @module error-code
 */

/** Checks a Node-style error code without trusting an unknown error value. */
export function hasNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
