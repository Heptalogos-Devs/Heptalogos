// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reconciles canonical WorkItem truth after commits, lost notifications, or
 * dispatch failures so Signal remains a hint and never a durable authority.
 * @module reconciler
 */

import type { ExecutionContextRuntime } from "@heptalogos/execution-lineage";
import {
  createSignalTopic,
  type SignalListener,
  type SignalService,
  type SignalSubscription,
} from "@heptalogos/signal";
import type { TimeService } from "@heptalogos/time-service";
import { createDispatchAttemptId } from "./attempt-identity.js";
import type {
  DurableDispatchPort,
  DurableDispatchRequest,
  WorkItem,
  WorkQueueRuntimeOptions,
} from "./contracts.js";
import {
  applyWorkDispatchAdmissionDecision,
  type WorkAdmissionPort,
} from "./admission.js";
import {
  type WorkHandlerResolver,
  validateWorkQueueRuntimeOptions,
} from "./service.js";
import type { WorkQueueRepository } from "./repository.js";
import { workQueueProblem } from "./problems.js";
import {
  readFairWorkItemPage,
  resetFairScanLane,
  type FairScanLane,
} from "./fair-scan.js";

const WORK_AVAILABLE_TOPIC = createSignalTopic("work.available");

/** Dependencies and bounded policy for the canonical WorkItem projection loop. */
export interface WorkQueueReconcilerOptions {
  readonly repository: WorkQueueRepository;
  readonly durableDispatch: DurableDispatchPort;
  readonly handlerRegistry: WorkHandlerResolver;
  readonly admission: WorkAdmissionPort;
  readonly signal: SignalService;
  readonly execution: ExecutionContextRuntime;
  readonly time: TimeService;
  readonly runtimeOptions: WorkQueueRuntimeOptions;
  readonly onBackgroundError: (error: unknown) => void;
}

/** Counts produced by one reconciliation pass over durable queue state. */
export interface ReconciliationScanResult {
  readonly scanned: number;
  readonly awakened: number;
  readonly dispatched: number;
  readonly dispatchFailures: number;
}

/** Starts, stops, and explicitly scans the signal-backed queue projection. */
export interface WorkQueueReconciler {
  /** Subscribe to wakeups and begin the initial canonical scan. */
  start(): Promise<void>;
  /** Cancel timers, close the signal subscription, and drain the current scan. */
  stop(): Promise<void>;
  /** Reconcile due, waiting, and pending work against durable repository truth. */
  scan(): Promise<ReconciliationScanResult>;
}

function report(
  sink: (error: unknown) => void,
  problemCode: string,
  detail: string,
): void {
  try {
    sink(workQueueProblem(problemCode, detail));
  } catch {
    // Background diagnostics cannot escape reconciliation.
  }
}

function dispatchRequest(item: WorkItem): DurableDispatchRequest {
  return {
    workItemId: item.workItemId,
    dispatchRevision: item.dispatchRevision,
    dispatchAttemptId: createDispatchAttemptId(item.workItemId, item.dispatchRevision),
    queueProfileId: item.queueProfileId,
    priority: item.priority,
    ...(item.partitionKey === undefined ? {} : { partitionKey: item.partitionKey }),
    ...(item.notBefore === undefined ? {} : { notBefore: item.notBefore }),
  };
}

