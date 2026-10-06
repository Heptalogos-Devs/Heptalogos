// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Composes the Product-supervised Subject OpenClaw projection and Gateway
 * adapters behind the narrow Subject cognition runtime port.
 * @module subject-openclaw
 */

import type { RuntimeLocations } from "@heptalogos/bootstrap-runtime";
import type { AIRuntimeService } from "@heptalogos/ai-runtime";
import {
  type InstallationId,
  type ProductGenerationId,
  type SubjectId,
} from "@heptalogos/foundation-contracts";
import type { NetworkAccessService } from "@heptalogos/network-access";
import type { SecretService } from "@heptalogos/secret";
import type { ConfigurationService } from "@heptalogos/configuration";
import type {
  ConversationCognitionInput,
  SubjectBlocker,
  SubjectCognitionRuntime,
  SubjectCognitionRuntimeReadiness,
} from "@heptalogos/subject";
import {
  publishSubjectOpenClawDescriptor,
  removeSubjectOpenClawDescriptor,
  startSubjectOpenClawGateway,
  type SubjectOpenClawGateway,
} from "./subject-openclaw-gateway.js";
import {
  cognitionProblem,
  readSubjectOpenClawProjection,
  subjectOpenClawRuntimeFingerprint,
  subjectOpenClawRuntimePaths,
} from "./subject-openclaw-projection.js";
import { asRecord } from "./value-utils.js";

/** Product Host inputs required to supervise the Subject OpenClaw runtime. */
export interface SubjectOpenClawRuntimeOptions {
  readonly installationId: InstallationId;
  readonly productGeneration: ProductGenerationId;
  readonly locations: RuntimeLocations;
  readonly configuration: ConfigurationService;
  readonly aiRuntime: AIRuntimeService;
  readonly networkAccess: NetworkAccessService;
  readonly secret: SecretService;
}

/** Product Host-owned lifecycle handle for the Subject OpenClaw adapter. */
export interface SubjectOpenClawRuntimeHandle extends SubjectCognitionRuntime {
  /** Associates the runtime with its canonical Subject identity. */
  bindSubject(subjectId: SubjectId): void;
  /** Starts or reconciles the runtime for the current Subject projection. */
  start(): Promise<void>;
  /** Stops the runtime and releases all owned external resources. */
  stop(): Promise<void>;
}

