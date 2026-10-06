// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Provides the process-local execution-context carrier while keeping context
 * propagation separate from durable lineage storage and product scheduling.
 * @module execution-context-runtime
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  createActivityId,
  parseContributionId,
  parseBootId,
  parseContentDigest,
  parseContinuityEpochId,
  parseHostOwnershipToken,
  parseInstallationId,
  parseInstanceId,
  parseMicroSystemId,
  parseMicroSystemInstanceId,
  type ActivityId,
} from "@heptalogos/foundation-contracts";
import type { TimeService } from "@heptalogos/time-service";
import type {
  ActivityImportance,
  ActivityLink,
  ActivityRequest,
  ExecutionContext,
  ExecutionContextRuntime,
  HostExecutionOrigin,
  LineageContextRefV1,
  RuntimeExecutionOrigin,
} from "./contracts.js";
import { decodeLineageContextRef } from "./lineage-context-ref.js";
import {
  discontinuousContextRefProblem,
  invalidActivityProblem,
  invalidOriginProblem,
  requiredContextRefProblem,
} from "./problems.js";
import {
  activeTelemetryContext,
  projectTelemetryCorrelation,
  withTelemetryContext,
  type LineageTelemetryContext,
} from "./observability-adapter.js";

interface ExecutionStore {
  readonly execution: ExecutionContext;
  readonly otelContext: LineageTelemetryContext;
}

/** Internal Runtime Kernel runner contract bound to execution lineage. */
export interface InternalRuntimeActivityRunner {
  /** Returns the current process-local execution context. */
  current(): ExecutionContext | undefined;
  /** Runs a callback under a new Runtime Activity. */
  runActivity<T>(
    request: ActivityRequest,
    operation: (context: ExecutionContext) => Promise<T>,
  ): Promise<T>;
  /** Resumes a callback from a durable lineage reference. */
  runFromLineageContextRef<T>(
    ref: LineageContextRefV1,
    request: Omit<ActivityRequest, "causationActivityId">,
    operation: (context: ExecutionContext) => Promise<T>,
  ): Promise<T>;
}

const runtimeOriginBinders = new WeakMap<
  ExecutionContextRuntime,
  (origin: RuntimeExecutionOrigin) => InternalRuntimeActivityRunner
>();

function causationFromLineageContextRef(
  ref: LineageContextRefV1,
  trustedOrigin: HostExecutionOrigin,
): ActivityId {
  const decoded = decodeLineageContextRef(ref);
  if (
    decoded.sourceInstanceId !== trustedOrigin.instanceId ||
    decoded.sourceContinuityEpochId !== trustedOrigin.continuityEpochId
  ) {
    throw discontinuousContextRefProblem();
  }
  return decoded.sourceActivityId;
}

const importanceValues = new Set<ActivityImportance>([
  "diagnostic",
  "routine",
  "significant",
  "critical",
]);
const retentionValues = new Set(["ephemeral", "operational", "retained", "audit"]);
const sensitivityValues = new Set([
  "public",
  "operational",
  "sensitive",
  "pii",
  "secret",
]);

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertBoundedString(value: string, name: string, maximumBytes: number): void {
  if (value.trim().length === 0 || utf8Length(value) > maximumBytes) {
    throw invalidActivityProblem(
      `${name} must be non-empty and at most ${maximumBytes} UTF-8 bytes`,
    );
  }
}

function assertOptionalSemantic(value: string | undefined, name: string): void {
  if (value !== undefined) assertBoundedString(value, name, 256);
}

function assertActivityRequest(request: ActivityRequest): void {
  assertBoundedString(request.kind, "kind", 128);
  if (!importanceValues.has(request.importance)) {
    throw invalidActivityProblem("importance is not a supported ActivityImportance");
  }
  if (!retentionValues.has(request.retentionClass)) {
    throw invalidActivityProblem("retentionClass is not a supported RetentionClass");
  }
  if (!sensitivityValues.has(request.sensitivity)) {
    throw invalidActivityProblem("sensitivity is not a supported Sensitivity");
  }
  const semantic = request.semantic;
  if (semantic) {
    assertOptionalSemantic(semantic.operationId, "operationId");
    assertOptionalSemantic(semantic.featureId, "featureId");
    assertOptionalSemantic(semantic.serviceId, "serviceId");
    assertOptionalSemantic(semantic.capabilityId, "capabilityId");
    assertOptionalSemantic(semantic.providerId, "providerId");
    assertOptionalSemantic(semantic.contractVersion, "contractVersion");
  }
  for (const link of request.links ?? []) {
    if (
      !["linked-to", "supersedes", "resumes", "fan-out", "fan-in"].includes(link.kind)
    ) {
      throw invalidActivityProblem("links contain an unsupported link kind");
    }
  }
}

