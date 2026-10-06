// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Adapts Cordis Fiber activation and disposal into the narrow Substrate
 * contract, retaining only Heptalogos task admission and settlement policy.
 * @module cordis-adapter
 */

import { Context, type Fiber } from "cordis";
import { ProblemError } from "@heptalogos/foundation-contracts";
import { runtimeSubstrateProblem } from "./problems.js";
import type {
  ActivationResourceScope,
  RuntimeDisposer,
  RuntimeSubstrate,
  RuntimeSubstrateFailure,
  RuntimeSubstrateOptions,
  SubstrateActivationHandle,
  SubstrateActivationRequest,
} from "./contracts.js";

type InternalState = "ACTIVATING" | "ACTIVE" | "FAILED" | "DISPOSING" | "DISPOSED";

interface TrackedTask {
  readonly label: string;
  readonly task: Promise<unknown>;
  settled: boolean;
}

function validateOptions(options: RuntimeSubstrateOptions): void {
  if (!Number.isSafeInteger(options.settleTimeoutMs) || options.settleTimeoutMs < 0) {
    throw runtimeSubstrateProblem(
      "runtime.substrate.invalid_options",
      "settleTimeoutMs must be a non-negative safe integer",
    );
  }
}

function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        runtimeSubstrateProblem(
          "runtime.substrate.settlement_timeout",
          `Runtime substrate task did not settle within ${milliseconds}ms`,
        ),
      );
    }, milliseconds);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

class Activation implements SubstrateActivationHandle {
  private currentState: InternalState = "ACTIVATING";
  // Cordis Fiber is the lifecycle authority; this state is only the
  // RuntimeSubstrate contract projection.
  private fiber: Fiber | undefined;
  private readonly activationController = new AbortController();
  private readonly trackedTasks = new Set<TrackedTask>();
  private readonly lateDisposers = new Set<Promise<void>>();
  private disposalPromise: Promise<void> | undefined;
  private disposalCause: unknown;
  private disposedCallbackCalled = false;

  constructor(
    private readonly root: Context,
    private readonly request: SubstrateActivationRequest,
    private readonly options: RuntimeSubstrateOptions,
    private readonly onDisposed: (activation: Activation) => void,
  ) {}

  get state(): SubstrateActivationHandle["state"] {
    switch (this.currentState) {
      case "ACTIVE":
        return "ACTIVE";
      case "FAILED":
        return "FAILED";
      case "DISPOSING":
        return "DISPOSING";
      case "DISPOSED":
        return "DISPOSED";
      case "ACTIVATING":
        return "ACTIVE";
    }
  }

  async start(): Promise<SubstrateActivationHandle> {
    try {
      this.fiber = this.root.plugin({
        name: this.request.label,
        apply: (context: Context) => {
          this.fiber = context.fiber;
          if (this.currentState !== "ACTIVATING") {
            return;
          }
          return this.request.activate(this.createScope());
        },
      });

      await this.fiber.await();
      if (this.currentState !== "ACTIVATING") {
        throw runtimeSubstrateProblem(
          "runtime.substrate.activation_cancelled",
          `Activation '${this.request.label}' was cancelled before becoming active`,
        );
      }
      this.currentState = "ACTIVE";
      return this;
    } catch (error) {
      this.currentState = "FAILED";
      await this.dispose().catch(() => undefined);
      if (error instanceof ProblemError) throw error;
      throw runtimeSubstrateProblem(
        "runtime.substrate.activation_failed",
        `Activation '${this.request.label}' failed`,
        error,
      );
    }
  }

  dispose(): Promise<void> {
    if (this.disposalPromise !== undefined) return this.disposalPromise;
    this.disposalPromise = this.disposeOnce();
    return this.disposalPromise;
  }

  private async disposeOnce(): Promise<void> {
    if (this.currentState === "DISPOSED") return;
    this.currentState = "DISPOSING";
    this.activationController.abort();

    try {
      await this.fiber?.dispose();
    } catch (cause) {
      this.recordDisposalFailure(cause);
    }

    await this.drainLateDisposers();
    const pendingTasks = [...this.trackedTasks]
      .filter((tracked) => !tracked.settled)
      .map((tracked) => tracked.task);
    if (pendingTasks.length > 0) {
      try {
        await timeout(
          Promise.allSettled(pendingTasks).then(() => undefined),
          this.options.settleTimeoutMs,
        );
      } catch (cause) {
        const timeoutProblem = runtimeSubstrateProblem(
          "runtime.substrate.settlement_timeout",
          `Activation '${this.request.label}' has tracked work that did not settle`,
          cause,
        );
        this.notifyFailure({
          phase: "SETTLEMENT_TIMEOUT",
          label: this.request.label,
          cause: timeoutProblem,
        });
        this.disposalCause ??= timeoutProblem;
      }
    }
    await this.drainLateDisposers();

    this.currentState = "DISPOSED";
    if (!this.disposedCallbackCalled) {
      this.disposedCallbackCalled = true;
      this.onDisposed(this);
    }
    if (this.disposalCause !== undefined) throw this.disposalCause;
  }

