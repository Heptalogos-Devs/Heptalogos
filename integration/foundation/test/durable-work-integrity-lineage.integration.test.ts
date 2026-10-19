// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { type SignalPublisher } from "@heptalogos/signal";
import { createWorkQueueService } from "@heptalogos/work-queue";
import { afterEach, expect, it } from "vitest";
import {
  BOOTSTRAP_PASSWORD,
  cleanupCanonicalPostgresFixtures,
  closeComposition,
  createComposition,
  createWork,
  describePostgres,
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
  },
);