function freezeRuntimeOrigin(origin: RuntimeExecutionOrigin): RuntimeExecutionOrigin {
  const productGenerationId = parseContentDigest(
    "ProductGenerationId",
    origin.productGenerationId,
  );
  const packageGenerationId =
    origin.packageGenerationId === undefined
      ? undefined
      : parseContentDigest("PackageGenerationId", origin.packageGenerationId);
  const microSystemId =
    origin.microSystemId === undefined
      ? undefined
      : parseMicroSystemId(origin.microSystemId);
  const microSystemInstanceId =
    origin.microSystemInstanceId === undefined
      ? undefined
      : parseMicroSystemInstanceId(origin.microSystemInstanceId);
  const contributionId =
    origin.contributionId === undefined
      ? undefined
      : parseContributionId(origin.contributionId);
  if (
    productGenerationId === undefined ||
    (origin.packageGenerationId !== undefined && packageGenerationId === undefined) ||
    (origin.microSystemId !== undefined && microSystemId === undefined) ||
    (origin.microSystemInstanceId !== undefined &&
      microSystemInstanceId === undefined) ||
    (origin.contributionId !== undefined && contributionId === undefined) ||
    (contributionId !== undefined &&
      (packageGenerationId === undefined ||
        microSystemId === undefined ||
        microSystemInstanceId === undefined)) ||
    (microSystemId === undefined) !== (microSystemInstanceId === undefined)
  ) {
    throw invalidOriginProblem();
  }

  return Object.freeze({
    productGenerationId,
    ...(packageGenerationId ? { packageGenerationId } : {}),
    ...(microSystemId ? { microSystemId } : {}),
    ...(microSystemInstanceId ? { microSystemInstanceId } : {}),
    ...(contributionId ? { contributionId } : {}),
  });
}

function freezeOrigin(origin: HostExecutionOrigin): HostExecutionOrigin {
  if (
    !parseInstallationId(origin.installationId) ||
    !parseInstanceId(origin.instanceId) ||
    !parseBootId(origin.bootId) ||
    !parseContinuityEpochId(origin.continuityEpochId) ||
    !parseHostOwnershipToken(origin.hostOwnershipToken)
  ) {
    throw invalidOriginProblem();
  }
  const runtime =
    origin.runtime === undefined ? undefined : freezeRuntimeOrigin(origin.runtime);
  return Object.freeze({
    ...origin,
    ...(runtime ? { runtime } : {}),
  });
}

function freezeLinks(links: readonly ActivityLink[]): readonly ActivityLink[] {
  return Object.freeze(links.map((link) => Object.freeze({ ...link })));
}

function createExecutionContext(
  request: ActivityRequest,
  origin: HostExecutionOrigin,
  runtimeOrigin: RuntimeExecutionOrigin | undefined,
  time: TimeService,
  parentActivityId: ActivityId | undefined,
  causationActivityId: ActivityId | undefined,
  otel: LineageTelemetryContext,
): ExecutionContext {
  assertActivityRequest(request);
  const semantic = Object.freeze({ ...(request.semantic ?? {}) });
  const telemetry = projectTelemetryCorrelation(otel);
  const context: ExecutionContext = {
    activityId: createActivityId(),
    kind: request.kind,
    startedAt: time.now(),
    ...(parentActivityId ? { parentActivityId } : {}),
    ...(causationActivityId ? { causationActivityId } : {}),
    links: freezeLinks(request.links ?? []),
    origin:
      runtimeOrigin === undefined
        ? origin
        : Object.freeze({ ...origin, runtime: runtimeOrigin }),
    semantic,
    importance: request.importance,
    retentionClass: request.retentionClass,
    sensitivity: request.sensitivity,
    ...(telemetry ? { telemetry } : {}),
  };
  return Object.freeze(context);
}

