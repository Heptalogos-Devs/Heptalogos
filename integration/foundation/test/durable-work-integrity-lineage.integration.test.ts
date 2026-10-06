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
  MIGRATION_PASSWORD,
  PROFILE_CATALOG,
  queryAs,
  queueProfileId,
  resourceAdmissionClass,
  runCanonicalMutation,
  WORK_OPTIONS,
  type Composition,
} from "../support/durable-work-fixture.js";
import { createWorkItemId } from "@heptalogos/foundation-contracts";
import {
  createGenerationFence,
  WorkHandlerRegistry,
  type RuntimeWorkHandler,
} from "@heptalogos/runtime-kernel";
import {
  createWorkAttemptExecutor,
  createWorkQueueService,
  type WorkItem,
} from "@heptalogos/work-queue";
import { type SignalPublisher } from "@heptalogos/signal";

let activeComposition: Composition | undefined;

afterEach(async () => {
  const composition = activeComposition;
  activeComposition = undefined;
  if (composition !== undefined) await closeComposition(composition);
  await cleanupCanonicalPostgresFixtures();
}, 180_000);

describePostgres.sequential(
  "Canonical WorkItem integrity, authority, and lineage qualification",
  () => {
    it("rejects incoherent terminal WorkItem rows on a fresh PostgreSQL baseline", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "terminal-outcome-schema-coherence",
      });
      const cases = [
        {
          state: "SUCCEEDED",
          retryClass: null,
          outcome: {
            schemaVersion: 1,
            kind: "FAILED",
            retryClass: "permanent",
            reasonCode: "x",
          },
        },
        {
          state: "FAILED",
          retryClass: "permanent",
          outcome: { schemaVersion: 1, kind: "SUCCEEDED", value: {} },
        },
        {
          state: "CANCELLED",
          retryClass: null,
          outcome: { schemaVersion: 1, kind: "SUPERSEDED", reasonCode: "x" },
        },
        {
          state: "SUPERSEDED",
          retryClass: null,
          outcome: { schemaVersion: 1, kind: "CANCELLED", reasonCode: "x" },
        },
        {
          state: "FAILED",
          retryClass: "transient",
          outcome: {
            schemaVersion: 1,
            kind: "FAILED",
            retryClass: "permanent",
            reasonCode: "x",
          },
        },
        {
          state: "SUCCEEDED",
          retryClass: null,
          outcome: { schemaVersion: 2, kind: "SUCCEEDED", value: {} },
        },
      ] as const;
      for (const value of cases) {
        await expect(
          queryAs(
            fixture,
            "heptalogos_migration",
            MIGRATION_PASSWORD,
            `UPDATE "heptalogos"."work_item"
              SET state = $2, retry_class = $3, outcome = $4::jsonb
            WHERE work_item_id = $1`,
            [
              created.item.workItemId,
              value.state,
              value.retryClass,
              JSON.stringify(value.outcome),
            ],
            "-c role=heptalogos_owner",
          ),
        ).rejects.toBeDefined();
      }
    }, 180_000);

    it("terminalizes a forbidden external-effect classifier decision without stranded RUNNING state", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "forbidden-classifier-decision",
      });
      const registry = new WorkHandlerRegistry();
      const failingHandler: RuntimeWorkHandler = {
        execute: vi.fn(async () => {
          throw new Error("handler failure");
        }),
      };
      registry.register(
        {
          microSystemId: composition.target.microSystemId,
          productGenerationId: composition.target.productGenerationId,
          packageGenerationId: composition.target.packageGenerationId,
        },
        composition.descriptor,
        failingHandler,
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
            retryClass: "external-effect-uncertain" as const,
            reasonCode: "forbidden-in-this-stage",
          }),
        },
        runtimeOptions: WORK_OPTIONS,
      });

      await expect(executor.execute(created.item.workItemId, 1)).resolves.toMatchObject(
        {
          status: "FAILED",
          item: { state: "FAILED", retryClass: "invalid" },
        },
      );
      await expect(
        composition.repository.getWorkItem(created.item.workItemId),
      ).resolves.toMatchObject({
        state: "FAILED",
        retryClass: "invalid",
        outcome: {
          kind: "FAILED",
          retryClass: "invalid",
          reasonCode: "work.external_effect_uncertain_unsupported",
        },
      });
    }, 180_000);

    it("rolls back WorkItem creation when transaction-time Signal publication fails", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const failingPublisher: SignalPublisher = {
        async publish() {
          throw new Error("transaction-time signal failure");
        },
      };
      const failingWork = createWorkQueueService({
        persistence: composition.persistence,
        handlerRegistry: composition.supervisor.workHandlers,
        execution: composition.runtime,
        lineage: composition.lineage,
        time: composition.time,
        signalPublisher: failingPublisher,
        admission: composition.admission,
        profiles: PROFILE_CATALOG,
        runtimeOptions: WORK_OPTIONS,
        onBackgroundError() {},
      });
      const dedupKey = "transaction-signal-rollback";

      await expect(
        runCanonicalMutation(composition, "qualification.work.signal.rollback", () =>
          failingWork.create({
            target: composition.target,
            payload: { value: "work-qualification" },
            queueProfileId,
            resourceAdmissionClass,
            priority: 100,
            dedupKey,
          }),
        ),
      ).rejects.toBeDefined();
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT count(*)::int AS count FROM "heptalogos"."work_item" WHERE dedup_key = $1`,
          [dedupKey],
        ),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    }, 180_000);

    it("closes every significant WorkQueue Activity with its canonical mutation", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const activity = async (sourceActivityId: string) =>
        (
          await queryAs(
            fixture,
            "heptalogos_bootstrap",
            BOOTSTRAP_PASSWORD,
            `SELECT started_at, ended_at, outcome, outcome_ref
             FROM "heptalogos"."activity_record"
            WHERE kind = 'work.execute' AND causation_activity_id = $1
            ORDER BY started_at DESC, activity_id DESC
            LIMIT 1`,
            [sourceActivityId],
          )
        ).rows[0];

      const successful = await createWork(composition, composition.target, {
        dedupKey: "lineage-success",
      });
      const workCreate = await queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT ended_at, outcome, outcome_ref
         FROM "heptalogos"."activity_record"
        WHERE activity_id = $1`,
        [successful.item.lineageContextRef.sourceActivityId],
      );
      expect(workCreate.rows[0]).toMatchObject({
        ended_at: expect.anything(),
        outcome: "SUCCEEDED",
        outcome_ref: "CREATED",
      });
      await expect(
        composition.executor.execute(successful.item.workItemId, 1),
      ).resolves.toMatchObject({ status: "SUCCEEDED" });
      await expect(
        activity(successful.item.lineageContextRef.sourceActivityId),
      ).resolves.toMatchObject({
        ended_at: expect.anything(),
        outcome: "SUCCEEDED",
      });

      const waiting = await createWork(composition, composition.target, {
        dedupKey: "lineage-waiting",
      });
      const emptyRegistry = new WorkHandlerRegistry();
      const waitingExecutor = createWorkAttemptExecutor({
        repository: composition.repository,
        handlerRegistry: emptyRegistry,
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
      await expect(
        waitingExecutor.execute(waiting.item.workItemId, 1),
      ).resolves.toMatchObject({ status: "WAITING_DEPENDENCY" });
      await expect(
        activity(waiting.item.lineageContextRef.sourceActivityId),
      ).resolves.toMatchObject({
        ended_at: expect.anything(),
        outcome: "SUCCEEDED",
        outcome_ref: "WAITING_DEPENDENCY",
      });

      const retry = await createWork(composition, composition.target, {
        dedupKey: "lineage-retry-wait",
        notBefore: futureTime,
      });
      await expect(
        composition.executor.execute(retry.item.workItemId, 1),
      ).resolves.toMatchObject({ status: "RETRY_WAIT" });
      await expect(
        activity(retry.item.lineageContextRef.sourceActivityId),
      ).resolves.toMatchObject({
        ended_at: expect.anything(),
        outcome: "SUCCEEDED",
        outcome_ref: "RETRY_WAIT",
      });

      const invalidBase = await createWork(composition, composition.target, {
        dedupKey: "lineage-invalid-template",
      });
      const invalid: WorkItem = {
        ...invalidBase.item,
        workItemId: createWorkItemId(),
        dedupKey: "lineage-invalid-payload",
        payload: { value: 42 } as never,
      };
      await runCanonicalMutation(composition, "qualification.work.insert.invalid", () =>
        composition.repository.insertWorkItem(invalid),
      );
      await expect(
        composition.executor.execute(invalid.workItemId, 1),
      ).resolves.toMatchObject({ status: "FAILED" });
      await expect(
        activity(invalid.lineageContextRef.sourceActivityId),
      ).resolves.toMatchObject({
        ended_at: expect.anything(),
        outcome: "FAILED",
        outcome_ref: "runtime.work_handler.payload_invalid",
      });
    }, 180_000);

    it("fences mutations when the authentic Host lease closes", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition, composition.target, {
        dedupKey: "w8-host-loss",
      });
      await composition.bootResult.host.shutdownKeepingPrivatePostgres({
        async retire() {
          await composition.reconciler.stop();
          await composition.durable?.close();
          await composition.supervisor.close();
        },
      });
      expect(composition.bootResult.host.state).toBe("CLOSED");
      await expect(
        composition.repository.markWaitingDependency({
          workItemId: created.item.workItemId,
          expectedDispatchRevision: 1,
          updatedAt: initialTime,
        }),
      ).rejects.toBeDefined();
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT state FROM "heptalogos"."work_item" WHERE work_item_id = $1`,
          [created.item.workItemId],
        ),
      ).resolves.toMatchObject({ rows: [{ state: "PENDING" }] });
    }, 180_000);

    it("deduplicates non-terminal work and permits the key after terminalization", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const [first, second] = await Promise.all([
        createWork(composition, composition.target, { dedupKey: "w9-dedup" }),
        createWork(composition, composition.target, { dedupKey: "w9-dedup" }),
      ]);
      expect(new Set([first.status, second.status])).toEqual(
        new Set(["CREATED", "EXISTING"]),
      );
      const created = first.status === "CREATED" ? first : second;
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT count(*)::int AS count FROM "heptalogos"."work_item"
          WHERE handler_micro_system_id = $1 AND handler_contribution_id = $2 AND dedup_key = $3`,
          [
            composition.target.microSystemId,
            composition.target.contributionId,
            "w9-dedup",
          ],
        ),
      ).resolves.toMatchObject({ rows: [{ count: 1 }] });
      await expect(
        composition.executor.execute(created.item.workItemId, 1),
      ).resolves.toMatchObject({ status: "SUCCEEDED" });
      await expect(
        createWork(composition, composition.target, { dedupKey: "w9-dedup" }),
      ).resolves.toMatchObject({ status: "CREATED" });
    }, 180_000);

    it("reconstructs work.create to work.execute to contribution.invoke origin", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      const created = await createWork(composition);
      await expect(
        composition.executor.execute(created.item.workItemId, 1),
      ).resolves.toMatchObject({ status: "SUCCEEDED" });
      const activities = await queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT activity_id, kind, started_at, ended_at, outcome, outcome_ref,
              causation_activity_id,
              product_generation_id, package_generation_id,
              micro_system_id, micro_system_instance_id, contribution_id
         FROM "heptalogos"."activity_record"
        WHERE kind IN ('work.create', 'work.execute')
        ORDER BY started_at, activity_id`,
      );
      const workCreate = activities.rows.find((row) => row.kind === "work.create");
      const workExecute = activities.rows.find((row) => row.kind === "work.execute");
      expect(workCreate).toMatchObject({
        ended_at: expect.anything(),
        outcome: "SUCCEEDED",
        outcome_ref: "CREATED",
      });
      expect(workExecute).toMatchObject({
        ended_at: expect.anything(),
        outcome: "SUCCEEDED",
        causation_activity_id: workCreate?.activity_id,
        product_generation_id: composition.target.productGenerationId,
        package_generation_id: composition.target.packageGenerationId,
        micro_system_id: composition.target.microSystemId,
      });
      expect(composition.contributionContexts).toContainEqual(
        expect.objectContaining({
          kind: "contribution.invoke",
          parentActivityId: workExecute?.activity_id,
          origin: expect.objectContaining({
            runtime: expect.objectContaining({
              productGenerationId: composition.target.productGenerationId,
              packageGenerationId: composition.target.packageGenerationId,
              microSystemId: composition.target.microSystemId,
              contributionId: composition.target.contributionId,
            }),
          }),
        }),
      );
    }, 180_000);
  },
);