/** Create a reconciler whose signal and anti-entropy paths share one scan gate. */
export function createWorkQueueReconciler(
  options: WorkQueueReconcilerOptions,
): WorkQueueReconciler {
  validateWorkQueueRuntimeOptions(options.runtimeOptions);
  if (typeof options.onBackgroundError !== "function") {
    throw workQueueProblem(
      "work.request.invalid",
      "WorkQueueReconciler requires a background error sink",
    );
  }
  if (
    options.admission === undefined ||
    typeof options.admission.beforeDispatch !== "function"
  ) {
    throw workQueueProblem(
      "work.admission.required",
      "WorkQueueReconciler requires an explicit dispatch WorkAdmissionPort",
    );
  }

  let started = false;
  let subscription: SignalSubscription | undefined;
  let antiEntropyTimer: ReturnType<typeof setTimeout> | undefined;
  let scanPromise: Promise<ReconciliationScanResult> | undefined;
  const projectionLane: FairScanLane = {};
  const waitingDependencyLane: FairScanLane = {};

  const reportScanFailure = (): void => {
    report(
      options.onBackgroundError,
      "work.reconciliation.failed",
      "WorkQueue reconciliation scan failed; the next signal or anti-entropy scan remains authoritative",
    );
  };

  const requestScan = (): Promise<void> =>
    scan().then(
      () => undefined,
      () => {
        reportScanFailure();
      },
    );

  const scheduleAntiEntropy = (): void => {
    if (!started) return;
    antiEntropyTimer = setTimeout(() => {
      antiEntropyTimer = undefined;
      void requestScan().finally(scheduleAntiEntropy);
    }, options.runtimeOptions.antiEntropyIntervalMs);
  };

  const listener: SignalListener = {
    onWakeup: requestScan,
    onRescanRequired: requestScan,
    onBackgroundError: () => {
      report(
        options.onBackgroundError,
        "work.signal.failed",
        "Signal listener reported a background failure; reconciliation remains authoritative",
      );
    },
  };

  const runScan = async (): Promise<ReconciliationScanResult> => {
    const now = options.time.now();
    const dueRetry = await options.repository.listDueRetry({
      now,
      limit: options.runtimeOptions.reconciliationBatchSize,
    });
    const awakened: WorkItem[] = [];
    let awakenedCount = 0;
    for (const item of dueRetry) {
      const result = await options.repository.wakeDueRetry({
        workItemId: item.workItemId,
        expectedDispatchRevision: item.dispatchRevision,
        now,
        updatedAt: now,
      });
      if (result.status === "APPLIED" && result.item?.state === "PENDING") {
        awakened.push(result.item);
        awakenedCount += 1;
      }
    }

    const waiting = await readFairWorkItemPage(
      waitingDependencyLane,
      () => options.repository.snapshotWaitingDependencyCeiling(),
      (input) => options.repository.listWaitingDependency(input),
      options.runtimeOptions.reconciliationBatchSize,
    );
    for (const item of waiting) {
      if (options.handlerRegistry.resolve(item.handler) === undefined) continue;
      const result = await options.repository.wakeDependency({
        workItemId: item.workItemId,
        expectedDispatchRevision: item.dispatchRevision,
        updatedAt: now,
      });
      if (result.status === "APPLIED" && result.item?.state === "PENDING") {
        awakened.push(result.item);
        awakenedCount += 1;
      }
    }

    const pending = await readFairWorkItemPage(
      projectionLane,
      () => options.repository.snapshotProjectionCeiling(),
      (input) => options.repository.listProjectionCandidates(input),
      options.runtimeOptions.reconciliationBatchSize,
    );
    const candidates = new Map<string, WorkItem>();
    for (const item of [...awakened, ...pending]) {
      if (item.state !== "PENDING") continue;
      candidates.set(`${item.workItemId}\u0000${item.dispatchRevision}`, item);
    }

    let dispatched = 0;
    let dispatchFailures = 0;
    for (const item of candidates.values()) {
      const request = dispatchRequest(item);
      try {
        let admitted = false;
        await options.execution.runActivity(
          {
            kind: "work.dispatch",
            importance: "routine",
            retentionClass: "ephemeral",
            sensitivity: "operational",
          },
          async (activity) => {
            const decision = await options.admission.beforeDispatch({
              execution: activity,
              workItem: item,
              dispatch: request,
              now,
            });
            if (!applyWorkDispatchAdmissionDecision(decision)) return;
            await options.durableDispatch.dispatch(request);
            admitted = true;
          },
        );
        if (admitted) dispatched += 1;
      } catch {
        dispatchFailures += 1;
        report(
          options.onBackgroundError,
          "work.dispatch.failed",
          "Durable dispatch projection failed; the canonical WorkItem remains recoverable",
        );
      }
    }

    return {
      scanned: dueRetry.length + waiting.length + pending.length,
      awakened: awakenedCount,
      dispatched,
      dispatchFailures,
    };
  };

  const scan = (): Promise<ReconciliationScanResult> => {
    if (scanPromise !== undefined) return scanPromise;
    const current = options.execution
      .runActivity(
        {
          kind: "work.reconcile",
          importance: "routine",
          retentionClass: "ephemeral",
          sensitivity: "operational",
        },
        runScan,
      )
      .finally(() => {
        if (scanPromise === current) scanPromise = undefined;
      });
    scanPromise = current;
    return current;
  };

  return {
    scan,
    async start() {
      if (started) return;
      started = true;
      try {
        subscription = await options.signal.subscribe(WORK_AVAILABLE_TOPIC, listener);
        await scan();
        scheduleAntiEntropy();
      } catch (error) {
        started = false;
        if (antiEntropyTimer !== undefined) clearTimeout(antiEntropyTimer);
        antiEntropyTimer = undefined;
        await subscription?.close().catch(() => undefined);
        subscription = undefined;
        throw error;
      }
    },
    async stop() {
      started = false;
      if (antiEntropyTimer !== undefined) clearTimeout(antiEntropyTimer);
      antiEntropyTimer = undefined;
      const currentSubscription = subscription;
      subscription = undefined;
      await currentSubscription?.close();
      await scanPromise?.catch(() => undefined);
      resetFairScanLane(projectionLane);
      resetFairScanLane(waitingDependencyLane);
    },
  };
}