/** Creates the AsyncLocalStorage-backed execution-context runtime. */
export function createExecutionContextRuntime(
  origin: HostExecutionOrigin,
  time: TimeService,
): ExecutionContextRuntime {
  const trustedOrigin = freezeOrigin(origin);
  const storage = new AsyncLocalStorage<ExecutionStore | undefined>();

  const runScope = async <T>(
    request: ActivityRequest,
    operation: (context: ExecutionContext) => Promise<T>,
    parentActivityId: ActivityId | undefined,
    causationActivityId: ActivityId | undefined,
    parentOtel: LineageTelemetryContext,
    runtimeOrigin: RuntimeExecutionOrigin | undefined,
  ): Promise<T> => {
    const execution = createExecutionContext(
      request,
      trustedOrigin,
      runtimeOrigin,
      time,
      parentActivityId,
      causationActivityId,
      parentOtel,
    );
    const store: ExecutionStore = { execution, otelContext: parentOtel };
    return withTelemetryContext(parentOtel, () =>
      storage.run(store, () => operation(execution)),
    );
  };

  const runActivity = async <T>(
    request: ActivityRequest,
    operation: (context: ExecutionContext) => Promise<T>,
    runtimeOrigin: RuntimeExecutionOrigin | undefined,
  ): Promise<T> => {
    const parent = storage.getStore();
    const parentOtel = parent?.otelContext ?? activeTelemetryContext();
    return runScope(
      request,
      operation,
      parent?.execution.activityId,
      request.causationActivityId,
      parentOtel,
      runtimeOrigin,
    );
  };

  const runFromLineageContextRef = async <T>(
    ref: LineageContextRefV1,
    request: Omit<ActivityRequest, "causationActivityId">,
    operation: (context: ExecutionContext) => Promise<T>,
    runtimeOrigin: RuntimeExecutionOrigin | undefined,
  ): Promise<T> => {
    const causationActivityId = causationFromLineageContextRef(ref, trustedOrigin);
    const parent = storage.getStore();
    const parentOtel = parent?.otelContext ?? activeTelemetryContext();
    return runScope(
      request,
      operation,
      undefined,
      causationActivityId,
      parentOtel,
      runtimeOrigin,
    );
  };

  const createActivityRunner = (
    runtimeOrigin: RuntimeExecutionOrigin | undefined,
  ): InternalRuntimeActivityRunner => ({
    current: () => storage.getStore()?.execution,
    runActivity<T>(
      request: ActivityRequest,
      operation: (context: ExecutionContext) => Promise<T>,
    ): Promise<T> {
      return runActivity(request, operation, runtimeOrigin);
    },
    runFromLineageContextRef<T>(
      ref: LineageContextRefV1,
      request: Omit<ActivityRequest, "causationActivityId">,
      operation: (context: ExecutionContext) => Promise<T>,
    ): Promise<T> {
      return runFromLineageContextRef(ref, request, operation, runtimeOrigin);
    },
  });

  const runtime: ExecutionContextRuntime = {
    ...createActivityRunner(undefined),
    capture<TArgs extends readonly unknown[], TResult>(
      callback: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult {
      const captured = storage.getStore();
      const capturedOtel = captured?.otelContext ?? activeTelemetryContext();
      return (...args: TArgs) =>
        withTelemetryContext(capturedOtel, () =>
          storage.run(captured, () => callback(...args)),
        );
    },
    createLineageContextRef() {
      const current = storage.getStore()?.execution;
      if (!current) throw requiredContextRefProblem();
      return Object.freeze({
        schemaVersion: 1 as const,
        sourceActivityId: current.activityId,
        sourceInstanceId: current.origin.instanceId,
        sourceContinuityEpochId: current.origin.continuityEpochId,
        ...(current.telemetry ? { telemetry: current.telemetry } : {}),
      });
    },
  };

  runtimeOriginBinders.set(runtime, (runtimeOrigin) => {
    return createActivityRunner(freezeRuntimeOrigin(runtimeOrigin));
  });

  return runtime;
}

/** Binds a Runtime origin without widening the public lineage contract. */
export function bindRuntimeOriginInternal(
  runtime: ExecutionContextRuntime,
  origin: RuntimeExecutionOrigin,
): InternalRuntimeActivityRunner {
  const binder = runtimeOriginBinders.get(runtime);
  if (binder === undefined) {
    throw invalidOriginProblem();
  }
  return binder(origin);
}
