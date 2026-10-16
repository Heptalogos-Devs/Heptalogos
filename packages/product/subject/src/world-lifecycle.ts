// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Retains the exact Host-owned clock pause obligation; external clock calls stay outside transactions.
 * @module world-lifecycle
 */
import type { PersistenceService } from "@heptalogos/persistence";
import {
  executeRepositorySql,
  readRepositorySql,
  useRepositoryMutationTransaction,
} from "@heptalogos/persistence/repository";
import { v5 as uuidv5 } from "uuid";
import { lockSubjectNarrative } from "./world-life.js";
import { subjectLineage } from "./subject-lineage.js";
import { subjectProblem } from "./problems.js";
/** Exact public clock values observed outside the Host transaction. */
export interface WorldHostClock {
  subjectId: string;
  timeDomainRef: string;
  revision: string;
  rate: number;
  worldAt: string;
  recordedAt: string;
}
/** A paused operator clock never creates an automatic resume obligation. */
export interface WorldHostLifecycleReceipt {
  subjectId: string;
  worldId: string;
  operationId: string;
  resumeOperationId: string;
  status:
    | "running"
    | "prepared"
    | "paused"
    | "resuming"
    | "resumed"
    | "unknown"
    | "superseded";
  before: WorldHostClock | null;
  paused: WorldHostClock | null;
  resumed: WorldHostClock | null;
  gap: string | null;
  updatedAt: string;
}
const ns = "66a85c84-3018-4376-b11a-63987f730f03";
function conflict(detail: string): never {
  throw subjectProblem(
    "world.lifecycle_conflict",
    "World Host lifecycle changed",
    detail,
    "conflict",
  );
}
function valid(clock: WorldHostClock) {
  if (
    !clock.timeDomainRef ||
    !/^\d+$/.test(clock.revision) ||
    !Number.isFinite(clock.rate) ||
    clock.rate < 0 ||
    !Number.isFinite(Date.parse(clock.worldAt)) ||
    !Number.isFinite(Date.parse(clock.recordedAt))
  )
    conflict("Use the actual finite official clock snapshot");
}
/** No process clock or guessed shutdown time substitutes for an actual NoUS receipt. */
export function createWorldHostLifecycleService(options: {
  persistence: PersistenceService;
  now: () => string;
}) {
  const read = async (subjectId: string) => {
    const rows = await readRepositorySql<{ document: WorldHostLifecycleReceipt }>(
      options.persistence,
      "SELECT document FROM heptalogos.world_host_lifecycle WHERE subject_id=$1",
      [subjectId],
    );
    return rows[0]?.document;
  };
  const change = async (
    subjectId: string,
    update: (
      current: WorldHostLifecycleReceipt | undefined,
    ) => WorldHostLifecycleReceipt,
  ) =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (tx) => {
        await lockSubjectNarrative(tx, subjectId);
        const rows = await executeRepositorySql<{
          document: WorldHostLifecycleReceipt;
        }>(
          tx,
          "SELECT document FROM heptalogos.world_host_lifecycle WHERE subject_id=$1 FOR UPDATE",
          [subjectId],
        );
        const document = update(rows[0]?.document);
        await executeRepositorySql(
          tx,
          `INSERT INTO heptalogos.world_host_lifecycle(subject_id,document,lineage_context_ref) VALUES($1,$2::jsonb,$3::jsonb)
         ON CONFLICT(subject_id) DO UPDATE SET document=EXCLUDED.document,lineage_context_ref=EXCLUDED.lineage_context_ref`,
          [
            subjectId,
            JSON.stringify(document),
            JSON.stringify(subjectLineage(context.execution)),
          ],
        );
        return document;
      }),
    );
  const same = (
    current: WorldHostLifecycleReceipt | undefined,
    operationId: string,
  ) => {
    if (!current || current.operationId !== operationId)
      conflict("Use the currently retained Host pause operation");
    return current;
  };
  return {
    read,
    async recordRunning(input: {
      subjectId: string;
      worldId: string;
      clock: WorldHostClock;
    }) {
      valid(input.clock);
      if (input.clock.subjectId !== input.subjectId)
        conflict("Use the actual Subject clock");
      return change(input.subjectId, (current) => {
        if (
          current &&
          current.before &&
          ["prepared", "paused", "resuming", "unknown"].includes(current.status)
        )
          conflict(
            "Resolve the previous Host obligation before recording normal running",
          );
        return {
          subjectId: input.subjectId,
          worldId: input.worldId,
          operationId: uuidv5(`${input.subjectId}:${input.clock.revision}:running`, ns),
          resumeOperationId: uuidv5(
            `${input.subjectId}:${input.clock.revision}:unused`,
            ns,
          ),
          status: "running",
          before: input.clock,
          paused: null,
          resumed: null,
          gap:
            current?.status === "running"
              ? `Host restarted without a confirmed stop after ${current.before?.recordedAt ?? "an unobserved clock"}; shutdown world time is unknown`
              : (current?.gap ?? null),
          updatedAt: options.now(),
        };
      });
    },
    async recordGap(input: { subjectId: string; worldId: string; detail: string }) {
      return change(input.subjectId, (current) =>
        current
          ? { ...current, gap: input.detail.slice(0, 2048), updatedAt: options.now() }
          : {
              subjectId: input.subjectId,
              worldId: input.worldId,
              operationId: uuidv5(`${input.subjectId}:${input.worldId}:unobserved`, ns),
              resumeOperationId: uuidv5(
                `${input.subjectId}:${input.worldId}:unused`,
                ns,
              ),
              status: "unknown",
              before: null,
              paused: null,
              resumed: null,
              gap: input.detail.slice(0, 2048),
              updatedAt: options.now(),
            },
      );
    },
    async preparePause(input: {
      subjectId: string;
      worldId: string;
      clock: WorldHostClock;
    }) {
      valid(input.clock);
      if (input.clock.subjectId !== input.subjectId || input.clock.rate <= 0)
        conflict("An already paused clock is owned by its operator");
      const operationId = uuidv5(
        `${input.subjectId}:${input.clock.timeDomainRef}:${input.clock.revision}:pause`,
        ns,
      );
      return change(input.subjectId, (current) => {
        if (current?.operationId === operationId) return current;
        if (
          current &&
          current.before &&
          ["prepared", "paused", "resuming", "unknown"].includes(current.status)
        )
          conflict("Resolve the previous actual Host clock operation first");
        return {
          subjectId: input.subjectId,
          worldId: input.worldId,
          operationId,
          resumeOperationId: uuidv5("resume", operationId),
          status: "prepared",
          before: input.clock,
          paused: null,
          resumed: null,
          gap: null,
          updatedAt: options.now(),
        };
      });
    },
    async confirmPause(input: {
      subjectId: string;
      operationId: string;
      clock: WorldHostClock;
    }) {
      valid(input.clock);
      return change(input.subjectId, (old) => {
        const current = same(old, input.operationId);
        if (
          current.paused &&
          JSON.stringify(current.paused) === JSON.stringify(input.clock)
        )
          return current;
        if (!current.before)
          conflict("A pause receipt needs its actual preceding clock snapshot");
        if (
          input.clock.subjectId !== current.subjectId ||
          input.clock.timeDomainRef !== current.before.timeDomainRef ||
          input.clock.rate !== 0 ||
          BigInt(input.clock.revision) !== BigInt(current.before.revision) + 1n
        )
          conflict("Pause confirmation must be the exact CAS mutation receipt");
        return {
          ...current,
          paused: input.clock,
          status: "paused",
          gap: null,
          updatedAt: options.now(),
        };
      });
    },
    async prepareResume(input: {
      subjectId: string;
      operationId: string;
      clock: WorldHostClock;
    }) {
      valid(input.clock);
      return change(input.subjectId, (old) => {
        const current = same(old, input.operationId);
        if (
          !current.paused ||
          !["paused", "resuming", "unknown"].includes(current.status)
        )
          conflict("Only an actual confirmed Host pause may resume automatically");
        const exact =
          input.clock.subjectId === current.subjectId &&
          input.clock.timeDomainRef === current.paused.timeDomainRef &&
          input.clock.revision === current.paused.revision &&
          input.clock.rate === 0;
        return {
          ...current,
          status: exact ? "resuming" : "superseded",
          gap: exact
            ? null
            : "The operator changed the official clock after this Host pause",
          updatedAt: options.now(),
        };
      });
    },
    async confirmResume(input: {
      subjectId: string;
      operationId: string;
      clock: WorldHostClock;
    }) {
      valid(input.clock);
      return change(input.subjectId, (old) => {
        const current = same(old, input.operationId);
        if (
          current.resumed &&
          JSON.stringify(current.resumed) === JSON.stringify(input.clock)
        )
          return current;
        if (
          !current.before ||
          !current.paused ||
          input.clock.subjectId !== current.subjectId ||
          input.clock.timeDomainRef !== current.paused.timeDomainRef ||
          input.clock.rate !== current.before.rate ||
          BigInt(input.clock.revision) !== BigInt(current.paused.revision) + 1n
        )
          conflict("Resume confirmation must be the exact CAS mutation receipt");
        return {
          ...current,
          resumed: input.clock,
          status: "resumed",
          gap: null,
          updatedAt: options.now(),
        };
      });
    },
    async markUnknown(input: {
      subjectId: string;
      operationId: string;
      detail: string;
    }) {
      return change(input.subjectId, (old) => ({
        ...same(old, input.operationId),
        status: "unknown",
        gap: input.detail.slice(0, 2048),
        updatedAt: options.now(),
      }));
    },
  };
}
