// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createWorldHostRuntime } from "../../../packages/application/product-host/src/world-host-runtime.js";
import { createWorldHostLifecycleService } from "@heptalogos/subject";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("World Host clock obligations in real PostgreSQL", () => {
  it("retains pause intent before external effects, replays exact receipts, and preserves operator clock authority", async () => {
    const current = await composeProductPersistence();
    const subjectId = randomUUID(),
      worldId = randomUUID();
    const lifecycle = createWorldHostLifecycleService({
      persistence: current.persistence,
      now: () => "2026-10-16T12:00:00.000Z",
    });
    const clock = {
      subjectId,
      timeDomainRef: "school",
      revision: "12",
      rate: 20,
      worldAt: "2026-10-16T12:00:00.000Z",
      recordedAt: "2026-10-16T03:00:00.000Z",
    };
    try {
      await current.run(() =>
        lifecycle.recordGap({
          subjectId,
          worldId,
          detail: "No actual clock was reachable at the first stop",
        }),
      );
      expect((await lifecycle.read(subjectId))?.before).toBeNull();
      await current.run(() => lifecycle.recordRunning({ subjectId, worldId, clock }));
      const intents = await Promise.all(
        Array.from({ length: 4 }, () =>
          current.run(() => lifecycle.preparePause({ subjectId, worldId, clock })),
        ),
      );
      expect(new Set(intents.map((value) => value.operationId)).size).toBe(1);
      const intent = intents[0]!;
      expect((await lifecycle.read(subjectId))?.status).toBe("prepared");
      await expect(
        current.run(() =>
          lifecycle.prepareResume({
            subjectId,
            operationId: intent.operationId,
            clock,
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "world.lifecycle_conflict" } });
      await current.run(() =>
        lifecycle.markUnknown({
          subjectId,
          operationId: intent.operationId,
          detail: "No official receipt; no guessed shutdown time",
        }),
      );
      const paused = { ...clock, rate: 0, revision: "13" };
      await current.run(() =>
        lifecycle.confirmPause({
          subjectId,
          operationId: intent.operationId,
          clock: paused,
        }),
      );
      expect(
        (
          await current.run(() =>
            lifecycle.prepareResume({
              subjectId,
              operationId: intent.operationId,
              clock: paused,
            }),
          )
        ).status,
      ).toBe("resuming");
      const resumed = { ...clock, revision: "14" };
      const adopted = await current.run(() =>
        lifecycle.confirmResume({
          subjectId,
          operationId: intent.operationId,
          clock: resumed,
        }),
      );
      expect(adopted.before?.rate).toBe(20);
      expect(
        await current.run(() =>
          lifecycle.confirmResume({
            subjectId,
            operationId: intent.operationId,
            clock: resumed,
          }),
        ),
      ).toEqual(adopted);
      const next = await current.run(() =>
        lifecycle.preparePause({ subjectId, worldId, clock: resumed }),
      );
      const nextPaused = { ...paused, revision: "15" };
      await current.run(() =>
        lifecycle.confirmPause({
          subjectId,
          operationId: next.operationId,
          clock: nextPaused,
        }),
      );
      const superseded = await current.run(() =>
        lifecycle.prepareResume({
          subjectId,
          operationId: next.operationId,
          clock: { ...nextPaused, revision: "16", rate: 5 },
        }),
      );
      expect(superseded.status).toBe("superseded");
      expect(superseded.before?.rate).toBe(20);
      await expect(
        current.run(() =>
          lifecycle.preparePause({ subjectId, worldId, clock: nextPaused }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "world.lifecycle_conflict" } });
    } finally {
      await current.close();
    }
  });
  it("connects normal Host stop/start to exact public CAS receipts and recovers a lost resume response", async () => {
    const current = await composeProductPersistence();
    const subjectId = randomUUID(),
      worldId = randomUUID();
    const lifecycle = createWorldHostLifecycleService({
      persistence: current.persistence,
      now: () => new Date().toISOString(),
    });
    let revision = 1n,
      rate = 20,
      loseResumeResponse = true;
    let offlinePolicy = "pause_with_host";
    const operations = new Map<string, unknown>();
    const snapshot = () => ({
      subjectId,
      timeDomainRef: "school",
      revision,
      rate,
      now: {
        timeDomainRef: "school",
        at: { seconds: 1792148400n, nanos: 0 },
        recordedAt: { seconds: 1792148400n, nanos: 0 },
      },
    });
    const clocks = {
      readClock: async () => snapshot(),
      pauseClock: async (input: { operationId: string; expectedRevision: bigint }) => {
        if (operations.has(input.operationId)) return operations.get(input.operationId);
        expect((await lifecycle.read(subjectId))?.status).toBe("prepared");
        if (input.expectedRevision !== revision)
          throw Error("actual owner CAS rejected");
        revision++;
        rate = 0;
        const result = snapshot();
        operations.set(input.operationId, result);
        return result;
      },
      resumeClock: async (input: {
        operationId: string;
        expectedRevision: bigint;
        rate: number;
      }) => {
        if (operations.has(input.operationId)) return operations.get(input.operationId);
        const stored = await lifecycle.read(subjectId);
        expect(stored?.status).toBe(
          stored?.ratePolicy &&
            input.rate === stored.ratePolicy.offlineRate &&
            stored.status === "prepared"
            ? "prepared"
            : "resuming",
        );
        if (input.expectedRevision !== revision)
          throw Error("actual owner CAS rejected");
        revision++;
        rate = input.rate;
        const result = snapshot();
        operations.set(input.operationId, result);
        if (loseResumeResponse) {
          loseResumeResponse = false;
          throw Error("response lost after actual commit");
        }
        return result;
      },
    };
    const host = createWorldHostRuntime({
      lifecycle,
      profiles: {
        read: async () => ({ profile: { clock: { onlineRate: 3, offlineRate: 1 } } }),
      },
      currentSubject: async () => subjectId,
      life: {
        schedule: async () => ({
          activities: [
            { activityId: randomUUID(), scope: { sourceRefs: [`world:${worldId}`] } },
          ],
          nextId: null,
        }),
      },
      worlds: {
        read: async () => ({
          definition: { timeDomainRef: "school", offlinePolicy },
        }),
      },
      nous: async () => ({ clocks }),
    } as unknown as Parameters<typeof createWorldHostRuntime>[0]);
    try {
      await current.run(host.start);
      await current.run(host.stop);
      expect(rate).toBe(0);
      expect((await lifecycle.read(subjectId))?.status).toBe("paused");
      await current.run(host.start);
      expect(rate).toBe(20);
      expect((await lifecycle.read(subjectId))?.status).toBe("unknown");
      // The next startup recovers the same saved resume receipt, never a second clock mutation.
      const afterResume = revision;
      await current.run(host.start);
      expect(revision).toBe(afterResume);
      expect((await lifecycle.read(subjectId))?.status).toBe("running");
      await current.run(host.stop);
      revision++;
      rate = 5; // Explicit later operator clock edit.
      const edited = revision;
      await current.run(host.start);
      expect(revision).toBe(edited);
      expect(rate).toBe(5);
      // The same normal Host lifecycle must use profile rates, not accelerated online time while stopped.
      offlinePolicy = "simulate_elapsed";
      await current.run(host.stop);
      expect(rate).toBe(1);
      expect((await lifecycle.read(subjectId))?.ratePolicy).toEqual({
        onlineRate: 3,
        offlineRate: 1,
      });
      await current.run(host.start);
      expect(rate).toBe(3);
      const resumedRevision = revision;
      await current.run(host.start);
      expect(revision).toBe(resumedRevision);
    } finally {
      await current.close();
    }
  });
});
