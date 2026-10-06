// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Starts the one statically registered DBOS workflow with a minimal durable
 * dispatch envelope; queue policy and lifecycle admission live at the port.
 * @module dispatcher
 */

import { createRequire } from "node:module";
import type { DurableCodeVersion, WorkItemId } from "@heptalogos/foundation-contracts";
import { getRegisteredDispatchWorkflow } from "../runtime/binding.js";
import type { RegisteredDispatchWorkflow } from "../runtime/binding.js";

/** The exact enqueue options projected for one durable WorkItem attempt. */
interface DbosDispatchEnqueueOptions {
  readonly priority: number;
  readonly delaySeconds: number;
  readonly applicationVersion: DurableCodeVersion;
  readonly queuePartitionKey?: string;
}

/** The exact DBOS start-workflow parameter shape used by the adapter. */
export interface DbosDispatchStartOptions {
  readonly workflowID: string;
  readonly queueName: string;
  readonly enqueueOptions: DbosDispatchEnqueueOptions;
}

/** Minimal DBOS start-workflow seam kept behind the adapter boundary. */
export interface DbosStartWorkflowDriver {
  /** Bind the static workflow to a DBOS queue start function. */
  startWorkflow(
    workflow: RegisteredDispatchWorkflow,
    options: DbosDispatchStartOptions,
  ): (workItemId: WorkItemId, dispatchRevision: number) => Promise<unknown>;
}

/** Input passed to the static DBOS dispatcher. */
export interface DbosDispatchStartRequest {
  readonly workItemId: WorkItemId;
  readonly dispatchRevision: number;
  readonly options: DbosDispatchStartOptions;
}

/** Starts the statically registered workflow and discards the vendor handle. */
export interface DbosStaticDispatcher {
  /** Enqueue one canonical WorkItem attempt in DBOS. */
  dispatch(request: DbosDispatchStartRequest): Promise<void>;
}

interface DbosSdkDispatcherSurface {
  startWorkflow(
    workflow: RegisteredDispatchWorkflow,
    options: DbosDispatchStartOptions,
  ): (workItemId: WorkItemId, dispatchRevision: number) => Promise<unknown>;
}

const dbosSdk = createRequire(import.meta.url)("@dbos-inc/dbos-sdk")
  .DBOS as DbosSdkDispatcherSurface;

const defaultStartWorkflowDriver: DbosStartWorkflowDriver = {
  startWorkflow(workflow, options) {
    return dbosSdk.startWorkflow(workflow, options);
  },
};

/** Creates the DBOS adapter for the statically registered WorkItem workflow. */
export function createDbosStaticDispatcher(
  driver: DbosStartWorkflowDriver = defaultStartWorkflowDriver,
): DbosStaticDispatcher {
  return {
    async dispatch(request) {
      const invoke = driver.startWorkflow(
        getRegisteredDispatchWorkflow(),
        request.options,
      );
      await invoke(request.workItemId, request.dispatchRevision);
    },
  };
}
