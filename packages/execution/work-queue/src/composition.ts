// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Composes the WorkQueue owner with its restricted repository and attempt executor.
 * @module composition
 */

import type {
  ExecutionContextRuntime,
  ExecutionLineageService,
} from "@heptalogos/execution-lineage";
import type { PersistenceService } from "@heptalogos/persistence";
import type { SignalPublisher, SignalService } from "@heptalogos/signal";
import type { TimeService } from "@heptalogos/time-service";
import {
  createWorkAttemptExecutor,
  type WorkAttemptExecutor,
} from "./attempt-executor.js";
import type { DurableDispatchPort } from "./contracts.js";
import type { WorkAdmissionPort } from "./admission.js";
import type {
  WorkHandlerResolver,
  WorkQueueService,
  WorkQueueServiceOptions,
} from "./service.js";
import { createWorkQueueService } from "./service.js";
import { createWorkQueueReconciler, type WorkQueueReconciler } from "./reconciler.js";
import { createWorkQueueRepository } from "./repository.js";
import type {
  WorkErrorClassifier,
  WorkQueueProfileCatalog,
  WorkQueueRuntimeOptions,
} from "./contracts.js";

/** Host-facing composition inputs; repository SQL remains inside WorkQueue. */
export interface WorkQueueRuntimeCompositionOptions {
  readonly persistence: PersistenceService;
  readonly handlerRegistry: WorkHandlerResolver;
  readonly execution: ExecutionContextRuntime;
  readonly lineage: ExecutionLineageService;
  readonly time: TimeService;
  readonly signalPublisher: SignalPublisher;
  readonly signal: SignalService;
  readonly admission: WorkAdmissionPort;
  readonly profiles: WorkQueueProfileCatalog;
  readonly runtimeOptions: WorkQueueRuntimeOptions;
  readonly classifier: WorkErrorClassifier;
  readonly onBackgroundError: (error: unknown) => void;
}

/** Exposes only the WorkQueue runtime pieces needed by ProductHost composition. */
export interface WorkQueueRuntimeComposition {
  readonly service: WorkQueueService;
  readonly executor: WorkAttemptExecutor;
  /** Creates the reconciler over the already composed durable dispatch port. */
  createReconciler(durableDispatch: DurableDispatchPort): WorkQueueReconciler;
}

/** Creates WorkQueue service, attempt executor, and reconciler without leaking its repository. */
export function createWorkQueueRuntimeComposition(
  options: WorkQueueRuntimeCompositionOptions,
): WorkQueueRuntimeComposition {
  const repository = createWorkQueueRepository(options.persistence);
  const serviceOptions: WorkQueueServiceOptions = {
    persistence: options.persistence,
    handlerRegistry: options.handlerRegistry,
    execution: options.execution,
    lineage: options.lineage,
    time: options.time,
    signalPublisher: options.signalPublisher,
    admission: options.admission,
    profiles: options.profiles,
    runtimeOptions: options.runtimeOptions,
    onBackgroundError: options.onBackgroundError,
  };
  const service = createWorkQueueService(serviceOptions);
  const executor = createWorkAttemptExecutor({
    repository,
    handlerRegistry: options.handlerRegistry,
    execution: options.execution,
    lineage: options.lineage,
    time: options.time,
    classifier: options.classifier,
    runtimeOptions: options.runtimeOptions,
  });
  return Object.freeze({
    service,
    executor,
    createReconciler(durableDispatch: DurableDispatchPort) {
      return createWorkQueueReconciler({
        repository,
        durableDispatch,
        handlerRegistry: options.handlerRegistry,
        admission: options.admission,
        signal: options.signal,
        execution: options.execution,
        time: options.time,
        runtimeOptions: options.runtimeOptions,
        onBackgroundError: options.onBackgroundError,
      });
    },
  });
}
