// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { createMicroSystemId } from "@heptalogos/foundation-contracts";
import {
  createWorkQueueProfileCatalog,
  type WorkQueueProfileDefinition,
  type WorkQueueProfileId,
} from "../../src/index.js";

const profileId = createMicroSystemId("default-work") as unknown as WorkQueueProfileId;

function profile(
  overrides: Partial<WorkQueueProfileDefinition> = {},
): WorkQueueProfileDefinition {
  return {
    profileId,
    minPollingIntervalMs: 100,
    ...overrides,
  };
}

describe("WorkQueue profile catalog", () => {
  it("rejects duplicate profile identities", () => {
    expect(() => createWorkQueueProfileCatalog([profile(), profile()])).toThrow();
  });

  it("rejects invalid concurrency relations", () => {
    expect(() =>
      createWorkQueueProfileCatalog([
        profile({ globalConcurrency: 1, workerConcurrency: 2 }),
      ]),
    ).toThrow();
    expect(() =>
      createWorkQueueProfileCatalog([
        profile({
          globalConcurrency: 4,
          workerConcurrency: 3,
          partition: { concurrency: 2, workerConcurrency: 3 },
        }),
      ]),
    ).toThrow();
  });

  it("rejects invalid rate limits and non-positive controls", () => {
    expect(() =>
      createWorkQueueProfileCatalog([
        profile({ rateLimit: { limitPerPeriod: 0, periodSeconds: 1 } }),
      ]),
    ).toThrow();
    expect(() =>
      createWorkQueueProfileCatalog([profile({ minPollingIntervalMs: 0 })]),
    ).toThrow();
  });

  it("retains an immutable validated catalog", () => {
    const definition = profile({
      globalConcurrency: 4,
      workerConcurrency: 2,
      partition: {
        concurrency: 2,
        workerConcurrency: 1,
        rateLimit: { limitPerPeriod: 10, periodSeconds: 1 },
      },
    });
    const catalog = createWorkQueueProfileCatalog([definition]);

    expect(catalog.get(profileId)).toMatchObject(definition);
    expect(catalog.list()).toHaveLength(1);
    expect(Object.isFrozen(catalog.list())).toBe(true);
    expect(Object.isFrozen(catalog.list()[0])).toBe(true);
    expect(Object.isFrozen(catalog.list()[0]?.partition)).toBe(true);
  });
});
