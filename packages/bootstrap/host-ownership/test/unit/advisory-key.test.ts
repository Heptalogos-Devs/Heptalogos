// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { parseInstanceId } from "@heptalogos/foundation-contracts";
import { deriveHostAdvisoryKey } from "../../src/advisory-key.js";

const INSTANCE_A = parseInstanceId(
  "0197cfe0-0000-7000-8000-000000000001",
) as NonNullable<ReturnType<typeof parseInstanceId>>;
const INSTANCE_B = parseInstanceId(
  "0197cfe0-0000-7000-8000-000000000002",
) as NonNullable<ReturnType<typeof parseInstanceId>>;

describe("Host advisory key", () => {
  it("derives a stable signed int32 pair for an InstanceId", () => {
    expect(deriveHostAdvisoryKey(INSTANCE_A)).toEqual({
      key1: 418239335,
      key2: -2100844247,
    });
    expect(deriveHostAdvisoryKey(INSTANCE_A)).toEqual(
      deriveHostAdvisoryKey(INSTANCE_A),
    );
  });

  it("separates the fixture InstanceIds into different advisory keys", () => {
    expect(deriveHostAdvisoryKey(INSTANCE_B)).toEqual({
      key1: 1309712239,
      key2: 1920399939,
    });
    expect(deriveHostAdvisoryKey(INSTANCE_B)).not.toEqual(
      deriveHostAdvisoryKey(INSTANCE_A),
    );
  });
});
