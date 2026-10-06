// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it, vi } from "vitest";
import {
  cleanupCanonicalPostgresFixtures,
  closeComposition,
  createComposition,
  createWork,
  describePostgres,
  futureTime,
  generation,
  initialTime,
  makeFixture,
  runCanonicalMutation,
  waitUntil,
  WORK_OPTIONS,
  type Composition,
} from "../support/durable-work-fixture.js";
import {
  createGenerationFence,
  WorkHandlerRegistry,
  type RuntimeWorkHandlerLease,
  type RuntimeWorkHandler,
  type RuntimeWorkHandlerInvocation,
  type WorkHandlerTarget,
} from "@heptalogos/runtime-kernel";
import {
  createWorkAttemptExecutor,
  createDispatchAttemptId,
  type WorkQueueRepository,
} from "@heptalogos/work-queue";

let activeComposition: Composition | undefined;

afterEach(async () => {
  const composition = activeComposition;
  activeComposition = undefined;
  if (composition !== undefined) await closeComposition(composition);
  await cleanupCanonicalPostgresFixtures();
}, 180_000);

describePostgres.sequential(
  "Canonical WorkItem reconciliation, generation, and fencing qualification",
  () => {
    it("advances retry revision before an old attempt can execute", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "w5-revision",
      });
      const initial = await composition.repository.getWorkItem(created.item.workItemId);
      if (initial === undefined) throw new Error("created WorkItem was not found");
      await runCanonicalMutation(composition, "qualification.work.retry", () =>
        composition.repository.markRetryWait({
          workItemId: initial.workItemId,
          expectedDispatchRevision: initial.dispatchRevision,
          expectedState: "PENDING",
          retryClass: "transient",
          reasonCode: "qualification.retry",
          notBefore: futureTime,
          updatedAt: initialTime,
        }),
      );
      await expect(
        composition.executor.execute(initial.workItemId, initial.dispatchRevision),
      ).resolves.toMatchObject({ status: "STALE_NOOP" });
      composition.time.advanceWallClock(5 * 60 * 1_000);
      await composition.reconciler.scan();
      await expect(
        composition.repository.getWorkItem(initial.workItemId),
      ).resolves.toMatchObject({
        state: "PENDING",
        dispatchRevision: 2,
      });
    }, 180_000);

    it("keeps generation B out while A is unavailable, then restores exact A", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "w6-generation",
      });
      const registry = new WorkHandlerRegistry();
      const packageB = generation("PackageGenerationId", "package-b");
      const targetB = { ...composition.target, packageGenerationId: packageB };
      const handlerB: RuntimeWorkHandler = {
        execute: vi.fn(async () => ({ outcome: { accepted: true } })),
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
            reasonCode: "qualification.failure",
          }),
        },
        runtimeOptions: WORK_OPTIONS,
      });
      await expect(
        alternateExecutor.execute(created.item.workItemId, 1),
      ).resolves.toMatchObject({ status: "WAITING_DEPENDENCY" });
      expect(Reflect.get(handlerB, "execute")).not.toHaveBeenCalled();
      const handlerA: RuntimeWorkHandler = {
        execute: vi.fn(async () => ({ outcome: { accepted: true } })),
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
      await runCanonicalMutation(composition, "qualification.work.dependency", () =>
        composition.repository.wakeDependency({
          workItemId: created.item.workItemId,
          expectedDispatchRevision: 1,
          updatedAt: initialTime,
        }),
      );
      await expect(
        alternateExecutor.execute(created.item.workItemId, 2),
      ).resolves.toMatchObject({ status: "SUCCEEDED" });
      expect(Reflect.get(handlerA, "execute")).toHaveBeenCalledTimes(1);
      void targetB;
    }, 180_000);

    it("keeps an exact admitted generation alive while retirement waits for settlement", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "generation-reservation-retirement",
      });
      const registry = new WorkHandlerRegistry();
      const fence = createGenerationFence();
      let entered!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let releaseHandler!: () => void;
      const handlerGate = new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });
      const handler: RuntimeWorkHandler = {
        execute: vi.fn(async () => {
          entered();
          await handlerGate;
          return { outcome: { accepted: true } };
        }),
      };
      registry.register(
        {
          microSystemId: composition.target.microSystemId,
          productGenerationId: composition.target.productGenerationId,
          packageGenerationId: composition.target.packageGenerationId,
        },
        composition.descriptor,
        handler,
        fence,
      );
      const classifier = {
        classify: vi.fn(() => ({
          kind: "TERMINAL" as const,
          retryClass: "permanent" as const,
          reasonCode: "unexpected-handler-failure",
        })),
      };
      const executor = createWorkAttemptExecutor({
        repository: composition.repository,
        handlerRegistry: registry,
        execution: composition.runtime,
        lineage: composition.lineage,
        time: composition.time,
        classifier,
        runtimeOptions: WORK_OPTIONS,
      });
      const execution = executor.execute(created.item.workItemId, 1);
      await enteredPromise;
      await expect(
        composition.repository.getWorkItem(created.item.workItemId),
      ).resolves.toMatchObject({ state: "RUNNING" });

      const retirement = registry.retireGeneration(fence, 1_000);
      expect(fence.state).toBe("RETIRING");
      let retired = false;
      void retirement.then(() => {
        retired = true;
      });
      await Promise.resolve();
      expect(retired).toBe(false);

      releaseHandler();
      await execution;
      await retirement;
      expect(Reflect.get(handler, "execute")).toHaveBeenCalledTimes(1);
      expect(Reflect.get(classifier, "classify")).not.toHaveBeenCalled();
      expect(fence.state).toBe("RETIRED");
    }, 180_000);

    it("releases a reserved invocation when the RUNNING CAS is lost", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "generation-reservation-cas-loss",
      });
      let reservationReady!: () => void;
      const reservationReadyPromise = new Promise<void>((resolve) => {
        reservationReady = resolve;
      });
      let release: (() => void) | undefined;
      let releaseCount = 0;
      const handlerRegistry = {
        resolve(target: WorkHandlerTarget): RuntimeWorkHandlerLease | undefined {
          const lease = composition.supervisor.workHandlers.resolve(target);
          if (lease === undefined) return undefined;
          return Object.freeze({
            ...lease,
            reserveInvocation() {
              const reservation = lease.reserveInvocation();
              reservationReady();
              release = () => {
                releaseCount += 1;
                reservation.release();
              };
              return {
                execute(input: RuntimeWorkHandlerInvocation) {
                  return reservation.execute(input);
                },
                release,
              };
            },
          });
        },
      };
      const repository: WorkQueueRepository = {
        ...composition.repository,
        async markRunning(input) {
          await reservationReadyPromise;
          await runCanonicalMutation(composition, "qualification.work.cancel.cas", () =>
            composition.repository.requestCancel({
              workItemId: input.workItemId,
              expectedDispatchRevision: input.expectedDispatchRevision,
              expectedState: "PENDING",
              requestedAt: initialTime,
              reasonCode: "qualification.cancel.cas",
            }),
          );
          return composition.repository.markRunning(input);
        },
      };
      const executor = createWorkAttemptExecutor({
        repository,
        handlerRegistry,
        execution: composition.runtime,
        lineage: composition.lineage,
        time: composition.time,
        classifier: {
          classify: vi.fn(() => ({
            kind: "TERMINAL" as const,
            retryClass: "permanent" as const,
            reasonCode: "must-not-run",
          })),
        },
        runtimeOptions: WORK_OPTIONS,
      });

      await expect(executor.execute(created.item.workItemId, 1)).resolves.toMatchObject(
        {
          status: "TERMINAL_REPLAY",
          outcome: { kind: "CANCELLED" },
        },
      );
      expect(releaseCount).toBe(1);
      expect(composition.handlerCalls).toHaveLength(0);
      await expect(
        composition.repository.getWorkItem(created.item.workItemId),
      ).resolves.toMatchObject({ state: "CANCELLED" });
    }, 180_000);

    it("makes cancellation win both before invoke and during cooperative running", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const pending = await createWork(composition, composition.target, {
        dedupKey: "w7-pending-cancel",
      });
      await runCanonicalMutation(composition, "qualification.work.cancel", () =>
        composition.repository.requestCancel({
          workItemId: pending.item.workItemId,
          expectedDispatchRevision: 1,
          expectedState: "PENDING",
          requestedAt: initialTime,
          reasonCode: "qualification.cancel",
        }),
      );
      await expect(
        composition.executor.execute(pending.item.workItemId, 1),
      ).resolves.toMatchObject({
        status: "TERMINAL_REPLAY",
        outcome: { kind: "CANCELLED" },
      });
      expect(composition.handlerCalls).toHaveLength(0);

      const runningItem = await createWork(composition, composition.target, {
        dedupKey: "w7-running-cancel",
      });
      const registry = new WorkHandlerRegistry();
      let aborted = false;
      const cooperative: RuntimeWorkHandler = {
        execute: vi.fn(
          ({ signal }: { readonly signal: AbortSignal }) =>
            new Promise<{ readonly outcome: { readonly accepted: boolean } }>(
              (resolve) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    aborted = true;
                    resolve({ outcome: { accepted: true } });
                  },
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
        cooperative,
        createGenerationFence(),
      );
      const runningExecutor = createWorkAttemptExecutor({
        repository: composition.repository,
        handlerRegistry: registry,
        execution: composition.runtime,
        lineage: composition.lineage,
        time: composition.time,
        classifier: {
          classify: () => ({
            kind: "TERMINAL" as const,
            retryClass: "permanent" as const,
            reasonCode: "qualification.cancelled-handler",
          }),
        },
        runtimeOptions: WORK_OPTIONS,
      });
      const execution = runningExecutor.execute(runningItem.item.workItemId, 1);
      await waitUntil(
        async () =>
          (await composition.repository.getWorkItem(runningItem.item.workItemId))
            ?.state === "RUNNING",
      );
      await runCanonicalMutation(composition, "qualification.work.cancel.running", () =>
        composition.repository.requestCancel({
          workItemId: runningItem.item.workItemId,
          expectedDispatchRevision: 1,
          expectedState: "RUNNING",
          expectedActiveAttemptId: createDispatchAttemptId(
            runningItem.item.workItemId,
            1,
          ),
          requestedAt: initialTime,
          reasonCode: "qualification.cancel",
        }),
      );
      await expect(execution).resolves.toMatchObject({ status: "CANCELLED" });
      expect(aborted).toBe(true);
    }, 180_000);

    it("projects future work with its due time while early execution remains fenced", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "future-projection",
        notBefore: futureTime,
      });

      await expect(composition.reconciler.scan()).resolves.toMatchObject({
        dispatched: 1,
      });
      expect(composition.dispatches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workItemId: created.item.workItemId,
            dispatchRevision: 1,
            dispatchAttemptId: createDispatchAttemptId(created.item.workItemId, 1),
            notBefore: futureTime,
          }),
        ]),
      );
      await expect(
        composition.executor.execute(created.item.workItemId, 1),
      ).resolves.toMatchObject({ status: "RETRY_WAIT" });
      expect(composition.handlerCalls).toHaveLength(0);
    }, 180_000);
  },
);
