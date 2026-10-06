// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createBootId,
  createContinuityEpochId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  createMicroSystemId,
  createWorkItemId,
  parseDurableCodeVersion,
  type DurableCodeVersion,
  type Instant,
} from "@heptalogos/foundation-contracts";
import {
  HOST_DURABLE_EXECUTION_ROLE,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  type HostDurableExecutionAuthority,
} from "@heptalogos/host-ownership";
import {
  createDispatchAttemptId,
  createWorkQueueProfileCatalog,
  type DurableDispatchRequest,
  type WorkQueueProfileDefinition,
  type WorkQueueProfileId,
} from "@heptalogos/work-queue";
import { describe, expect, it } from "vitest";
import type { DurableExecutionRuntime } from "../../src/contracts.js";
import {
  createDurableDispatchPortForTests,
  type DurableDispatchPortOptions,
} from "../../src/dispatch/port.js";
import type {
  DbosDispatchStartRequest,
  DbosStaticDispatcher,
} from "../../src/dispatch/dispatcher.js";

const parsedDurableCodeVersion = parseDurableCodeVersion("a".repeat(64));
if (parsedDurableCodeVersion === undefined) {
  throw new Error("Test durable code version is invalid");
}
const durableCodeVersion: DurableCodeVersion = parsedDurableCodeVersion;
const profileId = createMicroSystemId(
  "dispatch-default",
) as unknown as WorkQueueProfileId;
const workItemId = createWorkItemId();
const now = "2026-08-29T00:00:00.000Z" as Instant;

function authority(): HostDurableExecutionAuthority {
  const controller = new AbortController();
  return {
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    bootId: createBootId(),
    continuityEpochId: createContinuityEpochId(),
    token: createHostOwnershipToken(),
    target: {
      host: "127.0.0.1",
      port: 55432,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: HOST_DURABLE_EXECUTION_ROLE,
    },
    signal: controller.signal,
    assertActive() {},
    async withDurableExecutionDatabasePassword(use) {
      return use(new TextEncoder().encode("D".repeat(32)));
    },
  };
}

function profile(
  overrides: Partial<WorkQueueProfileDefinition> = {},
): WorkQueueProfileDefinition {
  return { profileId, minPollingIntervalMs: 100, ...overrides };
}

function request(
  dispatchRevision: number,
  overrides: Partial<DurableDispatchRequest> = {},
): DurableDispatchRequest {
  return {
    workItemId,
    dispatchRevision,
    dispatchAttemptId: createDispatchAttemptId(workItemId, dispatchRevision),
    queueProfileId: profileId,
    priority: 11,
    ...overrides,
  };
}

function dispatcherFixture(): {
  readonly dispatcher: DbosStaticDispatcher;
  readonly starts: DbosDispatchStartRequest[];
} {
  const starts: DbosDispatchStartRequest[] = [];
  const dispatcher: DbosStaticDispatcher = {
    async dispatch(start) {
      starts.push(start);
    },
  };
  return { dispatcher, starts };
}

function portOptions(
  lifecycle: { state: DurableExecutionRuntime["state"] },
  catalog = createWorkQueueProfileCatalog([profile()]),
  clock: () => Instant = () => now,
): DurableDispatchPortOptions {
  return {
    authority: authority(),
    lifecycle,
    durableCodeVersion,
    profiles: catalog,
    now: clock,
  };
}

