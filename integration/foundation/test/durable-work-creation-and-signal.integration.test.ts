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
  makeFixture,
  queryAs,
  waitUntil,
  type Composition,
} from "../support/durable-work-fixture.js";
import { createDispatchAttemptId } from "@heptalogos/work-queue";

let activeComposition: Composition | undefined;

afterEach(async () => {
  const composition = activeComposition;
  activeComposition = undefined;
  if (composition !== undefined) await closeComposition(composition);
  await cleanupCanonicalPostgresFixtures();
}, 180_000);

describePostgres.sequential(
  "Canonical durable WorkItem creation and Signal qualification",
  () => {
    it("canonical creation commits lineage and wakes dispatch reconciliation", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      await composition.reconciler.start();

      const created = await createWork(composition);
      await waitUntil(() =>
        composition.dispatches.some(
          (dispatch) => dispatch.workItemId === created.item.workItemId,
        ),
      );
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT state, dispatch_revision FROM "heptalogos"."work_item" WHERE work_item_id = $1`,
          [created.item.workItemId],
        ),
      ).resolves.toMatchObject({
        rows: [{ state: "PENDING", dispatch_revision: "1" }],
      });
      expect(composition.dispatches[0]?.dispatchAttemptId).toBe(
        createDispatchAttemptId(created.item.workItemId, 1),
      );
    }, 180_000);

    it("discovers a committed item after Signal listener termination and reconnect rescan", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      await composition.reconciler.start();
      await queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE application_name = 'heptalogos-signal-listener'
          AND pid <> pg_backend_pid()`,
      );
      const created = await createWork(composition, composition.target, {
        dedupKey: "w2-reconnect",
      });
      await waitUntil(() =>
        composition.dispatches.some(
          (dispatch) => dispatch.workItemId === created.item.workItemId,
        ),
      );
      await expect(
        composition.repository.getWorkItem(created.item.workItemId),
      ).resolves.toMatchObject({
        state: "PENDING",
      });
    }, 180_000);

    it("redispatches lost projection with the same revision attempt identity", async () => {
      const fixture = await makeFixture();
      activeComposition = await createComposition(fixture);
      const composition = activeComposition;
      composition.setDispatchUnavailable(true);
      await composition.reconciler.start();
      const created = await createWork(composition, composition.target, {
        dedupKey: "w3-lost-dispatch",
      });
      await waitUntil(() => composition.dispatches.length >= 1);
      const firstAttempt = composition.dispatches[0]!.dispatchAttemptId;
      composition.setDispatchUnavailable(false);
      await composition.reconciler.scan();
      await waitUntil(() => composition.dispatches.length >= 2);
      expect(composition.dispatches[1]!.dispatchRevision).toBe(1);
      expect(composition.dispatches[1]!.dispatchAttemptId).toBe(firstAttempt);
      expect(firstAttempt).toBe(createDispatchAttemptId(created.item.workItemId, 1));
    }, 180_000);
  },
);
