// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { Type } from "../../src/typebox.js";
import { compileSchema } from "../../src/index.js";

describe("SchemaRuntime", () => {
  it("does not mutate, coerce, default, or remove fields", () => {
    const schema = Type.Object(
      { count: Type.Number() },
      { additionalProperties: false },
    );
    const validator = compileSchema<{ count: number }>(schema);
    const input = { count: "1", extra: true };
    const before = structuredClone(input);

    const result = validator.validate(input);

    expect(result.ok).toBe(false);
    expect(input).toEqual(before);
  });

  it("returns the same object identity after successful validation", () => {
    const schema = Type.Object({ count: Type.Number() });
    const validator = compileSchema<{ count: number }>(schema);
    const input = { count: 1 };

    const result = validator.validate(input);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(input);
  });
});
