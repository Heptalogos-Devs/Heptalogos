// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compiles and executes strict runtime schemas through the adopted Ajv route,
 * translating validator failures into the package's typed result contract.
 * @module validator
 */

import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import type { SchemaValidator } from "./contracts.js";

const ajvOptions = {
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  strict: true,
} as const;

/** Compiles a strict schema into the typed SchemaRuntime validator contract. */
export function compileSchema<T>(schema: object): SchemaValidator<T> {
  const validate = new Ajv2020(ajvOptions).compile<T>(schema as AnySchema);

  return {
    validate(value: unknown) {
      if (validate(value)) {
        return { ok: true, value: value as T };
      }

      return {
        ok: false,
        issues: (validate.errors ?? []).map((error) => ({
          instancePath: error.instancePath,
          keyword: error.keyword,
          message: error.message ?? "schema validation failed",
        })),
      };
    },
  };
}
