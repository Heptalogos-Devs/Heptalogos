// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public runtime schema compilation and validation contracts; Ajv and TypeBox
 * remain behind this deliberately small, framework-neutral package boundary.
 * @packageDocumentation
 */

export {
  type SchemaValidationIssue,
  type SchemaValidationResult,
  type SchemaValidator,
} from "./contracts.js";
export { compileSchema } from "./validator.js";
