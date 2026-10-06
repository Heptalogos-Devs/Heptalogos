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
  futureTime,
  initialTime,
  makeFixture,
  PROFILE_CATALOG,
  queryAs,
  queueProfileId,
  resourceAdmissionClass,
  runCanonicalMutation,
  waitUntil,
  WORK_OPTIONS,
  type Composition,
} from "../support/durable-work-fixture.js";
import {
  createContributionId,
  createWorkItemId,
} from "@heptalogos/foundation-contracts";
import {
  createGenerationFence,
  WorkHandlerRegistry,
  type RuntimeWorkHandler,
  type WorkHandlerProvisionDescriptor,
} from "@heptalogos/runtime-kernel";
import {
  createWorkAttemptExecutor,
  createDispatchAttemptId,
  createWorkQueueService,
  type WorkAdmissionPort,
  type WorkItem,
} from "@heptalogos/work-queue";
import { postgresSignalPublisher } from "@heptalogos/signal";

let activeComposition: Composition | undefined;

afterEach(async () => {
  const composition = activeComposition;
  activeComposition = undefined;
  if (composition !== undefined) await closeComposition(composition);
  await cleanupCanonicalPostgresFixtures();
}, 180_000);

describePostgres.sequential(
  "Canonical WorkItem retry, scan, payload, and cancellation qualification",
  () => {
    it("uses the canonical projection index for fair PENDING and dependency scans", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      for (const state of ["PENDING", "WAITING_DEPENDENCY"] as const) {
        const explained = await queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `EXPLAIN (FORMAT JSON, COSTS OFF)
           SELECT work_item_id
             FROM "heptalogos"."work_item"
            WHERE state = '${state}'
              AND (created_at, work_item_id) >
                (TIMESTAMPTZ '1970-01-01 00:00:00+00',
                 '00000000-0000-7000-8000-000000000000'::uuid)
              AND (created_at, work_item_id) <=
                (TIMESTAMPTZ '9999-12-31 23:59:59+00',
                 'ffffffff-ffff-7fff-bfff-ffffffffffff'::uuid)
            ORDER BY created_at ASC, work_item_id ASC
            LIMIT 32`,
          [],
          "-c enable_seqscan=off",
        );
        expect(JSON.stringify(explained.rows)).toContain("work_item_projection_index");
      }
    }, 180_000);

    it("gives a later PENDING WorkItem a projection opportunity past one stable page", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await Promise.all(
        Array.from({ length: WORK_OPTIONS.reconciliationBatchSize + 1 }, (_, index) =>
          createWork(composition, composition.target, {
            dedupKey: `fair-pending-${index}`,
          }),
        ),
      );
      const later = [...created]
        .map((value) => value.item)
        .sort((left, right) =>
          `${left.createdAt}\u0000${left.workItemId}`.localeCompare(
            `${right.createdAt}\u0000${right.workItemId}`,
          ),
        )
        .at(-1)!;

      await expect(composition.reconciler.scan()).resolves.toMatchObject({
        scanned: WORK_OPTIONS.reconciliationBatchSize,
        dispatched: WORK_OPTIONS.reconciliationBatchSize,
      });
      await expect(composition.reconciler.scan()).resolves.toMatchObject({
        dispatched: 1,
      });
      expect(composition.dispatches).toContainEqual(
        expect.objectContaining({
          workItemId: later.workItemId,
          dispatchRevision: 1,
          dispatchAttemptId: createDispatchAttemptId(later.workItemId, 1),
        }),
      );
    }, 180_000);

    it("gives a later available dependency a recheck past one stable unavailable page", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const template = await createWork(composition, composition.target, {
        dedupKey: "fair-waiting-template",
      });
      await runCanonicalMutation(
        composition,
        "qualification.work.cancel.template",
        () =>
          composition.repository.requestCancel({
            workItemId: template.item.workItemId,
            expectedDispatchRevision: 1,
            expectedState: "PENDING",
            requestedAt: initialTime,
            reasonCode: "qualification.template.cancelled",
          }),
      );
      const ids = Array.from({ length: WORK_OPTIONS.reconciliationBatchSize + 1 }, () =>
        createWorkItemId(),
      ).sort();
      const waitingItems: WorkItem[] = ids.map((workItemId, index) => ({
        ...template.item,
        workItemId,
        dedupKey: undefined,
        state: "WAITING_DEPENDENCY",
        stateReasonCode: "handler-unavailable",
        handler:
          index === ids.length - 1
            ? composition.target
            : {
                ...composition.target,
                contributionId: createContributionId(
                  `qualification.work.missing.${index}`,
                ),
              },
      }));
      for (const waiting of waitingItems) {
        await runCanonicalMutation(
          composition,
          "qualification.work.insert.waiting",
          () => composition.repository.insertWorkItem(waiting),
        );
      }
      const available = waitingItems.at(-1)!;

      await composition.reconciler.scan();
      await composition.reconciler.scan();

      await expect(
        composition.repository.getWorkItem(available.workItemId),
      ).resolves.toMatchObject({
        state: "PENDING",
        dispatchRevision: 2,
      });
      expect(composition.dispatches).toContainEqual(
        expect.objectContaining({
          workItemId: available.workItemId,
          dispatchRevision: 2,
          dispatchAttemptId: createDispatchAttemptId(available.workItemId, 2),
        }),
      );
    }, 180_000);

    it("detaches a caller payload before an asynchronous admission boundary", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      let admissionStarted!: () => void;
      const admissionStartedPromise = new Promise<void>((resolve) => {
        admissionStarted = resolve;
      });
      let releaseAdmission!: () => void;
      const admissionGate = new Promise<void>((resolve) => {
        releaseAdmission = resolve;
      });
      const admission: WorkAdmissionPort = {
        async beforeCreate() {
          admissionStarted();
          await admissionGate;
          return { decision: "ALLOW" };
        },
        async beforeDispatch() {
          return { decision: "ALLOW" };
        },
      };
      const work = createWorkQueueService({
        persistence: composition.persistence,
        handlerRegistry: composition.supervisor.workHandlers,
        execution: composition.runtime,
        lineage: composition.lineage,
        time: composition.time,
        signalPublisher: postgresSignalPublisher,
        admission,
        profiles: PROFILE_CATALOG,
        runtimeOptions: WORK_OPTIONS,
        onBackgroundError() {},
      });
      const payload = { value: "before" };
      const creation = composition.runtime.runActivity(
        {
          kind: "qualification.work.snapshot.payload",
          importance: "significant",
          retentionClass: "operational",
          sensitivity: "operational",
        },
        () =>
          work.create({
            target: composition.target,
            payload,
            queueProfileId,
            resourceAdmissionClass,
            priority: 100,
            dedupKey: "payload-snapshot-detachment",
          }),
      );
      await admissionStartedPromise;
      payload.value = "after";
      releaseAdmission();
      const result = await creation;

      expect(result.item.payload).toEqual({ value: "before" });
      await expect(
        composition.repository.getWorkItem(result.item.workItemId),
      ).resolves.toMatchObject({ payload: { value: "before" } });
    }, 180_000);

    it("keeps a handler-held outcome mutation out of terminal WorkItem truth", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "outcome-snapshot-detachment",
      });
      const registry = new WorkHandlerRegistry();
      const customDescriptor: WorkHandlerProvisionDescriptor = {
        ...composition.descriptor,
        outcomeSchema: {
          type: "object",
          properties: {
            nested: {
              type: "object",
              properties: { value: { type: "number" } },
              required: ["value"],
              additionalProperties: false,
            },
          },
          required: ["nested"],
          additionalProperties: false,
        },
      };
      let handlerOutcome!: { nested: { value: number } };
      const handler: RuntimeWorkHandler = {
        execute: vi.fn(async () => {
          handlerOutcome = { nested: { value: 1 } };
          return { outcome: handlerOutcome };
        }),
      };
      registry.register(
        {
          microSystemId: composition.target.microSystemId,
          productGenerationId: composition.target.productGenerationId,
          packageGenerationId: composition.target.packageGenerationId,
        },
        customDescriptor,
        handler,
        createGenerationFence(),
      );
      const executor = createWorkAttemptExecutor({
        repository: composition.repository,
        handlerRegistry: registry,
        execution: composition.runtime,
        lineage: composition.lineage,
        time: composition.time,
        classifier: {
          classify: () => ({
            kind: "TERMINAL" as const,
            retryClass: "permanent" as const,
            reasonCode: "unexpected-handler-failure",
          }),
        },
        runtimeOptions: WORK_OPTIONS,
      });

      await expect(executor.execute(created.item.workItemId, 1)).resolves.toMatchObject(
        {
          status: "SUCCEEDED",
        },
      );
      handlerOutcome.nested.value = 9;
      await expect(
        composition.repository.getWorkItem(created.item.workItemId),
      ).resolves.toMatchObject({
        state: "SUCCEEDED",
        outcome: { kind: "SUCCEEDED", value: { nested: { value: 1 } } },
      });
    }, 180_000);

    it("does not wake a waiting item when only its payload version is unavailable", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "payload-version-waiting",
      });
      const unavailable: WorkItem = {
        ...created.item,
        workItemId: createWorkItemId(),
        handler: { ...created.item.handler, payloadVersion: 2 },
        dedupKey: "payload-version-unavailable",
      };
      await runCanonicalMutation(composition, "qualification.work.insert", () =>
        composition.repository.insertWorkItem(unavailable),
      );

      await expect(
        composition.executor.execute(unavailable.workItemId, 1),
      ).resolves.toMatchObject({ status: "WAITING_DEPENDENCY" });
      const before = await composition.repository.getWorkItem(unavailable.workItemId);
      expect(before).toMatchObject({
        state: "WAITING_DEPENDENCY",
        dispatchRevision: 1,
      });
      await composition.reconciler.scan();
      await expect(
        composition.repository.getWorkItem(unavailable.workItemId),
      ).resolves.toMatchObject({
        state: "WAITING_DEPENDENCY",
        dispatchRevision: 1,
      });
    }, 180_000);

    it("terminalizes cancellation for dependency and retry waiting states", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "waiting-cancel",
      });
      const unavailable: WorkItem = {
        ...created.item,
        workItemId: createWorkItemId(),
        handler: { ...created.item.handler, payloadVersion: 2 },
        dedupKey: "waiting-cancel-payload",
      };
      await runCanonicalMutation(composition, "qualification.work.insert", () =>
        composition.repository.insertWorkItem(unavailable),
      );
      await composition.executor.execute(unavailable.workItemId, 1);
      await expect(
        runCanonicalMutation(composition, "qualification.work.cancel.waiting", () =>
          composition.repository.requestCancel({
            workItemId: unavailable.workItemId,
            expectedDispatchRevision: 1,
            expectedState: "WAITING_DEPENDENCY",
            requestedAt: initialTime,
            reasonCode: "qualification.cancel.waiting",
          }),
        ),
      ).resolves.toMatchObject({ status: "APPLIED", item: { state: "CANCELLED" } });

      const retry = await createWork(composition, composition.target, {
        dedupKey: "retry-cancel",
      });
      await runCanonicalMutation(composition, "qualification.work.retry", () =>
        composition.repository.markRetryWait({
          workItemId: retry.item.workItemId,
          expectedDispatchRevision: 1,
          expectedState: "PENDING",
          retryClass: "transient",
          reasonCode: "qualification.retry.waiting",
          notBefore: futureTime,
          updatedAt: initialTime,
        }),
      );
      await expect(
        runCanonicalMutation(composition, "qualification.work.cancel.retry", () =>
          composition.repository.requestCancel({
            workItemId: retry.item.workItemId,
            expectedDispatchRevision: 1,
            expectedState: "RETRY_WAIT",
            requestedAt: initialTime,
            reasonCode: "qualification.cancel.retry",
          }),
        ),
      ).resolves.toMatchObject({ status: "APPLIED", item: { state: "CANCELLED" } });
    }, 180_000);

    it("accepts only the first concurrent cancellation or supersession intent", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "first-terminal-intent",
      });
      const [cancel, supersede] = await Promise.all([
        runCanonicalMutation(composition, "qualification.work.cancel.concurrent", () =>
          composition.repository.requestCancel({
            workItemId: created.item.workItemId,
            expectedDispatchRevision: 1,
            expectedState: "PENDING",
            requestedAt: initialTime,
            reasonCode: "qualification.cancel.first",
          }),
        ),
        runCanonicalMutation(
          composition,
          "qualification.work.supersede.concurrent",
          () =>
            composition.repository.requestSupersede({
              workItemId: created.item.workItemId,
              expectedDispatchRevision: 1,
              expectedState: "PENDING",
              requestedAt: initialTime,
              supersededBy: createWorkItemId(),
            }),
        ),
      ]);
      expect(new Set([cancel.status, supersede.status])).toEqual(
        new Set(["APPLIED", "TERMINAL"]),
      );
      const item = await composition.repository.getWorkItem(created.item.workItemId);
      expect(item?.state === "CANCELLED" || item?.state === "SUPERSEDED").toBe(true);
      expect(item?.cancelRequestedAt !== undefined).not.toBe(
        item?.supersededBy !== undefined,
      );
      expect(item?.activeAttemptId).toBeUndefined();
    }, 180_000);

    it("finalizes a RUNNING supersession with the stable reason and exact target", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "running-supersession-contract",
      });
      const registry = new WorkHandlerRegistry();
      const supersessionHandler: RuntimeWorkHandler = {
        execute: vi.fn(
          ({ signal }: { readonly signal: AbortSignal }) =>
            new Promise<{ readonly outcome: { readonly accepted: boolean } }>(
              (resolve) => {
                signal.addEventListener(
                  "abort",
                  () => resolve({ outcome: { accepted: true } }),
                  { once: true },
                );
              },
            ),
        ),
      };
      registry.register(
        {
          microSystemId: composition.target.microSystemId,
          productGenerationId: composition.target.productGenerationId,
          packageGenerationId: composition.target.packageGenerationId,
        },
        composition.descriptor,
        supersessionHandler,
        createGenerationFence(),
      );
      const executor = createWorkAttemptExecutor({
        repository: composition.repository,
        handlerRegistry: registry,
        execution: composition.runtime,
        lineage: composition.lineage,
        time: composition.time,
        classifier: {
          classify: () => ({
            kind: "TERMINAL" as const,
            retryClass: "permanent" as const,
            reasonCode: "unexpected-handler-failure",
          }),
        },
        runtimeOptions: WORK_OPTIONS,
      });
      const supersededBy = createWorkItemId();
      const execution = executor.execute(created.item.workItemId, 1);
      await waitUntil(
        async () =>
          (await composition.repository.getWorkItem(created.item.workItemId))?.state ===
          "RUNNING",
      );
      await expect(
        runCanonicalMutation(composition, "qualification.work.supersede.running", () =>
          composition.repository.requestSupersede({
            workItemId: created.item.workItemId,
            expectedDispatchRevision: 1,
            expectedState: "RUNNING",
            expectedActiveAttemptId: createDispatchAttemptId(
              created.item.workItemId,
              1,
            ),
            requestedAt: initialTime,
            supersededBy,
          }),
        ),
      ).resolves.toMatchObject({ status: "APPLIED" });
      await expect(execution).resolves.toMatchObject({ status: "SUPERSEDED" });
      await expect(
        composition.repository.getWorkItem(created.item.workItemId),
      ).resolves.toMatchObject({
        state: "SUPERSEDED",
        supersededBy,
        outcome: {
          schemaVersion: 1,
          kind: "SUPERSEDED",
          reasonCode: "superseded-by-request",
          supersededBy,
        },
      });
    }, 180_000);
  },
);
