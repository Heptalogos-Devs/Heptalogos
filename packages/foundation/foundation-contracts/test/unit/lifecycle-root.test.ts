// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { LIFECYCLE_ROOT_IDS } from "../../src/lifecycle-root.js";

describe("lifecycle root names", () => {
  it("contains exactly the supported lifecycle root family", () => {
    expect(LIFECYCLE_ROOT_IDS).toEqual([
      "PROGRAM",
      "INSTANCE",
      "CONFIGURATION",
      "DATA",
      "SECRET",
      "BLOB",
      "BACKUP",
      "LOG",
      "CACHE",
      "TEMP",
      "RUN",
      "PACKAGE_STAGING",
    ]);
    expect(new Set(LIFECYCLE_ROOT_IDS).size).toBe(LIFECYCLE_ROOT_IDS.length);
    expect(LIFECYCLE_ROOT_IDS).not.toContain("WORKSPACE");
    expect(LIFECYCLE_ROOT_IDS).not.toContain("PACKAGE");
  });
});