  private createScope(): ActivationResourceScope {
    return {
      signal: this.activationController.signal,
      defer: (label, disposer) => this.defer(label, disposer),
      track: (label, task) => this.track(label, task),
    };
  }

  private defer(label: string, disposer: RuntimeDisposer): void {
    if (this.currentState === "DISPOSED") {
      throw runtimeSubstrateProblem(
        "runtime.substrate.scope_closed",
        `Activation '${this.request.label}' scope is already disposed`,
      );
    }
    if (this.currentState === "DISPOSING") {
      this.scheduleLateDisposer(label, disposer);
      return;
    }
    if (this.fiber === undefined) {
      throw runtimeSubstrateProblem(
        "runtime.substrate.scope_closed",
        `Activation '${this.request.label}' scope has no active Cordis Fiber`,
      );
    }
    try {
      this.registerDisposer(this.fiber, label, disposer);
    } catch (cause) {
      this.scheduleLateDisposer(label, disposer);
      if (cause instanceof ProblemError) throw cause;
    }
  }

  private registerDisposer(
    fiber: Fiber,
    label: string,
    disposer: RuntimeDisposer,
  ): void {
    fiber.effect(
      () => async () => {
        try {
          await disposer();
        } catch (cause) {
          this.recordDisposalFailure(cause, label);
          throw cause;
        }
      },
      label,
    );
  }

  private scheduleLateDisposer(label: string, disposer: RuntimeDisposer): void {
    const pending = this.runLateDisposer(label, disposer);
    this.lateDisposers.add(pending);
    void pending.finally(() => this.lateDisposers.delete(pending));
  }

  private async drainLateDisposers(): Promise<void> {
    while (this.lateDisposers.size > 0) {
      await Promise.all([...this.lateDisposers]);
    }
  }

  private async runLateDisposer(
    label: string,
    disposer: RuntimeDisposer,
  ): Promise<void> {
    try {
      await disposer();
    } catch (cause) {
      this.recordDisposalFailure(cause, label);
    }
  }

  private track(label: string, task: Promise<unknown>): void {
    if (this.currentState === "DISPOSING" || this.currentState === "DISPOSED") {
      throw runtimeSubstrateProblem(
        "runtime.substrate.scope_closed",
        `Activation '${this.request.label}' scope is already disposed`,
      );
    }
    const tracked: TrackedTask = {
      label,
      task: Promise.resolve(task),
      settled: false,
    };
    this.trackedTasks.add(tracked);
    void tracked.task.then(
      () => {
        tracked.settled = true;
        this.trackedTasks.delete(tracked);
      },
      (cause: unknown) => {
        tracked.settled = true;
        this.trackedTasks.delete(tracked);
        if (this.currentState === "ACTIVE" || this.currentState === "ACTIVATING") {
          this.currentState = "FAILED";
          this.notifyFailure({ phase: "BACKGROUND", label, cause });
        }
      },
    );
  }

  private recordDisposalFailure(cause: unknown, label = this.request.label): void {
    this.disposalCause ??= runtimeSubstrateProblem(
      "runtime.substrate.disposal_failed",
      `Activation '${this.request.label}' disposer '${label}' failed`,
      cause,
    );
    this.notifyFailure({ phase: "DISPOSAL", label, cause });
  }

  private notifyFailure(failure: RuntimeSubstrateFailure): void {
    try {
      this.request.onFailure(Object.freeze(failure));
    } catch {
      // Failure reporting cannot be allowed to break substrate cleanup.
    }
  }
}

/** Creates the Cordis-backed RuntimeSubstrate adapter. */
export function createRuntimeSubstrate(
  options: RuntimeSubstrateOptions,
): RuntimeSubstrate {
  validateOptions(options);
  const root = new Context();
  const activations = new Set<Activation>();
  let closed = false;
  let closePromise: Promise<void> | undefined;

  const substrate: RuntimeSubstrate = {
    async activate(request) {
      if (closed) {
        throw runtimeSubstrateProblem(
          "runtime.substrate.closed",
          "Runtime substrate is already closed",
        );
      }
      const activation = new Activation(root, request, options, (disposed) =>
        activations.delete(disposed),
      );
      activations.add(activation);
      try {
        return await activation.start();
      } catch (error) {
        activations.delete(activation);
        throw error;
      }
    },
    close() {
      if (closePromise !== undefined) return closePromise;
      closed = true;
      closePromise = (async () => {
        let firstError: unknown;
        for (const activation of [...activations].reverse()) {
          try {
            await activation.dispose();
          } catch (error) {
            firstError ??= error;
          }
        }
        if (firstError !== undefined) throw firstError;
      })();
      return closePromise;
    },
  };
  return substrate;
}
