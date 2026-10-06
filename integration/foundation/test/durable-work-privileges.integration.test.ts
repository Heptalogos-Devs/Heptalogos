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
  DURABLE_CODE_VERSION,
  DURABLE_EXECUTION_PASSWORD,
  DURABLE_OPTIONS,
  durableProductPrivilegeSnapshot,
  durableRequest,
  durableWorkflowRow,
  makeFixture,
  MIGRATION_PASSWORD,
  queryAs,
  queueProfileId,
  requireDurable,
  waitUntil,
  type Composition,
} from "../support/durable-work-fixture.js";
import { type Instant } from "@heptalogos/foundation-contracts";
import {
  createDurableExecutionRuntime,
  createDurableDispatchPort,
} from "@heptalogos/durable-execution";
import {
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

describePostgres.sequential(
  "DBOS product privilege and admission qualification",
  () => {
    it("proves complete product-schema denial for the dedicated durable role", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture, { durableExecution: true });
      const composition = activeComposition;
      await requireDurable(composition);
      const created = await createWork(composition, composition.target, {
        dedupKey: "dbos-d6-role-isolation",
      });
      await composition.durableDispatch.dispatch(durableRequest(created.item));
      await waitUntil(
        async () =>
          (await composition.repository.getWorkItem(created.item.workItemId))?.state ===
          "SUCCEEDED",
      );

      await expect(
        queryAs(
          fixture,
          "heptalogos_durable_execution",
          DURABLE_EXECUTION_PASSWORD,
          `SELECT count(*)::integer AS workflow_count FROM "dbos"."workflow_status"`,
        ),
      ).resolves.toMatchObject({ rows: [{ workflow_count: expect.anything() }] });

      const privilegeSnapshot = await durableProductPrivilegeSnapshot(fixture);
      expect(privilegeSnapshot.schema).toMatchObject({
        product_schema_usage: false,
        product_schema_create: false,
        dbos_schema_usage: true,
        dbos_schema_create: false,
      });
      expect(privilegeSnapshot.relations.length).toBeGreaterThan(0);
      expect(
        privilegeSnapshot.relations.every(
          (relation) =>
            !relation.can_read &&
            !relation.can_insert &&
            !relation.can_update &&
            !relation.can_delete &&
            !relation.can_usage,
        ),
      ).toBe(true);
      expect(privilegeSnapshot.routines.every((routine) => !routine.can_execute)).toBe(
        true,
      );
      expect(privilegeSnapshot.dbos).toMatchObject({
        dbos_select: true,
        dbos_insert: true,
        dbos_update: true,
        dbos_delete: true,
      });
      await expect(
        queryAs(
          fixture,
          "heptalogos_durable_execution",
          DURABLE_EXECUTION_PASSWORD,
          `SELECT count(*) FROM "heptalogos"."work_item"`,
        ),
      ).rejects.toBeDefined();
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT state FROM "heptalogos"."work_item" WHERE work_item_id = $1`,
          [created.item.workItemId],
        ),
      ).resolves.toMatchObject({ rows: [{ state: "SUCCEEDED" }] });
    }, 180_000);

    it("fails closed on a persisted queue-profile mismatch without overwriting it", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture, { durableExecution: true });
      const composition = activeComposition;
      const conflictingProfiles = createWorkQueueProfileCatalog([
        {
          profileId: queueProfileId,
          globalConcurrency: 999,
          minPollingIntervalMs: 100,
        },
      ]);
      const conflictingRuntime = createDurableExecutionRuntime(
        composition.bootResult.host.durableExecution,
        { ...DURABLE_OPTIONS, profiles: conflictingProfiles },
        composition.executor,
      );
      const conflictingDispatch = createDurableDispatchPort({
        authority: composition.bootResult.host.durableExecution,
        lifecycle: conflictingRuntime,
        durableCodeVersion: DURABLE_CODE_VERSION,
        profiles: conflictingProfiles,
        now: () => composition.time.now(),
      });
      try {
        await conflictingRuntime.start();
        const created = await createWork(composition, composition.target, {
          dedupKey: "dbos-profile-mismatch-pending",
        });
        const delayedDispatch = durableRequest({
          ...created.item,
          notBefore:
            `${new Date(Date.now() + 60 * 60 * 1_000).toISOString()}` as Instant,
        });
        await conflictingDispatch.dispatch(delayedDispatch);
        await waitUntil(
          async () =>
            (
              await durableWorkflowRow(
                fixture,
                `heptalogos.work.${delayedDispatch.dispatchAttemptId}`,
              )
            )?.status === "DELAYED",
        );
        await conflictingRuntime.close();

        await expect(composition.durable!.start()).rejects.toMatchObject({
          problem: { problemCode: "durable_execution.queue_profile_mismatch" },
        });
        expect(composition.durable!.state).toBe("FAILED");
        await expect(
          queryAs(
            fixture,
            "heptalogos_bootstrap",
            BOOTSTRAP_PASSWORD,
            `SELECT concurrency FROM "dbos"."queues"
            WHERE name = 'heptalogos.queue.work.default'`,
          ),
        ).resolves.toMatchObject({ rows: [{ concurrency: 999 }] });
        await expect(
          durableWorkflowRow(
            fixture,
            `heptalogos.work.${delayedDispatch.dispatchAttemptId}`,
          ),
        ).resolves.toMatchObject({ status: "DELAYED" });
        expect(composition.handlerCalls).toHaveLength(0);
      } finally {
        await conflictingRuntime.close().catch(() => undefined);
        await composition.durable?.close().catch(() => undefined);
      }
    }, 180_000);

    it("does not auto-repair a missing vendor schema during normal launch", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture, { durableExecution: true });
      const composition = activeComposition;
      if (composition.durable === undefined) throw new Error("durable runtime missing");
      await queryAs(
        fixture,
        "heptalogos_migration",
        MIGRATION_PASSWORD,
        `DROP SCHEMA "dbos" CASCADE`,
        [],
        "-c role=heptalogos_owner",
      );

      await expect(composition.durable.start()).rejects.toBeDefined();
      expect(composition.durable.state).toBe("FAILED");
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT count(*)::integer AS schema_count
           FROM information_schema.schemata
          WHERE schema_name = 'dbos'`,
        ),
      ).resolves.toMatchObject({ rows: [{ schema_count: 0 }] });
    }, 180_000);

    it("persists partition limits and executes work from two explicit partitions", async () => {
      const fixture = await makeFixture();
      const partitionedProfiles = createWorkQueueProfileCatalog([
        {
          profileId: queueProfileId,
          minPollingIntervalMs: 100,
          partition: { concurrency: 1 },
        },
      ]);
      activeComposition = await createComposition(fixture, {
        durableExecution: true,
        profiles: partitionedProfiles,
      });
      const composition = activeComposition;
      await requireDurable(composition);
      const first = await createWork(composition, composition.target, {
        dedupKey: "dbos-d9-partition-a",
        partitionKey: "tenant-a",
      });
      const second = await createWork(composition, composition.target, {
        dedupKey: "dbos-d9-partition-b",
        partitionKey: "tenant-b",
      });
      const firstDispatch = durableRequest(first.item);
      const secondDispatch = durableRequest(second.item);
      await Promise.all([
        composition.durableDispatch.dispatch(firstDispatch),
        composition.durableDispatch.dispatch(secondDispatch),
      ]);
      await waitUntil(
        async () =>
          (await composition.repository.getWorkItem(first.item.workItemId))?.state ===
            "SUCCEEDED" &&
          (await composition.repository.getWorkItem(second.item.workItemId))?.state ===
            "SUCCEEDED",
      );

      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT partition_queue, partition_concurrency
           FROM "dbos"."queues"
          WHERE name = 'heptalogos.queue.work.default'`,
        ),
      ).resolves.toMatchObject({
        rows: [{ partition_queue: true, partition_concurrency: 1 }],
      });
      const rows = await queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT queue_partition_key
         FROM "dbos"."workflow_status"
        WHERE workflow_uuid IN ($1, $2)
        ORDER BY queue_partition_key`,
        [
          `heptalogos.work.${firstDispatch.dispatchAttemptId}`,
          `heptalogos.work.${secondDispatch.dispatchAttemptId}`,
        ],
      );
      expect(rows.rows).toEqual([
        { queue_partition_key: "tenant-a" },
        { queue_partition_key: "tenant-b" },
      ]);
      expect(composition.handlerCalls).toHaveLength(2);
    }, 180_000);

    it("keeps DBOS executorID stable across a new BootId", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture, { durableExecution: true });
      const first = activeComposition;
      await requireDurable(first);
      const firstWork = await createWork(first, first.target, {
        dedupKey: "dbos-d10-first-boot",
      });
      const firstDispatch = durableRequest(firstWork.item);
      await first.durableDispatch.dispatch(firstDispatch);
      await waitUntil(
        async () =>
          (await first.repository.getWorkItem(firstWork.item.workItemId))?.state ===
          "SUCCEEDED",
      );
      const firstRow = await durableWorkflowRow(
        fixture,
        `heptalogos.work.${firstDispatch.dispatchAttemptId}`,
      );
      if (firstRow === undefined) throw new Error("first DBOS workflow row missing");
      const firstBootId = first.bootResult.host.bootId;
      await closeComposition(first);
      activeComposition = undefined;

      activeComposition = await createComposition(fixture, { durableExecution: true });
      const second = activeComposition;
      await requireDurable(second);
      const secondWork = await createWork(second, second.target, {
        dedupKey: "dbos-d10-second-boot",
      });
      const secondDispatch = durableRequest(secondWork.item);
      await second.durableDispatch.dispatch(secondDispatch);
      await waitUntil(
        async () =>
          (await second.repository.getWorkItem(secondWork.item.workItemId))?.state ===
          "SUCCEEDED",
      );
      const secondRow = await durableWorkflowRow(
        fixture,
        `heptalogos.work.${secondDispatch.dispatchAttemptId}`,
      );
      if (secondRow === undefined) throw new Error("second DBOS workflow row missing");

      expect(second.bootResult.host.bootId).not.toBe(firstBootId);
      expect(second.bootResult.host.instanceId).toBe(first.bootResult.host.instanceId);
      expect(firstRow.executor_id).toBe(first.bootResult.host.instanceId);
      expect(secondRow.executor_id).toBe(firstRow.executor_id);
    }, 240_000);

    it("rejects new work before it can create a canonical or DBOS row", async () => {
      const fixture = await makeFixture();
      const admission: WorkAdmissionPort = {
        beforeCreate: async () => ({
          decision: "REJECT_NEW_WORK",
          reasonCode: "qualification.reject-new-work",
        }),
        beforeDispatch: async () => ({ decision: "ALLOW" }),
      };
      activeComposition = await createComposition(fixture, {
        durableExecution: true,
        admission,
      });
      const composition = activeComposition;
      await requireDurable(composition);
      const dedupKey = "dbos-reject-new-work";

      await expect(
        createWork(composition, composition.target, { dedupKey }),
      ).rejects.toMatchObject({
        problem: { problemCode: "work.admission.rejected_new_work" },
      });
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT count(*)::int AS count
           FROM "heptalogos"."work_item"
          WHERE dedup_key = $1`,
          [dedupKey],
        ),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT count(*)::int AS count
           FROM "dbos"."workflow_status"`,
        ),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    }, 180_000);
  },
);
