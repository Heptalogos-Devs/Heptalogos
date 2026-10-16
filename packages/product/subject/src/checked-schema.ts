// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Subject owner schema decoding with the original owner's failure semantics.
 * @module checked-schema
 */
import { compileSchema } from "@heptalogos/schema-runtime";
/** Shares decoding mechanics; each owner retains its own error code, detail and category. */
export function createSubjectSchemaReader(onInvalid: () => never) {
  return function checked<T>(
    schema: Parameters<typeof compileSchema<T>>[0],
    value: unknown,
  ): T {
    const result = compileSchema<T>(schema).validate(value);
    if (!result.ok) return onInvalid();
    return result.value;
  };
}
