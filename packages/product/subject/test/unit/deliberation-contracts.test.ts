// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  adoptDeliberationSchema,
  type AdoptDeliberation,
} from "../../src/deliberation-contracts.js";
/** This caller fixture must compile: dynamic Type.Union arrays previously collapsed its action to never. */
const actualCallerRequest: AdoptDeliberation = {
  operationId: "0199e800-0000-7000-8000-000000000001",
  subjectId: "0199e800-0000-7000-8000-000000000002",
  activityId: "0199e800-0000-7000-8000-000000000003",
  sourceRunId: "native:subject-deliberation:reentry",
  expectedActivityRevision: 3,
  decision: { action: "rest", reason: "Continue the evening rest" },
};
describe("typed actual deliberation caller", () => {
  it("accepts a real action and opaque native producer identity", () => {
    expect(
      compileSchema<AdoptDeliberation>(adoptDeliberationSchema).validate(
        actualCallerRequest,
      ).ok,
    ).toBe(true);
  });
});
