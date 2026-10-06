// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the typed schema validation result and validator contracts exposed to
 * Foundation packages while hiding Ajv implementation details.
 * @module contracts
 */

/** Describes one schema validation issue without exposing Ajv internals. */
export interface SchemaValidationIssue {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
}

/** Reports either a validated value or all validation issues. */
export type SchemaValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly SchemaValidationIssue[] };

/** Provides the package-owned runtime validation operation. */
export interface SchemaValidator<T> {
  /** Validates unknown input without coercion or default mutation. */
  validate(value: unknown): SchemaValidationResult<T>;
}