describe("DurableDispatchPort", () => {
  it("uses deterministic workflow IDs, direct priority, and explicit application version", async () => {
    const lifecycle = { state: "OPEN" as const };
    const fixture = dispatcherFixture();
    const port = createDurableDispatchPortForTests(
      portOptions(lifecycle),
      fixture.dispatcher,
    );
    const first = request(1);
    const second = request(2);

    await port.dispatch(first);
    await port.dispatch(second);

    expect(fixture.starts).toHaveLength(2);
    expect(fixture.starts[0]?.options).toMatchObject({
      workflowID: `heptalogos.work.${first.dispatchAttemptId}`,
      queueName: "heptalogos.queue.dispatch-default",
      enqueueOptions: {
        priority: 11,
        delaySeconds: 0,
        applicationVersion: durableCodeVersion,
      },
    });
    expect(fixture.starts[1]?.options.workflowID).toBe(
      `heptalogos.work.${second.dispatchAttemptId}`,
    );
    expect(fixture.starts[0]?.options.workflowID).not.toBe(
      fixture.starts[1]?.options.workflowID,
    );
    expect(fixture.starts[0]?.options.enqueueOptions).not.toHaveProperty(
      "deduplicationID",
    );
  });

  it("ceil-delays future work and uses zero for work already due", async () => {
    const lifecycle = { state: "OPEN" as const };
    const fixture = dispatcherFixture();
    const port = createDurableDispatchPortForTests(
      portOptions(lifecycle),
      fixture.dispatcher,
    );

    await port.dispatch(
      request(1, { notBefore: "2026-08-29T00:00:01.001Z" as Instant }),
    );
    await port.dispatch(
      request(2, { notBefore: "2026-08-28T23:59:59.999Z" as Instant }),
    );

    expect(fixture.starts[0]?.options.enqueueOptions.delaySeconds).toBe(2);
    expect(fixture.starts[1]?.options.enqueueOptions.delaySeconds).toBe(0);
  });

  it("requires a partition key exactly when the profile is partitioned", async () => {
    const lifecycle = { state: "OPEN" as const };
    const partitionedProfileId = createMicroSystemId(
      "dispatch-partitioned",
    ) as unknown as WorkQueueProfileId;
    const partitionedCatalog = createWorkQueueProfileCatalog([
      {
        profileId: partitionedProfileId,
        minPollingIntervalMs: 100,
        partition: { concurrency: 2 },
      },
    ]);
    const partitionedFixture = dispatcherFixture();
    const partitionedPort = createDurableDispatchPortForTests(
      portOptions(lifecycle, partitionedCatalog),
      partitionedFixture.dispatcher,
    );
    const partitionedRequest = request(1, {
      queueProfileId: partitionedProfileId,
      partitionKey: "tenant-a",
    });
    await partitionedPort.dispatch(partitionedRequest);
    expect(partitionedFixture.starts[0]?.options.enqueueOptions.queuePartitionKey).toBe(
      "tenant-a",
    );

    await expect(
      partitionedPort.dispatch(request(2, { queueProfileId: partitionedProfileId })),
    ).rejects.toMatchObject({
      problem: { problemCode: "durable.execution.dispatch.partition_required" },
    });

    const unpartitionedFixture = dispatcherFixture();
    const unpartitionedPort = createDurableDispatchPortForTests(
      portOptions(lifecycle),
      unpartitionedFixture.dispatcher,
    );
    await expect(
      unpartitionedPort.dispatch(request(1, { partitionKey: "tenant-a" })),
    ).rejects.toMatchObject({
      problem: {
        problemCode: "durable.execution.dispatch.partition_not_supported",
      },
    });
  });

  it("rejects dispatch unless the lifecycle is OPEN", async () => {
    const lifecycle = { state: "CREATED" as const };
    const fixture = dispatcherFixture();
    const port = createDurableDispatchPortForTests(
      portOptions(lifecycle),
      fixture.dispatcher,
    );

    await expect(port.dispatch(request(1))).rejects.toMatchObject({
      problem: { problemCode: "durable.execution.dispatch.not_open" },
    });
    expect(fixture.starts).toHaveLength(0);
  });

  it("rejects a request whose attempt identity is not revision-derived", async () => {
    const lifecycle = { state: "OPEN" as const };
    const fixture = dispatcherFixture();
    const port = createDurableDispatchPortForTests(
      portOptions(lifecycle),
      fixture.dispatcher,
    );

    await expect(
      port.dispatch({
        ...request(1),
        dispatchAttemptId: createDispatchAttemptId(workItemId, 2),
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "durable.execution.dispatch.invalid_request" },
    });
  });
});
