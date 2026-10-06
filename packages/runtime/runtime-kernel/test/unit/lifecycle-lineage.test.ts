// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createBootId,
  createContinuityEpochId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  digestCanonicalJson,
  asContentDigest,
  type Instant,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionContext,
  ExecutionLineageService,
} from "@heptalogos/execution-lineage";
import { createExecutionContextRuntime } from "@heptalogos/execution-lineage";
import type { RuntimeExecutionOrigin } from "@heptalogos/execution-lineage/runtime-kernel";
import { createFakeTimeService } from "@heptalogos/time-service";
import type {
  PersistenceMutationTransactionContext,
  PersistenceService,
} from "@heptalogos/persistence";
import { describe, expect, it } from "vitest";
import { createRuntimeLifecycleLineage } from "../../src/reconciliation/lifecycle-lineage.js";

const hostOrigin = {
  installationId: createInstallationId(),
  instanceId: createInstanceId(),
  bootId: createBootId(),
  continuityEpochId: createContinuityEpochId(),
  hostOwnershipToken: createHostOwnershipToken(),
};
const productGenerationId = asContentDigest(
  "ProductGenerationId",
  digestCanonicalJson("runtime-kernel/lifecycle-test/v1", { test: true }),
);
const runtimeOrigin: RuntimeExecutionOrigin = {
  productGenerationId,
};
const time = createFakeTimeService("2026-08-25T15:00:00.123Z" as Instant);

function createFixture(failCompletion?: "SUCCEEDED" | "FAILED") {
  const runtime = createExecutionContextRuntime(hostOrigin, time);
  const events: string[] = [];
  const persistence: PersistenceService = {
    state: "OPEN",
    async read() {
      throw new Error("read is not part of this fixture");
    },
    async mutate<T>(
      operation: (context: PersistenceMutationTransactionContext) => Promise<T>,
    ) {
      const context = runtime.current();
      if (context === undefined) throw new Error("missing current Activity");
      return operation({
        mode: "MUTATION",
        execution: {
          activityId: context.activityId,
          installationId: hostOrigin.installationId,
          instanceId: hostOrigin.instanceId,
          bootId: hostOrigin.bootId,
          continuityEpochId: hostOrigin.continuityEpochId,
          hostOwnershipToken: hostOrigin.hostOwnershipToken,
        },
      });
    },
    async close() {},
  };
  const lineage: ExecutionLineageService = {
    async retainCurrent(_transaction, context) {
      events.push(`retain:${context.kind}`);
    },
    async retainBootstrapReference() {},
    async completeCurrent(_transaction, context, completion) {
      events.push(`complete:${context.kind}:${completion.outcome}`);
      if (completion.outcome === failCompletion) {
        throw new Error(`completion persistence failed: ${completion.outcome}`);
      }
    },
  };
  return {
    runtime,
    events,
    recorder: createRuntimeLifecycleLineage({
      execution: runtime,
      persistence,
      lineage,
      time,
    }),
  };
}

describe("RuntimeLifecycleLineage", () => {
  it("retains start, runs work, and completes success under the bound runtime origin", async () => {
    const fixture = createFixture();
    let seen: ExecutionContext | undefined;

    await fixture.recorder.runRetained(
      runtimeOrigin,
      {
        kind: "runtime.lifecycle.activate",
        importance: "significant",
        retentionClass: "retained",
        sensitivity: "operational",
      },
      async (context) => {
        seen = context;
        fixture.events.push("work");
      },
    );

    expect(fixture.events).toEqual([
      "retain:runtime.lifecycle.activate",
      "work",
      "complete:runtime.lifecycle.activate:SUCCEEDED",
    ]);
    expect(seen?.origin.runtime).toEqual(runtimeOrigin);
  });

  it("completes failure and preserves the original lifecycle error", async () => {
    const fixture = createFixture();
    const failure = new Error("activation failed");

    await expect(
      fixture.recorder.runRetained(
        runtimeOrigin,
        {
          kind: "runtime.lifecycle.failure",
          importance: "critical",
          retentionClass: "retained",
          sensitivity: "operational",
        },
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);

    expect(fixture.events).toEqual([
      "retain:runtime.lifecycle.failure",
      "complete:runtime.lifecycle.failure:FAILED",
    ]);
  });

  it("does not record a failure completion after success completion persistence fails", async () => {
    const fixture = createFixture("SUCCEEDED");

    await expect(
      fixture.recorder.runRetained(
        runtimeOrigin,
        {
          kind: "runtime.lifecycle.activate",
          importance: "significant",
          retentionClass: "retained",
          sensitivity: "operational",
        },
        async () => "started",
      ),
    ).rejects.toThrow("completion persistence failed: SUCCEEDED");

    expect(fixture.events).toEqual([
      "retain:runtime.lifecycle.activate",
      "complete:runtime.lifecycle.activate:SUCCEEDED",
    ]);
  });
});
