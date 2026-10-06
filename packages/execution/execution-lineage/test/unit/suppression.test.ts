// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  isLineageSuppressed,
  runWithLineageSuppressed,
} from "../../src/suppression.js";

describe("lineage suppression", () => {
  it("is scoped to the internal suppression operation", () => {
    expect(isLineageSuppressed()).toBe(false);
    runWithLineageSuppressed(() => {
      expect(isLineageSuppressed()).toBe(true);
    });
    expect(isLineageSuppressed()).toBe(false);
  });
});
