// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createWorkItemId,
  parseDurableCodeVersion,
} from "@heptalogos/foundation-contracts";
import { describe, expect, it } from "vitest";
import {
  bindWorkAttemptExecutor,
  resetDbosBindingForTests,
  type BindingDriver,
} from "../../src/runtime/binding.js";
import {
  createDbosStaticDispatcher,
  type DbosDispatchStartOptions,
  type DbosStartWorkflowDriver,
} from "../../src/dispatch/dispatcher.js";

const durableCodeVersion = parseDurableCodeVersion("a".repeat(64));
if (durableCodeVersion === undefined) {
  throw new Error("Test durable code version is invalid");
}

describe("static DBOS dispatcher", () => {
  it("starts one registered workflow with only WorkItemId and revision inputs", async () => {
    resetDbosBindingForTests();
    const workItemId = createWorkItemId();
    const dispatchRevision = 3;
    const registrations: Array<(...args: unknown[]) => unknown> = [];
    const bindingDriver: BindingDriver = {
      registerWorkflow(_maxRecoveryAttempts, execute) {
        registrations.push((...args: unknown[]) =>
          execute(...(args as [typeof workItemId, number])),
        );
        return (inputWorkItemId, inputRevision) =>
          execute(inputWorkItemId, inputRevision);
      },
    };
    const binding = bindWorkAttemptExecutor(
      {
        async execute(inputWorkItemId, inputRevision) {
          expect(inputWorkItemId).toBe(workItemId);
          expect(inputRevision).toBe(dispatchRevision);
          return { status: "SUCCEEDED" };
        },
      },
      4,
      bindingDriver,
    );
    const starts: Array<{
      readonly workflow: unknown;
      readonly options: DbosDispatchStartOptions;
    }> = [];
    const startDriver: DbosStartWorkflowDriver = {
      startWorkflow(workflow, options) {
        starts.push({ workflow, options });
        return async (inputWorkItemId, inputRevision) => {
          await (
            workflow as (id: typeof workItemId, revision: number) => Promise<unknown>
          )(inputWorkItemId, inputRevision);
        };
      },
    };

    try {
      await createDbosStaticDispatcher(startDriver).dispatch({
        workItemId,
        dispatchRevision,
        options: {
          workflowID: "heptalogos.work.test",
          queueName: "heptalogos.queue.default-work",
          enqueueOptions: {
            priority: 7,
            delaySeconds: 2,
            applicationVersion: durableCodeVersion,
          },
        },
      });
    } finally {
      binding.release();
      resetDbosBindingForTests();
    }

    expect(registrations).toHaveLength(1);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.options).toMatchObject({
      workflowID: "heptalogos.work.test",
      queueName: "heptalogos.queue.default-work",
      enqueueOptions: {
        priority: 7,
        delaySeconds: 2,
      },
    });
    expect(starts[0]?.options.enqueueOptions).not.toHaveProperty("deduplicationID");
  });
});
