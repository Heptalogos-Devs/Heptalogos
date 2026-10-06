// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createUuidV7Id,
  type ActivityId,
  type BootId,
  type ContinuityEpochId,
  type InstallationId,
  type InstanceId,
} from "@heptalogos/foundation-contracts";
import {
  projectBootstrapHandoff,
  type BootstrapJournalCheckpointLike,
} from "../../src/bootstrap-handoff.js";

const activityId = createUuidV7Id("ActivityId") as ActivityId;
const bootId = createUuidV7Id("BootId") as BootId;
const installationId = createUuidV7Id("InstallationId") as InstallationId;
const instanceId = createUuidV7Id("InstanceId") as InstanceId;
const continuityEpochId = createUuidV7Id("ContinuityEpochId") as ContinuityEpochId;

function checkpoint(
  at: string,
  stage: string,
  outcome: BootstrapJournalCheckpointLike["outcome"],
  problemCode?: string,
): BootstrapJournalCheckpointLike {
  return {
    schemaVersion: 1,
    bootId,
    bootstrapActivityId: activityId,
    installationId,
    instanceId,
    stage,
    at,
    outcome,
    ...(problemCode === undefined ? {} : { problemCode }),
  };
}

describe("projectBootstrapHandoff", () => {
  it("projects one successful bounded Bootstrap Activity summary", () => {
    const result = projectBootstrapHandoff({
      continuityEpochId,
      checkpoints: [
        checkpoint("2026-08-25T01:00:00.000Z", "bootstrap.prelude.started", "STARTED"),
        checkpoint(
          "2026-08-25T01:00:00.100Z",
          "bootstrap.host.forward_handoff_completed",
          "SUCCEEDED",
        ),
      ],
    });

    expect(result).toEqual({
      status: "SUCCEEDED",
      draft: {
        activityId,
        startedAt: "2026-08-25T01:00:00.000Z",
        endedAt: "2026-08-25T01:00:00.100Z",
        installationId,
        instanceId,
        bootId,
        continuityEpochId,
        outcome: "SUCCEEDED",
      },
    });
  });

  it("projects a failed journal as failure with a bounded problem reference", () => {
    const result = projectBootstrapHandoff({
      continuityEpochId,
      checkpoints: [
        checkpoint("2026-08-25T01:00:00.000Z", "bootstrap.prelude.started", "STARTED"),
        checkpoint(
          "2026-08-25T01:00:00.200Z",
          "bootstrap.host.canonical_initialization_failed",
          "FAILED",
          "canonical.schema.invalid",
        ),
      ],
    });

    expect(result.status).toBe("FAILED");
    expect(result.draft).toMatchObject({
      outcome: "FAILED",
      outcomeRef: "canonical.schema.invalid",
      endedAt: "2026-08-25T01:00:00.200Z",
    });
  });

  it("uses append order when wall time moves backwards", () => {
    const result = projectBootstrapHandoff({
      continuityEpochId,
      checkpoints: [
        checkpoint("2026-08-25T01:00:00.000Z", "bootstrap.prelude.started", "STARTED"),
        checkpoint(
          "2026-08-25T01:00:01.000Z",
          "bootstrap.host.token_published",
          "SUCCEEDED",
        ),
        checkpoint(
          "2026-08-25T00:59:58.000Z",
          "bootstrap.host.forward_handoff_completed",
          "SUCCEEDED",
        ),
      ],
    });

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      draft: {
        startedAt: "2026-08-25T01:00:00.000Z",
        endedAt: "2026-08-25T00:59:58.000Z",
      },
    });
  });

  it("selects the last appended failure even when its wall time is earlier", () => {
    const result = projectBootstrapHandoff({
      continuityEpochId,
      checkpoints: [
        checkpoint("2026-08-25T01:00:00.000Z", "bootstrap.prelude.started", "STARTED"),
        checkpoint(
          "2026-08-25T01:00:05.000Z",
          "bootstrap.host.canonical_initialization_failed",
          "FAILED",
          "canonical.schema.first_failure",
        ),
        checkpoint(
          "2026-08-25T00:59:59.000Z",
          "bootstrap.host.forward_handoff_failed",
          "FAILED",
          "canonical.schema.last_failure",
        ),
      ],
    });

    expect(result).toMatchObject({
      status: "FAILED",
      draft: {
        startedAt: "2026-08-25T01:00:00.000Z",
        endedAt: "2026-08-25T00:59:59.000Z",
        outcomeRef: "canonical.schema.last_failure",
      },
    });
  });

  it("marks incomplete input explicitly and never silently projects success", () => {
    const result = projectBootstrapHandoff({
      continuityEpochId,
      checkpoints: [
        checkpoint("2026-08-25T01:00:00.000Z", "bootstrap.prelude.started", "STARTED"),
        checkpoint(
          "2026-08-25T01:00:00.100Z",
          "bootstrap.host.token_published",
          "SUCCEEDED",
        ),
      ],
    });

    expect(result.status).toBe("INCOMPLETE");
    expect(result.draft).toMatchObject({
      outcome: "FAILED",
      outcomeRef: "bootstrap.handoff.incomplete",
    });
  });

  it("rejects mixed journal identities before creating a summary", () => {
    expect(() =>
      projectBootstrapHandoff({
        continuityEpochId,
        checkpoints: [
          checkpoint(
            "2026-08-25T01:00:00.000Z",
            "bootstrap.prelude.started",
            "STARTED",
          ),
          {
            ...checkpoint(
              "2026-08-25T01:00:00.100Z",
              "bootstrap.host.forward_handoff_completed",
              "SUCCEEDED",
            ),
            bootstrapActivityId: createUuidV7Id("ActivityId") as ActivityId,
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "lineage.bootstrap_handoff.invalid",
        }),
      }),
    );
  });
});
