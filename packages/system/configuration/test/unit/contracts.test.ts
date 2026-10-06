// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  configurationActivateInputSchema,
  configurationRevisionCreateInputSchema,
} from "../../src/index.js";

describe("Configuration current contracts", () => {
  it("accepts owner-defined values while keeping the revision envelope strict", () => {
    expect(
      compileSchema(configurationRevisionCreateInputSchema).validate({
        definitionId: "subject.expression.v1",
        scopeRef: {
          schemaVersion: 1,
          resourceKind: "subject",
          resourceId: "subject-1",
        },
        value: {
          schemaVersion: 1,
          maxOutputTokens: 256,
        },
      }).ok,
    ).toBe(true);
    expect(
      compileSchema(configurationActivateInputSchema).validate({
        revisionId: "01j00000000000000000000000",
        unexpected: true,
      }).ok,
    ).toBe(false);
  });
});
