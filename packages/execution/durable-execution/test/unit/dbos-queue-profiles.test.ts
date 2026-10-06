// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createMicroSystemId } from "@heptalogos/foundation-contracts";
import {
  createWorkQueueProfileCatalog,
  type WorkQueueProfileDefinition,
  type WorkQueueProfileId,
} from "@heptalogos/work-queue";
import { describe, expect, it } from "vitest";
import {
  projectDbosQueueOptions,
  projectWorkQueueProfiles,
  type DbosQueueHandle,
  type DbosQueueRegistrationDriver,
  type DbosQueueRegistrationOptions,
} from "../../src/dispatch/queue-profiles.js";

const profileId = createMicroSystemId("default-work") as unknown as WorkQueueProfileId;

function profile(
  overrides: Partial<WorkQueueProfileDefinition> = {},
): WorkQueueProfileDefinition {
  return {
    profileId,
    minPollingIntervalMs: 250,
    ...overrides,
  };
}

function queueHandle(options: DbosQueueRegistrationOptions): DbosQueueHandle {
  return {
    async getGlobalConcurrency() {
      return options.globalConcurrency;
    },
    async getWorkerConcurrency() {
      return options.workerConcurrency;
    },
    async getRateLimit() {
      return options.rateLimit;
    },
    async getPartitionConcurrency() {
      return options.partitionConcurrency;
    },
    async getPartitionWorkerConcurrency() {
      return options.partitionWorkerConcurrency;
    },
    async getPartitionRateLimit() {
      return options.partitionRateLimit;
    },
    async getPartitionQueue() {
      return (
        options.partitionConcurrency !== undefined ||
        options.partitionWorkerConcurrency !== undefined ||
        options.partitionRateLimit !== undefined
      );
    },
    async getMinPollingIntervalMs() {
      return options.minPollingIntervalMs;
    },
  };
}

function driverFixture(initial?: ReadonlyMap<string, DbosQueueRegistrationOptions>): {
  readonly driver: DbosQueueRegistrationDriver;
  readonly calls: Array<{
    readonly name: string;
    readonly options: DbosQueueRegistrationOptions;
  }>;
  readonly persisted: Map<string, DbosQueueRegistrationOptions>;
} {
  const persisted = new Map(initial);
  const calls: Array<{
    readonly name: string;
    readonly options: DbosQueueRegistrationOptions;
  }> = [];
  const driver: DbosQueueRegistrationDriver = {
    async registerQueue(name, options) {
      calls.push({ name, options });
      if (!persisted.has(name)) persisted.set(name, options);
      return queueHandle(persisted.get(name) as DbosQueueRegistrationOptions);
    },
  };
  return { driver, calls, persisted };
}

describe("DBOS WorkQueue profile projection", () => {
  it("projects queue-wide, partition, polling, and rate-limit fields exactly", async () => {
    const expected = profile({
      globalConcurrency: 8,
      workerConcurrency: 3,
      rateLimit: { limitPerPeriod: 12, periodSeconds: 7 },
      partition: {
        concurrency: 4,
        workerConcurrency: 2,
        rateLimit: { limitPerPeriod: 5, periodSeconds: 11 },
      },
    });
    const fixture = driverFixture();

    await projectWorkQueueProfiles(
      createWorkQueueProfileCatalog([expected]),
      fixture.driver,
    );

    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]).toEqual({
      name: "heptalogos.queue.default-work",
      options: {
        globalConcurrency: 8,
        workerConcurrency: 3,
        rateLimit: { limitPerPeriod: 12, periodSec: 7 },
        partitionConcurrency: 4,
        partitionWorkerConcurrency: 2,
        partitionRateLimit: { limitPerPeriod: 5, periodSec: 11 },
        minPollingIntervalMs: 250,
        onConflict: "never_update",
      },
    });
    expect(fixture.calls[0]?.options).not.toHaveProperty("concurrency");
    expect(fixture.calls[0]?.options).not.toHaveProperty("partitionQueue");
  });

  it("creates an absent queue and accepts an existing matching queue", async () => {
    const expected = profile({ globalConcurrency: 4 });
    const catalog = createWorkQueueProfileCatalog([expected]);
    const absent = driverFixture();
    await projectWorkQueueProfiles(catalog, absent.driver);

    const name = "heptalogos.queue.default-work";
    expect(absent.persisted.get(name)).toEqual(projectDbosQueueOptions(expected));

    const existing = driverFixture(absent.persisted);
    await projectWorkQueueProfiles(catalog, existing.driver);
    expect(existing.calls[0]?.options.onConflict).toBe("never_update");
    expect(existing.persisted.get(name)).toEqual(projectDbosQueueOptions(expected));
  });

  it("fails closed on a persisted mismatch without overwriting it", async () => {
    const expected = profile({ globalConcurrency: 4 });
    const name = "heptalogos.queue.default-work";
    const persisted = projectDbosQueueOptions(profile({ globalConcurrency: 9 }));
    const fixture = driverFixture(new Map([[name, persisted]]));

    await expect(
      projectWorkQueueProfiles(
        createWorkQueueProfileCatalog([expected]),
        fixture.driver,
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "durable_execution.queue_profile_mismatch" },
    });
    expect(fixture.persisted.get(name)).toBe(persisted);
    expect(fixture.calls[0]?.options.onConflict).toBe("never_update");
  });

  it("keeps the partition rule aligned with WorkQueue profile semantics", async () => {
    const partitioned = profile({
      partition: { rateLimit: { limitPerPeriod: 2, periodSeconds: 3 } },
    });
    const unpartitioned = profile({ partition: {} });
    const partitionedFixture = driverFixture();
    const unpartitionedFixture = driverFixture();

    await projectWorkQueueProfiles(
      createWorkQueueProfileCatalog([partitioned]),
      partitionedFixture.driver,
    );
    await projectWorkQueueProfiles(
      createWorkQueueProfileCatalog([unpartitioned]),
      unpartitionedFixture.driver,
    );

    expect(partitionedFixture.calls[0]?.options.partitionRateLimit).toEqual({
      limitPerPeriod: 2,
      periodSec: 3,
    });
    expect(unpartitionedFixture.calls[0]?.options).not.toHaveProperty(
      "partitionConcurrency",
    );
    expect(unpartitionedFixture.calls[0]?.options).not.toHaveProperty(
      "partitionWorkerConcurrency",
    );
    expect(unpartitionedFixture.calls[0]?.options).not.toHaveProperty(
      "partitionRateLimit",
    );
  });

  it("turns registration or readback failures into a profile mismatch", async () => {
    const driver: DbosQueueRegistrationDriver = {
      async registerQueue() {
        throw new Error("database unavailable");
      },
    };

    await expect(
      projectWorkQueueProfiles(createWorkQueueProfileCatalog([profile()]), driver),
    ).rejects.toMatchObject({
      problem: { problemCode: "durable_execution.queue_profile_mismatch" },
    });
  });
});
