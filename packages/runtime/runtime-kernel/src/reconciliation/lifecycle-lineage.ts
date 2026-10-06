// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Carries Runtime lifecycle activity lineage through activation and retirement
 * so supervisor events remain causally correlated with Foundation execution.
 * @module lifecycle-lineage
 */

import type {
  ActivityCompletion,
  ActivityRequest,
  ExecutionContext,
  ExecutionContextRuntime,
  ExecutionLineageService,
} from "@heptalogos/execution-lineage";
import {
  bindRuntimeExecutionOrigin,
  type RuntimeActivityRunner,
  type RuntimeExecutionOrigin,
} from "@heptalogos/execution-lineage/runtime-kernel";
import type { PersistenceService } from "@heptalogos/persistence";
import type { TimeService } from "@heptalogos/time-service";

/** Supplies execution, persistence, lineage, and time owners for Runtime lifecycle. */
export interface RuntimeLifecycleLineageOptions {
  readonly execution: ExecutionContextRuntime;
  readonly persistence: PersistenceService;
  readonly lineage: ExecutionLineageService;
  readonly time: TimeService;
}

/** Runs Runtime lifecycle operations with retained causal Activity records. */
export interface RuntimeLifecycleLineage {
  /** Binds a Runtime origin to the shared Activity runner. */
  runner(origin: RuntimeExecutionOrigin): RuntimeActivityRunner;
  /** Retains, executes, and completes one lifecycle Activity. */
  runRetained<T>(
    origin: RuntimeExecutionOrigin,
    request: ActivityRequest,
    operation: (context: ExecutionContext) => Promise<T>,
  ): Promise<T>;
}

function completion(
  time: TimeService,
  outcome: ActivityCompletion["outcome"],
): ActivityCompletion {
  return { endedAt: time.now(), outcome };
}

/** Creates the Runtime lifecycle lineage adapter over Foundation owners. */
export function createRuntimeLifecycleLineage(
  options: RuntimeLifecycleLineageOptions,
): RuntimeLifecycleLineage {
  const retain = async (context: ExecutionContext): Promise<void> => {
    await options.persistence.mutate((transaction) =>
      options.lineage.retainCurrent(transaction, context),
    );
  };

  const complete = async (
    context: ExecutionContext,
    outcome: ActivityCompletion["outcome"],
  ): Promise<void> => {
    await options.persistence.mutate((transaction) =>
      options.lineage.completeCurrent(
        transaction,
        context,
        completion(options.time, outcome),
      ),
    );
  };

  return {
    runner(origin) {
      return bindRuntimeExecutionOrigin(options.execution, origin);
    },

    async runRetained<T>(
      origin: RuntimeExecutionOrigin,
      request: ActivityRequest,
      operation: (context: ExecutionContext) => Promise<T>,
    ): Promise<T> {
      const runner = bindRuntimeExecutionOrigin(options.execution, origin);
      return runner.runActivity(request, async (context) => {
        await retain(context);
        let result: T;
        try {
          result = await operation(context);
        } catch (error) {
          try {
            await complete(context, "FAILED");
          } catch (completionError) {
            throw new AggregateError(
              [error, completionError],
              "Lifecycle operation and failure completion both failed",
            );
          }
          throw error;
        }

        await complete(context, "SUCCEEDED");
        return result;
      });
    },
  };
}
