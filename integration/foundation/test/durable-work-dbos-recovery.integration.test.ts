// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from "vitest";
import {
  BOOTSTRAP_PASSWORD,
  cleanupCanonicalPostgresFixtures,
  closeComposition,
  createComposition,
  createWork,
  describePostgres,
  DURABLE_CODE_VERSION,
  DURABLE_OPTIONS,
  durableRequest,
  durableWorkflowRow,
  futureTime,
  generation,
  initialTime,
  makeFixture,
  PROFILE_CATALOG,
  queryAs,
  requireDurable,
  runCanonicalMutation,
  waitUntil,
  WORK_OPTIONS,
  type Composition,
} from "../support/durable-work-fixture.js";
import {
  createDurableExecutionRuntime,
  createDurableDispatchPort,
} from "@heptalogos/durable-execution";
import {
  createGenerationFence,
  WorkHandlerRegistry,
  type RuntimeWorkHandler,
} from "@heptalogos/runtime-kernel";
import {
  createWorkAttemptExecutor,
  createDispatchAttemptId,
} from "@heptalogos/work-queue";

let activeComposition: Composition | undefined;

afterEach(async () => {
  const composition = activeComposition;
  activeComposition = undefined;
  if (composition !== undefined) await closeComposition(composition);
  await cleanupCanonicalPostgresFixtures();
}, 180_000);

