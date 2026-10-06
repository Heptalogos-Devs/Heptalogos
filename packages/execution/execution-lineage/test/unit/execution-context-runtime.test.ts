// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  ROOT_CONTEXT,
  context as otelContext,
  trace,
  type SpanContext,
} from "@opentelemetry/api";
import {
  createActivityId,
  createBootId,
  createContinuityEpochId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  type ActivityId,
} from "@heptalogos/foundation-contracts";
import { describe, expect, it } from "vitest";
import {
  createExecutionContextRuntime,
  type ActivityRequest,
  type HostExecutionOrigin,
} from "../../src/index.js";
import { projectTelemetryCorrelation } from "../../src/observability-adapter.js";

const origin: HostExecutionOrigin = {
  installationId: createInstallationId(),
  instanceId: createInstanceId(),
  bootId: createBootId(),
  continuityEpochId: createContinuityEpochId(),
  hostOwnershipToken: createHostOwnershipToken(),
};

const request: ActivityRequest = {
  kind: "test.root",
  importance: "routine",
  retentionClass: "retained",
  sensitivity: "operational",
};

function createRuntime() {
  return createExecutionContextRuntime(origin, {
    now: () => "2026-08-24T15:00:00.123Z" as never,
    monotonicNow: () => 0n as never,
    elapsedSince: () => 0n as never,
  });
}

describe("ExecutionContextRuntime", () => {
  it("isolates concurrent root Activities", async () => {
    const runtime = createRuntime();
    const [a, b] = await Promise.all([
      runtime.runActivity(request, async () => {
        await Promise.resolve();
        return runtime.current()!.activityId;
      }),
      runtime.runActivity(request, async () => {
        await Promise.resolve();
        return runtime.current()!.activityId;
      }),
    ]);

    expect(a).not.toBe(b);
    expect(runtime.current()).toBeUndefined();
  });

  it("makes a nested Activity a child without forging causation", async () => {
    const runtime = createRuntime();

    await runtime.runActivity(request, async (parent) => {
      await runtime.runActivity({ ...request, kind: "test.child" }, async (child) => {
        expect(child.parentActivityId).toBe(parent.activityId);
        expect(child.causationActivityId).toBeUndefined();
      });
    });
  });

  it("propagates through Promise and timer boundaries", async () => {
    const runtime = createRuntime();

    await runtime.runActivity(request, async (root) => {
      await Promise.resolve();
      expect(runtime.current()!.activityId).toBe(root.activityId);
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          expect(runtime.current()!.activityId).toBe(root.activityId);
          resolve();
        }, 0),
      );
    });
  });

  it("captured callbacks restore the captured context and do not leak afterward", async () => {
    const runtime = createRuntime();
    let captured!: () => ActivityId | undefined;

    await runtime.runActivity(request, async (root) => {
      captured = runtime.capture(() => runtime.current()?.activityId);
      expect(captured()).toBe(root.activityId);
    });

    expect(runtime.current()).toBeUndefined();
    expect(captured()).toBeDefined();
    expect(runtime.current()).toBeUndefined();
  });

  it("does not allow request data to override trusted Host origin", async () => {
    const runtime = createRuntime();
    const forged = {
      ...request,
      origin: {
        ...origin,
        bootId: createBootId(),
      },
    } as ActivityRequest;

    await runtime.runActivity(forged, async (context) => {
      expect(context.origin).toEqual(origin);
      expect(Object.isFrozen(context.origin)).toBe(true);
    });
  });

  it("creates a minimal durable causal ref without BootId or HostOwnershipToken", async () => {
    const runtime = createRuntime();

    await runtime.runActivity(request, async (context) => {
      const ref = runtime.createLineageContextRef();
      expect(ref.sourceActivityId).toBe(context.activityId);
      expect(ref.sourceInstanceId).toBe(origin.instanceId);
      expect(ref.sourceContinuityEpochId).toBe(origin.continuityEpochId);
      expect(ref).not.toHaveProperty("bootId");
      expect(ref).not.toHaveProperty("hostOwnershipToken");
    });
  });

  it("resumes with current Host origin and old Activity only as causation", async () => {
    const runtime = createRuntime();
    const sourceActivityId = createActivityId();
    const ref = {
      schemaVersion: 1,
      sourceActivityId,
      sourceInstanceId: origin.instanceId,
      sourceContinuityEpochId: origin.continuityEpochId,
    } as const;

    await runtime.runFromLineageContextRef(ref, request, async (context) => {
      expect(context.origin).toEqual(origin);
      expect(context.parentActivityId).toBeUndefined();
      expect(context.causationActivityId).toBe(sourceActivityId);
    });
  });

  it("rejects a ref from another Instance or ContinuityEpoch", async () => {
    const runtime = createRuntime();
    const mismatchedRef = {
      schemaVersion: 1 as const,
      sourceActivityId: createActivityId(),
      sourceInstanceId: createInstanceId(),
      sourceContinuityEpochId: origin.continuityEpochId,
    };

    await expect(
      runtime.runFromLineageContextRef(mismatchedRef, request, async () => undefined),
    ).rejects.toMatchObject({
      problem: { problemCode: "lineage.context_ref.discontinuity" },
    });
  });

  it("projects a valid OTel span context without making it Activity identity", () => {
    const spanContext: SpanContext = {
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "0123456789abcdef",
      traceFlags: 1,
      isRemote: false,
    };
    const explicit = trace.setSpanContext(ROOT_CONTEXT, spanContext);

    expect(projectTelemetryCorrelation(explicit)).toEqual({
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
    });
    expect(otelContext.active()).toBe(ROOT_CONTEXT);
  });

  it("runs normally with the default no-span OTel context", async () => {
    const runtime = createRuntime();

    await runtime.runActivity(request, async (context) => {
      expect(context.telemetry).toBeUndefined();
    });
  });
});
