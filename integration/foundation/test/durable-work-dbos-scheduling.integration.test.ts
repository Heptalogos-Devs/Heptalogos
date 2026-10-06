// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it } from "vitest";
import {
  BOOTSTRAP_PASSWORD,
  cleanupCanonicalPostgresFixtures,
  closeComposition,
  createComposition,
  createWork,
  describePostgres,
  durableRequest,
  makeFixture,
  queryAs,
  queueProfileId,
  requireDurable,
  waitUntil,
  type Composition,
} from "../support/durable-work-fixture.js";
import { type RuntimeWorkHandler } from "@heptalogos/runtime-kernel";
import {
  createDispatchAttemptId,
  createWorkQueueProfileCatalog,
  type WorkAdmissionPort,
} from "@heptalogos/work-queue";

let activeComposition: Composition | undefined;

afterEach(async () => {
  const composition = activeComposition;
  activeComposition = undefined;
  if (composition !== undefined) await closeComposition(composition);
  await cleanupCanonicalPostgresFixtures();
}, 180_000);

describePostgres.sequential("DBOS queue and scheduling qualification", () => {
  it("retains a committed WorkItem across DELAY and THROTTLE dispatch admission", async () => {
    const fixture = await makeFixture();
    const decisions = new Map<string, "DELAY" | "THROTTLE">();
    const beforeDispatchWorkItemIds: string[] = [];
    const admission: WorkAdmissionPort = {
      beforeCreate: async () => ({ decision: "ALLOW" }),
      beforeDispatch: async ({ workItem }) => {
        const workItemId = String(workItem.workItemId);
        beforeDispatchWorkItemIds.push(workItemId);
        const decision = decisions.get(workItemId);
        return decision === undefined
          ? { decision: "ALLOW" as const }
          : { decision, reasonCode: `qualification.${decision.toLowerCase()}` };
      },
    };
    activeComposition = await createComposition(fixture, {
      durableExecution: true,
      admission,
    });
    const composition = activeComposition;
    await requireDurable(composition);
    const delayed = await createWork(composition, composition.target, {
      dedupKey: "dbos-delay",
    });
    const throttled = await createWork(composition, composition.target, {
      dedupKey: "dbos-throttle",
    });
    decisions.set(String(delayed.item.workItemId), "DELAY");
    decisions.set(String(throttled.item.workItemId), "THROTTLE");

    await composition.reconciler.start();
    await waitUntil(
      () =>
        new Set(beforeDispatchWorkItemIds).size === 2 &&
        composition.dispatches.length === 0,
    );
    await expect(
      composition.repository.getWorkItem(delayed.item.workItemId),
    ).resolves.toMatchObject({ state: "PENDING", dispatchRevision: 1 });
    await expect(
      composition.repository.getWorkItem(throttled.item.workItemId),
    ).resolves.toMatchObject({ state: "PENDING", dispatchRevision: 1 });

    const workflowIds = [
      `heptalogos.work.${createDispatchAttemptId(delayed.item.workItemId, 1)}`,
      `heptalogos.work.${createDispatchAttemptId(throttled.item.workItemId, 1)}`,
    ];
    await expect(
      queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT count(*)::int AS count
           FROM "dbos"."workflow_status"
          WHERE workflow_uuid IN ($1, $2)`,
        workflowIds,
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });

    decisions.clear();
    await composition.reconciler.scan();
    await waitUntil(
      async () =>
        (await composition.repository.getWorkItem(delayed.item.workItemId))?.state ===
          "SUCCEEDED" &&
        (await composition.repository.getWorkItem(throttled.item.workItemId))?.state ===
          "SUCCEEDED",
    );
    expect(composition.dispatches.length).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it("applies DBOS worker and global concurrency to actual WorkItem execution", async () => {
    const fixture = await makeFixture();
    const profiles = createWorkQueueProfileCatalog([
      {
        profileId: queueProfileId,
        globalConcurrency: 1,
        workerConcurrency: 1,
        minPollingIntervalMs: 25,
      },
    ]);
    let active = 0;
    let maximumActive = 0;
    const started: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const handler: RuntimeWorkHandler = {
      async execute(input) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        started.push(String(input.workItemId));
        if (started.length === 1) firstStarted();
        try {
          if (started.length === 1) await firstGate;
          return { outcome: { accepted: true } };
        } finally {
          active -= 1;
        }
      },
    };
    activeComposition = await createComposition(fixture, {
      durableExecution: true,
      profiles,
      handler,
    });
    const composition = activeComposition;
    await requireDurable(composition);
    const first = await createWork(composition, composition.target, {
      dedupKey: "dbos-global-concurrency-first",
    });
    const second = await createWork(composition, composition.target, {
      dedupKey: "dbos-global-concurrency-second",
    });
    await Promise.all([
      composition.durableDispatch.dispatch(durableRequest(first.item)),
      composition.durableDispatch.dispatch(durableRequest(second.item)),
    ]);

    try {
      await firstStartedPromise;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      expect(started).toHaveLength(1);
      expect(active).toBe(1);
      expect(maximumActive).toBe(1);
    } finally {
      releaseFirst();
    }
    await waitUntil(
      async () =>
        (await composition.repository.getWorkItem(first.item.workItemId))?.state ===
          "SUCCEEDED" &&
        (await composition.repository.getWorkItem(second.item.workItemId))?.state ===
          "SUCCEEDED",
    );
    expect(maximumActive).toBe(1);
    await expect(
      queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT concurrency, worker_concurrency
           FROM "dbos"."queues"
          WHERE name = 'heptalogos.queue.work.default'`,
      ),
    ).resolves.toMatchObject({
      rows: [{ concurrency: 1, worker_concurrency: 1 }],
    });
  }, 180_000);

  it("applies the DBOS queue rate limit to actual workflow starts", async () => {
    const fixture = await makeFixture();
    const profiles = createWorkQueueProfileCatalog([
      {
        profileId: queueProfileId,
        rateLimit: { limitPerPeriod: 1, periodSeconds: 1 },
        minPollingIntervalMs: 25,
      },
    ]);
    const startTimes: number[] = [];
    const handler: RuntimeWorkHandler = {
      async execute() {
        startTimes.push(Date.now());
        return { outcome: { accepted: true } };
      },
    };
    activeComposition = await createComposition(fixture, {
      durableExecution: true,
      profiles,
      handler,
    });
    const composition = activeComposition;
    await requireDurable(composition);
    const first = await createWork(composition, composition.target, {
      dedupKey: "dbos-rate-limit-first",
    });
    const second = await createWork(composition, composition.target, {
      dedupKey: "dbos-rate-limit-second",
    });
    await Promise.all([
      composition.durableDispatch.dispatch(durableRequest(first.item)),
      composition.durableDispatch.dispatch(durableRequest(second.item)),
    ]);
    await waitUntil(
      async () =>
        (await composition.repository.getWorkItem(first.item.workItemId))?.state ===
          "SUCCEEDED" &&
        (await composition.repository.getWorkItem(second.item.workItemId))?.state ===
          "SUCCEEDED",
      15_000,
    );

    expect(startTimes).toHaveLength(2);
    const orderedStartTimes = [...startTimes].sort((left, right) => left - right);
    expect(orderedStartTimes[1]! - orderedStartTimes[0]!).toBeGreaterThanOrEqual(900);
    await expect(
      queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT rate_limit_max, rate_limit_period_sec
           FROM "dbos"."queues"
          WHERE name = 'heptalogos.queue.work.default'`,
      ),
    ).resolves.toMatchObject({
      rows: [{ rate_limit_max: 1, rate_limit_period_sec: 1 }],
    });
  }, 180_000);

  it("bounds actual execution independently within each DBOS partition", async () => {
    const fixture = await makeFixture();
    const profiles = createWorkQueueProfileCatalog([
      {
        profileId: queueProfileId,
        globalConcurrency: 4,
        workerConcurrency: 4,
        partition: { concurrency: 1 },
        minPollingIntervalMs: 25,
      },
    ]);
    const partitionByWorkItem = new Map<string, string>();
    const activeByPartition = new Map<string, number>();
    const maximumActiveByPartition = new Map<string, number>();
    const startedByPartition = new Map<string, string>();
    const gates = new Map<string, Promise<void>>();
    const releases = new Map<string, () => void>();
    for (const partition of ["tenant-a", "tenant-b"]) {
      gates.set(
        partition,
        new Promise<void>((resolve) => {
          releases.set(partition, resolve);
        }),
      );
    }
    let firstPartitionsStarted!: () => void;
    const firstPartitionsStartedPromise = new Promise<void>((resolve) => {
      firstPartitionsStarted = resolve;
    });
    const handler: RuntimeWorkHandler = {
      async execute(input) {
        const workItemId = String(input.workItemId);
        const partition = partitionByWorkItem.get(workItemId);
        if (partition === undefined) {
          throw new Error(`missing test partition for ${workItemId}`);
        }
        const active = (activeByPartition.get(partition) ?? 0) + 1;
        activeByPartition.set(partition, active);
        maximumActiveByPartition.set(
          partition,
          Math.max(maximumActiveByPartition.get(partition) ?? 0, active),
        );
        const firstForPartition = !startedByPartition.has(partition);
        if (firstForPartition) {
          startedByPartition.set(partition, workItemId);
          if (startedByPartition.size === 2) firstPartitionsStarted();
        }
        try {
          if (firstForPartition) await gates.get(partition);
          return { outcome: { accepted: true } };
        } finally {
          activeByPartition.set(partition, (activeByPartition.get(partition) ?? 1) - 1);
        }
      },
    };
    activeComposition = await createComposition(fixture, {
      durableExecution: true,
      profiles,
      handler,
    });
    const composition = activeComposition;
    await requireDurable(composition);
    const items = [
      await createWork(composition, composition.target, {
        dedupKey: "dbos-partition-a-first",
        partitionKey: "tenant-a",
      }),
      await createWork(composition, composition.target, {
        dedupKey: "dbos-partition-a-second",
        partitionKey: "tenant-a",
      }),
      await createWork(composition, composition.target, {
        dedupKey: "dbos-partition-b-first",
        partitionKey: "tenant-b",
      }),
      await createWork(composition, composition.target, {
        dedupKey: "dbos-partition-b-second",
        partitionKey: "tenant-b",
      }),
    ];
    for (const created of items) {
      if (created.item.partitionKey === undefined) {
        throw new Error("partitioned qualification WorkItem lost its partition key");
      }
      partitionByWorkItem.set(
        String(created.item.workItemId),
        created.item.partitionKey,
      );
    }
    await Promise.all(
      items.map((created) =>
        composition.durableDispatch.dispatch(durableRequest(created.item)),
      ),
    );

    try {
      await firstPartitionsStartedPromise;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      expect(startedByPartition).toHaveProperty("size", 2);
      expect(activeByPartition.get("tenant-a")).toBe(1);
      expect(activeByPartition.get("tenant-b")).toBe(1);
      expect(maximumActiveByPartition.get("tenant-a")).toBe(1);
      expect(maximumActiveByPartition.get("tenant-b")).toBe(1);
    } finally {
      releases.get("tenant-a")!();
      releases.get("tenant-b")!();
    }
    await waitUntil(async () =>
      (
        await Promise.all(
          items.map((created) =>
            composition.repository.getWorkItem(created.item.workItemId),
          ),
        )
      ).every((item) => item?.state === "SUCCEEDED"),
    );
  }, 180_000);

  it("uses priority for DBOS scheduling after WorkQueue admission", async () => {
    const fixture = await makeFixture();
    const admittedWorkItemIds: string[] = [];
    const admission: WorkAdmissionPort = {
      beforeCreate: async () => ({ decision: "ALLOW" }),
      beforeDispatch: async ({ workItem }) => {
        admittedWorkItemIds.push(String(workItem.workItemId));
        return { decision: "ALLOW" };
      },
    };
    const profiles = createWorkQueueProfileCatalog([
      {
        profileId: queueProfileId,
        globalConcurrency: 1,
        workerConcurrency: 1,
        minPollingIntervalMs: 250,
      },
    ]);
    let highPriorityWorkItemId = "";
    const started: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const handler: RuntimeWorkHandler = {
      async execute(input) {
        const workItemId = String(input.workItemId);
        started.push(workItemId);
        if (started.length === 1) {
          firstStarted();
          await firstGate;
        }
        return { outcome: { accepted: true } };
      },
    };
    activeComposition = await createComposition(fixture, {
      durableExecution: true,
      profiles,
      admission,
      handler,
    });
    const composition = activeComposition;
    await requireDurable(composition);
    const lowPriority = await createWork(composition, composition.target, {
      dedupKey: "dbos-priority-low",
      priority: 100,
    });
    const highPriority = await createWork(composition, composition.target, {
      dedupKey: "dbos-priority-high",
      priority: 1,
    });
    highPriorityWorkItemId = String(highPriority.item.workItemId);

    try {
      await composition.reconciler.start();
      await firstStartedPromise;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      expect(started).toEqual([highPriorityWorkItemId]);
      expect(new Set(admittedWorkItemIds)).toEqual(
        new Set([String(lowPriority.item.workItemId), highPriorityWorkItemId]),
      );
      const rows = await queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT workflow_uuid, priority
           FROM "dbos"."workflow_status"
          WHERE workflow_uuid IN ($1, $2)`,
        [
          `heptalogos.work.${createDispatchAttemptId(lowPriority.item.workItemId, 1)}`,
          `heptalogos.work.${createDispatchAttemptId(highPriority.item.workItemId, 1)}`,
        ],
      );
      expect(rows.rows).toEqual(
        expect.arrayContaining([
          {
            workflow_uuid: `heptalogos.work.${createDispatchAttemptId(
              lowPriority.item.workItemId,
              1,
            )}`,
            priority: 100,
          },
          {
            workflow_uuid: `heptalogos.work.${createDispatchAttemptId(
              highPriority.item.workItemId,
              1,
            )}`,
            priority: 1,
          },
        ]),
      );
    } finally {
      releaseFirst();
    }
    await waitUntil(
      async () =>
        (await composition.repository.getWorkItem(lowPriority.item.workItemId))
          ?.state === "SUCCEEDED" &&
        (await composition.repository.getWorkItem(highPriority.item.workItemId))
          ?.state === "SUCCEEDED",
    );
    expect(started).toEqual([
      highPriorityWorkItemId,
      String(lowPriority.item.workItemId),
    ]);
  }, 180_000);
});