/** Creates one isolated Product-supervised Subject OpenClaw runtime. */
export function createSubjectOpenClawRuntime(
  options: SubjectOpenClawRuntimeOptions,
): SubjectOpenClawRuntimeHandle {
  const paths = subjectOpenClawRuntimePaths(options.locations);
  let boundSubjectId: SubjectId | undefined;
  let lifecycle: "STOPPED" | "STARTING" | "READY" | "FAILED" | "STOPPING" = "STOPPED";
  let live: SubjectOpenClawGateway | undefined;
  let transitionTail: Promise<void> = Promise.resolve();
  let descriptorTail: Promise<void> = Promise.resolve();
  const pendingStarts = new Map<string, Promise<SubjectOpenClawGateway>>();
  let stopPromise: Promise<void> | undefined;
  let closed = false;

  const enqueueTransition = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = transitionTail.then(operation);
    transitionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const enqueueDescriptor = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = descriptorTail.then(operation);
    descriptorTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const removeDescriptor = async (): Promise<void> => {
    await enqueueDescriptor(() => removeSubjectOpenClawDescriptor(paths));
  };

  const publishDescriptor = async (current: SubjectOpenClawGateway): Promise<void> => {
    await enqueueDescriptor(async () => {
      if (closed || live !== current) return;
      await publishSubjectOpenClawDescriptor(paths, current, closed);
    });
  };

  const onUnexpectedExit = (runtimeGeneration: string): void => {
    if (live?.runtimeGeneration !== runtimeGeneration) return;
    live = undefined;
    lifecycle = "FAILED";
    void removeDescriptor().catch(() => undefined);
  };

  const onGatewayChanged = (): void => {
    const current = live;
    if (current !== undefined) void publishDescriptor(current).catch(() => undefined);
  };

  const startProcessNow = async (
    projection: Awaited<ReturnType<typeof readSubjectOpenClawProjection>>,
    fingerprint: string,
  ): Promise<SubjectOpenClawGateway> => {
    if (closed) {
      throw cognitionProblem(
        "subject.cognition_runtime_unavailable",
        "Subject OpenClaw runtime is closed",
        "The Product Host has already begun terminal shutdown",
        "conflict",
        "manual",
      );
    }
    if (
      live !== undefined &&
      live.fingerprint === fingerprint &&
      lifecycle === "READY"
    ) {
      return live;
    }
    if (live !== undefined) {
      const previous = live;
      live = undefined;
      lifecycle = "STOPPING";
      await previous.stop();
      await removeDescriptor();
    }
    lifecycle = "STARTING";
    let current: SubjectOpenClawGateway | undefined;
    try {
      current = await startSubjectOpenClawGateway({
        productGeneration: options.productGeneration,
        projectionOptions: options,
        paths,
        projection,
        fingerprint,
        onUnexpectedExit,
        onChanged: onGatewayChanged,
      });
      if (closed) {
        await current.stop();
        lifecycle = "STOPPED";
        throw cognitionProblem(
          "subject.cognition_runtime_unavailable",
          "Subject OpenClaw runtime is closed",
          "The Product Host began terminal shutdown before the new runtime became current",
          "conflict",
          "manual",
        );
      }
      live = current;
      lifecycle = "READY";
      await publishDescriptor(current);
      return current;
    } catch (error) {
      if (current !== undefined) {
        live = undefined;
        await current.stop().catch(() => undefined);
      }
      lifecycle = closed ? "STOPPED" : "FAILED";
      throw error;
    }
  };

  const startProcess = (
    projection: Awaited<ReturnType<typeof readSubjectOpenClawProjection>>,
  ): Promise<SubjectOpenClawGateway> => {
    const fingerprint = subjectOpenClawRuntimeFingerprint(
      projection,
      options.productGeneration,
    );
    if (closed) {
      return Promise.reject(
        cognitionProblem(
          "subject.cognition_runtime_unavailable",
          "Subject OpenClaw runtime is closed",
          "The Product Host has already begun terminal shutdown",
          "conflict",
          "manual",
        ),
      );
    }
    if (
      live !== undefined &&
      live.fingerprint === fingerprint &&
      lifecycle === "READY"
    ) {
      return Promise.resolve(live);
    }
    const existing = pendingStarts.get(fingerprint);
    if (existing !== undefined) return existing;
    const pending = enqueueTransition(() => startProcessNow(projection, fingerprint));
    pendingStarts.set(fingerprint, pending);
    const clearPending = (): void => {
      if (pendingStarts.get(fingerprint) === pending) pendingStarts.delete(fingerprint);
    };
    void pending.then(clearPending, clearPending);
    return pending;
  };

  const start = async (): Promise<void> => {
    if (closed) {
      throw cognitionProblem(
        "subject.cognition_runtime_unavailable",
        "Subject OpenClaw runtime is closed",
        "The Product Host has already begun terminal shutdown",
        "conflict",
        "manual",
      );
    }
    const projection = await readSubjectOpenClawProjection(
      options,
      boundSubjectId,
      false,
    );
    await startProcess(projection);
  };

  const runConversationReaction = async (input: ConversationCognitionInput) => {
    const projection = await readSubjectOpenClawProjection(
      options,
      input.subjectId,
      true,
    );
    const current = await startProcess(projection);
    return current.runConversationReaction(input);
  };

  const readiness = async (): Promise<SubjectCognitionRuntimeReadiness> => {
    const blockers: SubjectBlocker[] = [];
    if (boundSubjectId === undefined) {
      blockers.push({
        code: "subject.cognition_subject_unbound",
        detail:
          "The Product Host has not bound current Subject identity to the runtime",
      });
    } else {
      try {
        const projection = await readSubjectOpenClawProjection(
          options,
          boundSubjectId,
          true,
        );
        const fingerprint = subjectOpenClawRuntimeFingerprint(
          projection,
          options.productGeneration,
        );
        if (live === undefined || lifecycle !== "READY") {
          blockers.push({
            code: "subject.cognition_runtime_unavailable",
            detail: "The owned Subject OpenClaw Gateway is not protocol-ready",
          });
        } else if (live.fingerprint !== fingerprint) {
          blockers.push({
            code: "subject.cognition_runtime_stale",
            detail:
              "The owned Subject OpenClaw Gateway does not match the current effective configuration",
          });
        }
      } catch (error) {
        const problemValue = asRecord(asRecord(error)?.problem);
        blockers.push({
          code:
            typeof problemValue?.problemCode === "string"
              ? problemValue.problemCode
              : "subject.cognition_runtime_unavailable",
          detail:
            error instanceof Error
              ? error.message
              : "Subject cognition runtime is unavailable",
        });
      }
    }
    return Object.freeze({
      schemaVersion: 1,
      state: blockers.length === 0 ? "READY" : "BLOCKED",
      blockers: Object.freeze(blockers),
    });
  };

  const stop = (): Promise<void> => {
    if (stopPromise !== undefined) return stopPromise;
    closed = true;
    lifecycle = "STOPPING";
    stopPromise = enqueueTransition(async () => {
      const current = live;
      live = undefined;
      try {
        if (current !== undefined) await current.stop();
        await removeDescriptor();
        lifecycle = "STOPPED";
      } catch (error) {
        lifecycle = "FAILED";
        throw error;
      }
    });
    return stopPromise;
  };

  return Object.freeze({
    bindSubject(subjectId: SubjectId) {
      boundSubjectId = subjectId;
    },
    start,
    stop,
    runConversationReaction,
    readiness,
  });
}
