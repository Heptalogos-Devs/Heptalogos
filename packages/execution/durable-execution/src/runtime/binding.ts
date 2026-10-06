// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns the process-global DBOS workflow registration and the one active
 * WorkAttemptExecutor binding, resolving the active binding at invocation time.
 * @module binding
 */

import { createRequire } from "node:module";
import { ProblemError, type WorkItemId } from "@heptalogos/foundation-contracts";
import type {
  WorkAttemptExecutionStatus,
  WorkAttemptExecutor,
} from "@heptalogos/work-queue";
import { durableExecutionProblem } from "../problems.js";

/** Minimal engine projection returned by the static DBOS workflow. */
export interface EngineAttemptDisposition {
  readonly workItemId: WorkItemId;
  readonly dispatchRevision: number;
  readonly disposition: Exclude<WorkAttemptExecutionStatus, "NOT_FOUND"> | "STALE_NOOP";
}

/** Invokes one generation-pinned WorkItem attempt in the durable engine. */
export type RegisteredDispatchWorkflow = (
  workItemId: WorkItemId,
  dispatchRevision: number,
) => Promise<EngineAttemptDisposition>;

/** Supplies the process-global workflow registration mechanism to the adapter. */
export interface BindingDriver {
  /** Register the process-global static workflow with the durable engine. */
  registerWorkflow(
    maxRecoveryAttempts: number,
    execute: RegisteredDispatchWorkflow,
  ): RegisteredDispatchWorkflow;
}

interface ActiveBinding {
  readonly executor: WorkAttemptExecutor;
  readonly token: symbol;
  released: boolean;
}

interface ProcessRegistration {
  readonly maxRecoveryAttempts: number;
  readonly workflow: RegisteredDispatchWorkflow;
}

const defaultBindingDriver: BindingDriver = {
  registerWorkflow(maxRecoveryAttempts, execute) {
    return dbosSdk.registerWorkflow(
      async (workItemId: WorkItemId, dispatchRevision: number) =>
        dbosSdk.runStep(
          async () => {
            try {
              return await execute(workItemId, dispatchRevision);
            } catch (error) {
              if (error instanceof ProblemError) throw error;
              throw new Error("Durable WorkAttempt execution failed");
            }
          },
          { name: "executeWorkAttempt", retriesAllowed: false },
        ),
      { name: "dispatchWorkItem", maxRecoveryAttempts },
    );
  },
};

interface DbosSdkBindingSurface {
  registerWorkflow(
    workflow: (
      workItemId: WorkItemId,
      dispatchRevision: number,
    ) => Promise<EngineAttemptDisposition>,
    options: { readonly name: string; readonly maxRecoveryAttempts: number },
  ): RegisteredDispatchWorkflow;
  runStep<T>(
    callback: () => Promise<T>,
    options: { readonly name: string; readonly retriesAllowed: false },
  ): Promise<T>;
}

const dbosSdk = createRequire(import.meta.url)("@dbos-inc/dbos-sdk")
  .DBOS as DbosSdkBindingSurface;

let processRegistration: ProcessRegistration | undefined;
let activeBinding: ActiveBinding | undefined;
let activeInvocationCount = 0;

function dispositionFor(
  workItemId: WorkItemId,
  dispatchRevision: number,
  status: WorkAttemptExecutionStatus,
): EngineAttemptDisposition {
  return {
    workItemId,
    dispatchRevision,
    disposition: status === "NOT_FOUND" ? "STALE_NOOP" : status,
  };
}

async function executeAtInvocation(
  workItemId: WorkItemId,
  dispatchRevision: number,
): Promise<EngineAttemptDisposition> {
  const binding = activeBinding;
  if (binding === undefined || binding.released) {
    throw durableExecutionProblem(
      "durable.execution.binding.missing",
      "DBOS invoked dispatchWorkItem without an active WorkAttemptExecutor binding",
    );
  }
  activeInvocationCount += 1;
  try {
    const result = await binding.executor.execute(workItemId, dispatchRevision);
    return dispositionFor(workItemId, dispatchRevision, result.status);
  } finally {
    activeInvocationCount -= 1;
  }
}

/** Binds one active executor while retaining one static process registration. */
export function bindWorkAttemptExecutor(
  executor: WorkAttemptExecutor,
  maxRecoveryAttempts: number,
  driver: BindingDriver = defaultBindingDriver,
): {
  readonly workflow: RegisteredDispatchWorkflow;
  release(): void;
} {
  if (processRegistration === undefined) {
    processRegistration = {
      maxRecoveryAttempts,
      workflow: driver.registerWorkflow(maxRecoveryAttempts, executeAtInvocation),
    };
  } else if (processRegistration.maxRecoveryAttempts !== maxRecoveryAttempts) {
    throw durableExecutionProblem(
      "durable.execution.binding.recovery_budget_mismatch",
      "The process-global DBOS workflow registration already has a different recovery budget",
    );
  }
  if (activeBinding !== undefined && !activeBinding.released) {
    throw durableExecutionProblem(
      "durable.execution.binding.active",
      "A different DurableExecution runtime is already active in this process",
    );
  }

  const binding: ActiveBinding = {
    executor,
    token: Symbol("durable-execution-binding"),
    released: false,
  };
  activeBinding = binding;
  return {
    workflow: processRegistration.workflow,
    release() {
      if (binding.released) return;
      binding.released = true;
      if (activeBinding?.token === binding.token) activeBinding = undefined;
    },
  };
}

/** Returns the process-global static workflow without exposing DBOS objects. */
export function getRegisteredDispatchWorkflow(): RegisteredDispatchWorkflow {
  if (processRegistration === undefined) {
    throw durableExecutionProblem(
      "durable.execution.binding.missing",
      "DBOS dispatch was requested before the static workflow was registered",
    );
  }
  return processRegistration.workflow;
}

/** Returns active WorkAttempt calls so shutdown can prove a bounded drain. */
export function getActiveWorkAttemptInvocationCount(): number {
  return activeInvocationCount;
}

/** Tests only: clears package binding state after all test runtimes are closed. */
export function resetDbosBindingForTests(): void {
  if (activeBinding !== undefined && !activeBinding.released) {
    throw new Error("cannot reset an active DurableExecution binding");
  }
  processRegistration = undefined;
  activeBinding = undefined;
  activeInvocationCount = 0;
}
