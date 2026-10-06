// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createWorkItemId, type WorkItemId } from "@heptalogos/foundation-contracts";
import { describe, expect, it, beforeEach } from "vitest";
import {
  bindWorkAttemptExecutor,
  resetDbosBindingForTests,
  type BindingDriver,
  type EngineAttemptDisposition,
} from "../../src/runtime/binding.js";
import type { WorkAttemptExecutor } from "@heptalogos/work-queue";

function executor(status: "SUCCEEDED" | "NOT_FOUND"): WorkAttemptExecutor {
  return {
    async execute() {
      return { status };
    },
  };
}

function driverFixture(): {
  readonly driver: BindingDriver;
  readonly registrations: Array<{
    readonly maxRecoveryAttempts: number;
    readonly execute: (
      workItemId: WorkItemId,
      dispatchRevision: number,
    ) => Promise<EngineAttemptDisposition>;
  }>;
} {
  const registrations: Array<{
    readonly maxRecoveryAttempts: number;
    readonly execute: (
      workItemId: WorkItemId,
      dispatchRevision: number,
    ) => Promise<EngineAttemptDisposition>;
  }> = [];
  const driver: BindingDriver = {
    registerWorkflow(maxRecoveryAttempts, execute) {
      registrations.push({ maxRecoveryAttempts, execute });
      return (workItemId, dispatchRevision) => execute(workItemId, dispatchRevision);
    },
  };
  return { driver, registrations };
}

describe("process-global DBOS binding", () => {
  beforeEach(() => {
    resetDbosBindingForTests();
  });

  it("registers one workflow and resolves the active executor at invocation time", async () => {
    const fixture = driverFixture();
    const first = bindWorkAttemptExecutor(executor("SUCCEEDED"), 4, fixture.driver);
    const workItemId = createWorkItemId();
    await expect(first.workflow(workItemId, 3)).resolves.toEqual({
      workItemId,
      dispatchRevision: 3,
      disposition: "SUCCEEDED",
    });

    first.release();
    await expect(first.workflow(workItemId, 3)).rejects.toMatchObject({
      problem: { problemCode: "durable.execution.binding.missing" },
    });

    const second = bindWorkAttemptExecutor(executor("NOT_FOUND"), 4, fixture.driver);
    expect(second.workflow).toBe(first.workflow);
    await expect(second.workflow(workItemId, 3)).resolves.toMatchObject({
      disposition: "STALE_NOOP",
    });
    expect(fixture.registrations).toHaveLength(1);
    second.release();
  });

  it("rejects simultaneous bindings and process-global recovery-budget changes", () => {
    const fixture = driverFixture();
    const first = bindWorkAttemptExecutor(executor("SUCCEEDED"), 4, fixture.driver);
    expect(() =>
      bindWorkAttemptExecutor(executor("SUCCEEDED"), 4, fixture.driver),
    ).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "durable.execution.binding.active",
        }),
      }),
    );
    first.release();
    expect(() =>
      bindWorkAttemptExecutor(executor("SUCCEEDED"), 5, fixture.driver),
    ).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "durable.execution.binding.recovery_budget_mismatch",
        }),
      }),
    );
    expect(fixture.registrations).toHaveLength(1);
  });
});
