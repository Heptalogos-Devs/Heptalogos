// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Projects Bootstrap handoff evidence into execution lineage without making
 * lineage the owner of Bootstrap authority or durable work scheduling.
 * @module bootstrap-handoff
 */

import {
  parseActivityId,
  parseBootId,
  parseContinuityEpochId,
  parseInstallationId,
  parseInstanceId,
  parseInstant,
  type ActivityId,
  type BootId,
  type ContinuityEpochId,
  type InstallationId,
  type InstanceId,
  type Instant,
} from "@heptalogos/foundation-contracts";
import type { BootstrapRetainedActivityDraft } from "./contracts.js";
import { invalidBootstrapHandoffProblem } from "./problems.js";

const BOOTSTRAP_HANDOFF_COMPLETED_STAGE = "bootstrap.host.forward_handoff_completed";
const DEFAULT_FAILURE_REF = "bootstrap.handoff.failed";
const INCOMPLETE_REF = "bootstrap.handoff.incomplete";

/**
 * Structural input for BootstrapJournal so normal lineage does not depend on
 * the bootstrap runtime package. BootstrapJournalCheckpointV1 is assignable.
 */
/** Structural Bootstrap journal input accepted by lineage projection. */
export interface BootstrapJournalCheckpointLike {
  readonly schemaVersion: 1;
  readonly bootId: BootId;
  readonly bootstrapActivityId: ActivityId;
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly stage: string;
  readonly at: string;
  readonly outcome: "STARTED" | "SUCCEEDED" | "FAILED";
  readonly problemCode?: string;
}

/** Supplies journal checkpoints and the canonical continuity epoch for projection. */
export interface BootstrapHandoffProjectionInput {
  readonly checkpoints: readonly BootstrapJournalCheckpointLike[];
  readonly continuityEpochId: ContinuityEpochId;
}

/** Classifies whether the projected Bootstrap handoff succeeded or is incomplete. */
export type BootstrapHandoffStatus = "SUCCEEDED" | "FAILED" | "INCOMPLETE";

/** Projects Bootstrap journal evidence into a retained Activity draft. */
export interface BootstrapHandoffProjection {
  readonly status: BootstrapHandoffStatus;
  /**
   * INCOMPLETE is deliberately represented as a bounded FAILED draft if a
   * caller elects to retain the historical fact. The explicit status keeps
   * it from being mistaken for a successful handoff.
   */
  readonly draft: BootstrapRetainedActivityDraft;
}

interface ValidatedCheckpoint extends BootstrapJournalCheckpointLike {
  readonly at: Instant;
}

function invalid(detail: string): never {
  throw invalidBootstrapHandoffProblem(detail);
}

function validateCheckpoint(
  checkpoint: BootstrapJournalCheckpointLike,
): ValidatedCheckpoint {
  if (checkpoint.schemaVersion !== 1 || checkpoint.stage.trim().length === 0) {
    return invalid("Bootstrap journal checkpoint schema or stage is invalid");
  }
  if (!parseActivityId(checkpoint.bootstrapActivityId)) {
    return invalid("Bootstrap ActivityId is invalid");
  }
  if (!parseBootId(checkpoint.bootId)) return invalid("Bootstrap BootId is invalid");
  if (!parseInstallationId(checkpoint.installationId)) {
    return invalid("Bootstrap InstallationId is invalid");
  }
  if (!parseInstanceId(checkpoint.instanceId)) {
    return invalid("Bootstrap InstanceId is invalid");
  }
  const at = parseInstant(checkpoint.at);
  if (at === undefined) return invalid("Bootstrap checkpoint Instant is invalid");
  if (
    checkpoint.problemCode !== undefined &&
    (checkpoint.problemCode.trim().length === 0 ||
      new TextEncoder().encode(checkpoint.problemCode).byteLength > 1024)
  ) {
    return invalid("Bootstrap checkpoint problemCode is outside the bounded limit");
  }
  return Object.freeze({ ...checkpoint, at });
}

function assertSameIdentity(checkpoints: readonly ValidatedCheckpoint[]): void {
  const first = checkpoints[0];
  if (first === undefined) return invalid("Bootstrap journal is empty");
  for (const checkpoint of checkpoints.slice(1)) {
    if (
      checkpoint.bootstrapActivityId !== first.bootstrapActivityId ||
      checkpoint.bootId !== first.bootId ||
      checkpoint.installationId !== first.installationId ||
      checkpoint.instanceId !== first.instanceId
    ) {
      return invalid(
        "Bootstrap journal checkpoints do not share one execution identity",
      );
    }
  }
}

function outcomeRefFor(
  status: BootstrapHandoffStatus,
  failed: ValidatedCheckpoint | undefined,
): string | undefined {
  if (status === "SUCCEEDED") return undefined;
  if (status === "INCOMPLETE") return INCOMPLETE_REF;
  return failed?.problemCode ?? DEFAULT_FAILURE_REF;
}

/** Projects validated Bootstrap checkpoints into one retained lineage draft. */
export function projectBootstrapHandoff(
  input: BootstrapHandoffProjectionInput,
): BootstrapHandoffProjection {
  const continuityEpochId = parseContinuityEpochId(input.continuityEpochId);
  if (continuityEpochId === undefined) {
    return invalid("Bootstrap continuity epoch is invalid");
  }
  const checkpoints = input.checkpoints.map(validateCheckpoint);
  assertSameIdentity(checkpoints);
  const first = checkpoints[0]!;
  const successfulHandoffs = checkpoints.filter(
    (checkpoint) =>
      checkpoint.stage === BOOTSTRAP_HANDOFF_COMPLETED_STAGE &&
      checkpoint.outcome === "SUCCEEDED",
  );
  const failed = checkpoints
    .filter((checkpoint) => checkpoint.outcome === "FAILED")
    .at(-1);
  const successfulHandoff = successfulHandoffs.at(-1);
  const status: BootstrapHandoffStatus =
    successfulHandoff !== undefined
      ? "SUCCEEDED"
      : failed !== undefined
        ? "FAILED"
        : "INCOMPLETE";
  const terminal = successfulHandoff ?? failed ?? checkpoints.at(-1)!;
  const outcomeRef = outcomeRefFor(status, failed);
  const draft: BootstrapRetainedActivityDraft = Object.freeze({
    activityId: first.bootstrapActivityId,
    startedAt: first.at,
    endedAt: terminal.at,
    installationId: first.installationId,
    instanceId: first.instanceId,
    bootId: first.bootId,
    continuityEpochId,
    outcome: status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
    ...(outcomeRef === undefined ? {} : { outcomeRef }),
  });
  return Object.freeze({ status, draft });
}
