// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Applies an adopted pause policy through public clock CAS, with retained owner receipts.
 * @module world-host-runtime
 */
import { NousError, type NousClient } from "@nous-wave/client";
import type {
  createLifeService,
  createWorldLifeService,
  createWorldHostLifecycleService,
  WorldHostClock,
} from "@heptalogos/subject";
import { managementProblem } from "@heptalogos/management";
type Clock = Awaited<ReturnType<NousClient["clocks"]["readClock"]>>;
function snapshot(clock: Clock): WorldHostClock {
  if (!clock.now?.at || !clock.now.recordedAt)
    throw Error("world_clock_snapshot_unavailable");
  return {
    subjectId: clock.subjectId,
    timeDomainRef: clock.timeDomainRef,
    revision: String(clock.revision),
    rate: clock.rate,
    worldAt: new Date(
      Number(clock.now.at.seconds) * 1000 + clock.now.at.nanos / 1e6,
    ).toISOString(),
    recordedAt: new Date(
      Number(clock.now.recordedAt.seconds) * 1000 + clock.now.recordedAt.nanos / 1e6,
    ).toISOString(),
  };
}
/** A normal stopped Host owns only its exact pause revision; operator edits supersede it. */
export function createWorldHostRuntime(options: {
  life: ReturnType<typeof createLifeService>;
  worlds: ReturnType<typeof createWorldLifeService>;
  lifecycle: ReturnType<typeof createWorldHostLifecycleService>;
  currentSubject: () => Promise<string>;
  nous: () => Promise<Pick<NousClient, "clocks">>;
}) {
  const selected = async () => {
    const subjectId = await options.currentSubject();
    const entries = new Map<
      string,
      { worldId: string; activityId: string; domain: string; policy: string }
    >();
    let afterId: string | undefined;
    do {
      const page = await options.life.schedule({
        subjectId,
        states: ["active"],
        limit: 128,
        ...(afterId ? { afterId } : {}),
      });
      for (const activity of page.activities) {
        for (const source of activity.scope?.sourceRefs ?? []) {
          const worldId = /^world:([0-9a-f-]{36})$/i.exec(source)?.[1];
          if (!worldId || entries.has(worldId)) continue;
          const state = await options.worlds.read(subjectId, worldId);
          if (state)
            entries.set(worldId, {
              worldId,
              activityId: activity.activityId,
              domain: state.definition.timeDomainRef,
              policy: state.definition.offlinePolicy,
            });
        }
      }
      afterId = page.nextId ?? undefined;
    } while (afterId);
    return { subjectId, entries: [...entries.values()] };
  };
  const finishPause = async (
    receipt: NonNullable<Awaited<ReturnType<typeof options.lifecycle.read>>>,
  ) => {
    if (!receipt.before) throw Error("world_clock_pause_not_observed");
    const clocks = (await options.nous()).clocks;
    const paused = await clocks.pauseClock(
      {
        subjectId: receipt.subjectId,
        operationId: receipt.operationId,
        expectedRevision: BigInt(receipt.before.revision),
      },
      { timeoutMs: 5000 },
    );
    return options.lifecycle.confirmPause({
      subjectId: receipt.subjectId,
      operationId: receipt.operationId,
      clock: snapshot(paused),
    });
  };
  return {
    async start() {
      const { subjectId, entries } = await selected();
      let receipt = await options.lifecycle.read(subjectId);
      if (
        receipt?.before &&
        ["prepared", "unknown"].includes(receipt.status) &&
        !receipt.paused
      ) {
        try {
          receipt = await finishPause(receipt);
        } catch {
          await options.lifecycle.markUnknown({
            subjectId,
            operationId: receipt.operationId,
            detail:
              "The prior pause has no confirmed official CAS receipt; no world time is inferred",
          });
          return;
        }
      }
      if (
        receipt?.paused &&
        ["paused", "resuming", "unknown"].includes(receipt.status)
      ) {
        try {
          const clocks = (await options.nous()).clocks;
          if (receipt.status === "paused") {
            const current = await clocks.readClock({ subjectId }, { timeoutMs: 5000 });
            receipt = await options.lifecycle.prepareResume({
              subjectId,
              operationId: receipt.operationId,
              clock: snapshot(current),
            });
          } else {
            // Repeating the same official operation recovers its saved receipt without mutating a later operator clock.
            receipt = { ...receipt, status: "resuming" };
          }
          if (receipt.status === "resuming") {
            const resumed = await clocks.resumeClock(
              {
                subjectId,
                operationId: receipt.resumeOperationId,
                rate: receipt.before!.rate,
                expectedRevision: BigInt(receipt.paused!.revision),
              },
              { timeoutMs: 5000 },
            );
            receipt = await options.lifecycle.confirmResume({
              subjectId,
              operationId: receipt.operationId,
              clock: snapshot(resumed),
            });
          }
        } catch (error) {
          // Only a confirmed CAS rejection can classify a later clock as an operator edit.
          if (error instanceof NousError && error.codeName === "ABORTED") {
            try {
              const current = await (
                await options.nous()
              ).clocks.readClock({ subjectId }, { timeoutMs: 5000 });
              const checked = await options.lifecycle.prepareResume({
                subjectId,
                operationId: receipt.operationId,
                clock: snapshot(current),
              });
              if (checked.status === "superseded") return;
            } catch {
              /* An unavailable clock leaves the actual receipt unresolved. */
            }
          }
          await options.lifecycle.markUnknown({
            subjectId,
            operationId: receipt.operationId,
            detail:
              "Resume has no confirmed official CAS receipt; leave the actual clock unchanged on retry",
          });
          return;
        }
      }
      if (!entries.some((entry) => entry.policy === "pause_with_host")) return;
      const clocks = (await options.nous()).clocks;
      const clock = await clocks.readClock({ subjectId }, { timeoutMs: 5000 });
      const world = entries.find(
        (entry) =>
          entry.domain === clock.timeDomainRef && entry.policy === "pause_with_host",
      );
      if (world && clock.rate > 0)
        await options.lifecycle.recordRunning({
          subjectId,
          worldId: world.worldId,
          clock: snapshot(clock),
        });
    },
    async stop() {
      const { subjectId, entries } = await selected();
      if (!entries.some((entry) => entry.policy === "pause_with_host")) return;
      let clock: Clock;
      try {
        clock = await (
          await options.nous()
        ).clocks.readClock({ subjectId }, { timeoutMs: 5000 });
      } catch {
        await options.lifecycle.recordGap({
          subjectId,
          worldId: entries.find((entry) => entry.policy === "pause_with_host")!.worldId,
          detail:
            "Normal stop could not read the official clock; the shutdown point is unknown",
        });
        return;
      }
      const sameDomain = entries.filter(
        (entry) => entry.domain === clock.timeDomainRef,
      );
      const world = sameDomain.find((entry) => entry.policy === "pause_with_host");
      if (!world || clock.rate === 0) return;
      if (sameDomain.some((entry) => entry.policy !== world.policy))
        throw managementProblem(
          "world.lifecycle_conflict",
          "World clock policies disagree",
          "Adopt one offline policy for worlds sharing the same actual Subject clock domain",
          "conflict",
        );
      const receipt = await options.lifecycle.preparePause({
        subjectId,
        worldId: world.worldId,
        clock: snapshot(clock),
      });
      try {
        await finishPause(receipt);
      } catch {
        await options.lifecycle.markUnknown({
          subjectId,
          operationId: receipt.operationId,
          detail:
            "Normal stop could not confirm the actual official clock pause; shutdown world time is unknown",
        });
      }
    },
  };
}
