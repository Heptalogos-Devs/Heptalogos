// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createBootId,
  createContinuityEpochId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import { describe, expect, it } from "vitest";
import { createExecutionContextRuntime } from "../../src/index.js";
import { createPersistenceExecutionContextProvider } from "../../src/persistence-adapter.js";

const origin = {
  installationId: createInstallationId(),
  instanceId: createInstanceId(),
  bootId: createBootId(),
  continuityEpochId: createContinuityEpochId(),
  hostOwnershipToken: createHostOwnershipToken(),
};

const time = {
  now: () => "2026-08-24T15:00:00.123Z" as never,
  monotonicNow: () => 0n as never,
  elapsedSince: () => 0n as never,
};

describe("persistence execution-context adapter", () => {
  it("maps only the current Activity and trusted Host origin", async () => {
    const runtime = createExecutionContextRuntime(origin, time);
    const provider = createPersistenceExecutionContextProvider(runtime);

    expect(provider.current()).toBeUndefined();
    await runtime.runActivity(
      {
        kind: "adapter.test",
        importance: "routine",
        retentionClass: "retained",
        sensitivity: "operational",
      },
      async (context) => {
        expect(provider.current()).toEqual({
          activityId: context.activityId,
          installationId: origin.installationId,
          instanceId: origin.instanceId,
          bootId: origin.bootId,
          continuityEpochId: origin.continuityEpochId,
          hostOwnershipToken: origin.hostOwnershipToken,
        });
        expect(provider.current()).not.toBe(context);
      },
    );
    expect(provider.current()).toBeUndefined();
  });
});