describePostgres.sequential(
  "DBOS durable projection, recovery, and generation qualification",
  () => {
    it("recovers a lost immediate projection through anti-entropy", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture, { durableExecution: true });
      const composition = activeComposition;
      await requireDurable(composition);
      composition.setDispatchUnavailable(true);
      await composition.reconciler.start();
      const created = await createWork(composition, composition.target, {
        dedupKey: "dbos-d1-lost-projection",
      });
      await waitUntil(() => composition.dispatches.length >= 1);
      composition.setDispatchUnavailable(false);
      await composition.reconciler.scan();

      await waitUntil(
        async () =>
          (await composition.repository.getWorkItem(created.item.workItemId))?.state ===
          "SUCCEEDED",
      );
      const attemptId = createDispatchAttemptId(created.item.workItemId, 1);
      const workflowID = `heptalogos.work.${attemptId}`;
      await expect(durableWorkflowRow(fixture, workflowID)).resolves.toMatchObject({
        workflow_uuid: workflowID,
        status: "SUCCESS",
        application_version: DURABLE_CODE_VERSION,
        queue_name: "heptalogos.queue.work.default",
      });
      expect(composition.handlerCalls).toHaveLength(1);
      expect(composition.dispatches.length).toBeGreaterThanOrEqual(2);
    }, 180_000);

    it("collapses duplicate projection of one WorkItem revision", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture, { durableExecution: true });
      const composition = activeComposition;
      await requireDurable(composition);
      const created = await createWork(composition, composition.target, {
        dedupKey: "dbos-d2-duplicate",
      });
      const dispatch = durableRequest(created.item);
      await Promise.all([
        composition.durableDispatch.dispatch(dispatch),
        composition.durableDispatch.dispatch(dispatch),
      ]);
      await waitUntil(
        async () =>
          (await composition.repository.getWorkItem(created.item.workItemId))?.state ===
          "SUCCEEDED",
      );

      const workflowID = `heptalogos.work.${dispatch.dispatchAttemptId}`;
      const rows = await queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT workflow_uuid, status, application_version
         FROM "dbos"."workflow_status"
        WHERE workflow_uuid = $1`,
        [workflowID],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({
        workflow_uuid: workflowID,
        status: "SUCCESS",
        application_version: DURABLE_CODE_VERSION,
      });
      expect(composition.handlerCalls).toHaveLength(1);
    }, 180_000);

    it("projects notBefore as a DBOS delay while canonical time remains authoritative", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture, { durableExecution: true });
      const composition = activeComposition;
      await requireDurable(composition);
      const created = await createWork(composition, composition.target, {
        dedupKey: "dbos-d3-not-before",
        notBefore: futureTime,
      });
      const dispatch = durableRequest(created.item);
      await composition.durableDispatch.dispatch(dispatch);
      const workflowID = `heptalogos.work.${dispatch.dispatchAttemptId}`;
      await waitUntil(
        async () => (await durableWorkflowRow(fixture, workflowID)) !== undefined,
      );

      await expect(durableWorkflowRow(fixture, workflowID)).resolves.toMatchObject({
        status: "DELAYED",
        application_version: DURABLE_CODE_VERSION,
        delay_until_epoch_ms: expect.anything(),
      });
      const delayedRow = await durableWorkflowRow(fixture, workflowID);
      expect(Number(delayedRow?.delay_until_epoch_ms)).toBeGreaterThan(Date.now());
      expect(composition.handlerCalls).toHaveLength(0);
      await expect(
        composition.repository.getWorkItem(created.item.workItemId),
      ).resolves.toMatchObject({ state: "PENDING", dispatchRevision: 1 });
    }, 180_000);

    it("increments the canonical revision before projecting a retry", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture, { durableExecution: true });
      const composition = activeComposition;
      await requireDurable(composition);
      const created = await createWork(composition, composition.target, {
        dedupKey: "dbos-d4-retry-revision",
        notBefore: futureTime,
      });
      const firstDispatch = durableRequest(created.item);
      await composition.durableDispatch.dispatch(firstDispatch);
      const firstWorkflowID = `heptalogos.work.${firstDispatch.dispatchAttemptId}`;
      await waitUntil(
        async () => (await durableWorkflowRow(fixture, firstWorkflowID)) !== undefined,
      );

      await runCanonicalMutation(composition, "qualification.dbos.retry", () =>
        composition.repository.markRetryWait({
          workItemId: created.item.workItemId,
          expectedDispatchRevision: 1,
          expectedState: "PENDING",
          retryClass: "transient",
          reasonCode: "qualification.dbos.retry",
          notBefore: futureTime,
          updatedAt: initialTime,
        }),
      );
      composition.time.advanceWallClock(5 * 60 * 1_000);
      await composition.reconciler.scan();
      await waitUntil(
        async () =>
          (await composition.repository.getWorkItem(created.item.workItemId))?.state ===
          "SUCCEEDED",
      );

      const secondAttemptId = createDispatchAttemptId(created.item.workItemId, 2);
      const secondWorkflowID = `heptalogos.work.${secondAttemptId}`;
      expect(secondAttemptId).not.toBe(firstDispatch.dispatchAttemptId);
      expect(composition.dispatches).toContainEqual(
        expect.objectContaining({
          dispatchRevision: 2,
          dispatchAttemptId: secondAttemptId,
        }),
      );
      await expect(durableWorkflowRow(fixture, firstWorkflowID)).resolves.toMatchObject(
        {
          status: "DELAYED",
        },
      );
      await expect(
        durableWorkflowRow(fixture, secondWorkflowID),
      ).resolves.toMatchObject({
        status: "SUCCESS",
        application_version: DURABLE_CODE_VERSION,
      });
      expect(composition.handlerCalls).toHaveLength(1);
    }, 180_000);

    it("never binds a current generation to an item pinned to a missing generation", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture, { durableExecution: true });
      const composition = activeComposition;
      const packageB = generation("PackageGenerationId", "package-b");
      const registry = new WorkHandlerRegistry();
      const handlerBExecute = vi.fn(async () => ({ outcome: { accepted: true } }));
      const handlerB: RuntimeWorkHandler = {
        execute: handlerBExecute,
      };
      registry.register(
        {
          microSystemId: composition.target.microSystemId,
          productGenerationId: composition.target.productGenerationId,
          packageGenerationId: packageB,
        },
        composition.descriptor,
        handlerB,
        createGenerationFence(),
      );
      const alternateExecutor = createWorkAttemptExecutor({
        repository: composition.repository,
        handlerRegistry: registry,
        execution: composition.runtime,
        lineage: composition.lineage,
        time: composition.time,
        classifier: {
          classify: () => ({
            kind: "TERMINAL" as const,
            retryClass: "permanent" as const,
            reasonCode: "qualification.dbos.generation",
          }),
        },
        runtimeOptions: WORK_OPTIONS,
      });
      const durable = createDurableExecutionRuntime(
        composition.bootResult.host.durableExecution,
        DURABLE_OPTIONS,
        alternateExecutor,
      );
      const dispatch = createDurableDispatchPort({
        authority: composition.bootResult.host.durableExecution,
        lifecycle: durable,
        durableCodeVersion: DURABLE_CODE_VERSION,
        profiles: PROFILE_CATALOG,
        now: () => composition.time.now(),
      });

      try {
        await durable.start();
        const created = await createWork(composition, composition.target, {
          dedupKey: "dbos-d5-generation",
        });
        await dispatch.dispatch(durableRequest(created.item));
        await waitUntil(
          async () =>
            (await composition.repository.getWorkItem(created.item.workItemId))
              ?.state === "WAITING_DEPENDENCY",
        );
        expect(handlerBExecute).not.toHaveBeenCalled();

        const handlerAExecute = vi.fn(async () => ({ outcome: { accepted: true } }));
        const handlerA: RuntimeWorkHandler = {
          execute: handlerAExecute,
        };
        registry.register(
          {
            microSystemId: composition.target.microSystemId,
            productGenerationId: composition.target.productGenerationId,
            packageGenerationId: composition.target.packageGenerationId,
          },
          composition.descriptor,
          handlerA,
          createGenerationFence(),
        );
        const wake = await runCanonicalMutation(
          composition,
          "qualification.dbos.generation",
          () =>
            composition.repository.wakeDependency({
              workItemId: created.item.workItemId,
              expectedDispatchRevision: 1,
              updatedAt: initialTime,
            }),
        );
        if (wake.item === undefined)
          throw new Error("dependency wake did not return WorkItem");
        expect(wake.item.dispatchRevision).toBe(2);
        await dispatch.dispatch(durableRequest(wake.item));
        await waitUntil(
          async () =>
            (await composition.repository.getWorkItem(created.item.workItemId))
              ?.state === "SUCCEEDED",
        );
        expect(handlerBExecute).not.toHaveBeenCalled();
        expect(handlerAExecute).toHaveBeenCalledTimes(1);
      } finally {
        await durable.close().catch(() => undefined);
      }
    }, 180_000);
  },
);
