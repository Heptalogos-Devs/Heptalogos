// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createActivityId,
  createBootId,
  createContinuityEpochId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import type {
  PersistenceMutationTransactionContext,
  PersistenceExecutionMetadata,
} from "@heptalogos/persistence";
import { describe, expect, it } from "vitest";
import { createExecutionLineageService } from "../../src/index.js";
import type {
  ActivityImportance,
  BootstrapRetainedActivityDraft,
  ExecutionContext,
} from "../../src/contracts.js";

function makeContext(
  retentionClass: ExecutionContext["retentionClass"] = "retained",
): ExecutionContext {
  return {
    activityId: createActivityId(),
    kind: "test.activity",
    startedAt: "2026-08-24T15:00:00.123Z" as never,
    links: [],
    origin: {
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      bootId: createBootId(),
      continuityEpochId: createContinuityEpochId(),
      hostOwnershipToken: createHostOwnershipToken(),
    },
    semantic: {},
    importance: "routine" as ActivityImportance,
    retentionClass,
    sensitivity: "operational",
  };
}

function metadataFor(context: ExecutionContext): PersistenceExecutionMetadata {
  return {
    activityId: context.activityId,
    installationId: context.origin.installationId,
    instanceId: context.origin.instanceId,
    bootId: context.origin.bootId,
    continuityEpochId: context.origin.continuityEpochId,
    hostOwnershipToken: context.origin.hostOwnershipToken,
  };
}

function mutationFor(context: ExecutionContext): PersistenceMutationTransactionContext {
  return { mode: "MUTATION", execution: metadataFor(context) };
}

describe("retained Activity repository", () => {
  it("rejects an Activity whose identity differs from the mutation transaction", async () => {
    const current = makeContext();
    const stale = { ...current, activityId: createActivityId() };
    const service = createExecutionLineageService();

    await expect(
      service.retainCurrent(mutationFor(current), stale),
    ).rejects.toMatchObject({
      problem: { problemCode: "lineage.persistence.current_activity_mismatch" },
    });
  });

  it("rejects ephemeral Activity retention", async () => {
    const context = makeContext("ephemeral");
    const service = createExecutionLineageService();

    await expect(
      service.retainCurrent(mutationFor(context), context),
    ).rejects.toMatchObject({
      problem: { problemCode: "lineage.persistence.retention_not_durable" },
    });
  });

  it("rejects completion for an Activity that is not current", async () => {
    const current = makeContext();
    const stale = { ...current, activityId: createActivityId() };
    const service = createExecutionLineageService();

    await expect(
      service.completeCurrent(mutationFor(current), stale, {
        endedAt: "2026-08-24T15:00:01.123Z" as never,
        outcome: "SUCCEEDED",
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "lineage.persistence.current_activity_mismatch" },
    });
  });

  it("rejects completion when the Host origin differs from the mutation", async () => {
    const current = makeContext();
    const stale = {
      ...current,
      origin: { ...current.origin, bootId: createBootId() },
    };
    const service = createExecutionLineageService();

    await expect(
      service.completeCurrent(mutationFor(current), stale, {
        endedAt: "2026-08-24T15:00:01.123Z" as never,
        outcome: "FAILED",
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "lineage.persistence.origin_mismatch" },
    });
  });

  it("rejects a Bootstrap summary from another current Instance or epoch", async () => {
    const current = makeContext();
    const draft: BootstrapRetainedActivityDraft = {
      activityId: createActivityId(),
      startedAt: "2026-08-24T15:00:00.123Z" as never,
      endedAt: "2026-08-24T15:00:01.123Z" as never,
      installationId: current.origin.installationId,
      instanceId: createInstanceId(),
      bootId: createBootId(),
      continuityEpochId: current.origin.continuityEpochId,
      outcome: "SUCCEEDED",
    };
    const service = createExecutionLineageService();

    await expect(
      service.retainBootstrapReference(mutationFor(current), draft),
    ).rejects.toMatchObject({
      problem: { problemCode: "lineage.bootstrap_reference.discontinuity" },
    });
  });
});
