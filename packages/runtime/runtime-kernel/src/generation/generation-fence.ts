// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns generation validity checks and retirement markers used to fence stale
 * services and capabilities during Runtime reconciliation and shutdown.
 * @module generation-fence
 */

import { runtimeKernelProblem } from "../problems.js";

/** States whether a Runtime generation can accept new invocations. */
export type GenerationFenceState = "ACTIVE" | "RETIRING" | "RETIRED";

/** Represents one invocation reservation held against generation retirement. */
export interface GenerationInvocationReservation {
  /** Runs the reserved operation exactly once and settles the reservation. */
  run<TResult>(call: () => TResult | Promise<TResult>): TResult | Promise<TResult>;
  /** Releases an unused reservation. */
  release(): void;
}

function validateOperationId(operationId: string): void {
  if (
    operationId.length === 0 ||
    new TextEncoder().encode(operationId).byteLength > 256
  ) {
    throw runtimeKernelProblem(
      "runtime.generation.invalid_operation_id",
      "Generation-fenced operationId must be non-empty and at most 256 UTF-8 bytes",
    );
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/** Owns invocation admission and bounded retirement for one Runtime generation. */
export class GenerationFence {
  private currentState: GenerationFenceState = "ACTIVE";
  private inFlight = 0;
  private resolveIdle: (() => void) | undefined;
  private retirementPromise: Promise<void> | undefined;

  /** Returns the current admission state of the generation. */
  get state(): GenerationFenceState {
    return this.currentState;
  }

  /** Returns the number of operations still holding the generation fence. */
  get activeInvocationCount(): number {
    return this.inFlight;
  }

  /** Throws when this generation no longer admits new work. */
  assertActive(): void {
    if (this.currentState !== "ACTIVE") {
      throw runtimeKernelProblem(
        "runtime.generation.retired",
        "Runtime generation no longer admits new invocations",
      );
    }
  }

  /** Reserves one operation while the generation is active. */
  reserve(operationId: string): GenerationInvocationReservation {
    validateOperationId(operationId);
    this.assertActive();
    this.inFlight += 1;
    let started = false;
    let released = false;
    let settled = false;

    const invalidReservation = (): never => {
      throw runtimeKernelProblem(
        "runtime.generation.invalid_reservation",
        "Generation invocation reservation has already been released or run",
      );
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      this.finishInvocation();
    };

    return Object.freeze({
      run: <TResult>(
        call: () => TResult | Promise<TResult>,
      ): TResult | Promise<TResult> => {
        if (started || released) invalidReservation();
        started = true;
        let result: TResult | Promise<TResult>;
        try {
          result = call();
        } catch (error) {
          finish();
          throw error;
        }
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(
            (value) => {
              finish();
              return value;
            },
            (error) => {
              finish();
              throw error;
            },
          );
        }
        finish();
        return result;
      },
      release: (): void => {
        if (released || settled || started) return;
        released = true;
        finish();
      },
    });
  }

  /** Runs one operation through a new generation reservation. */
  invoke<TResult>(
    operationId: string,
    call: () => TResult | Promise<TResult>,
  ): TResult | Promise<TResult> {
    return this.reserve(operationId).run(call);
  }

  private finishInvocation(): void {
    this.inFlight -= 1;
    if (this.inFlight === 0) this.resolveIdle?.();
  }

  /** Moves the generation into retiring state and stops new admission. */
  beginRetirement(): void {
    if (this.currentState === "ACTIVE") this.currentState = "RETIRING";
  }

  /** Retires the generation after in-flight invocations settle or timeout. */
  retire(settleTimeoutMs: number): Promise<void> {
    if (this.currentState === "RETIRED") return Promise.resolve();
    if (this.retirementPromise !== undefined) return this.retirementPromise;
    if (!Number.isSafeInteger(settleTimeoutMs) || settleTimeoutMs < 0) {
      return Promise.reject(
        runtimeKernelProblem(
          "runtime.generation.invalid_settle_timeout",
          "Generation settleTimeoutMs must be a non-negative safe integer",
        ),
      );
    }
    this.beginRetirement();
    this.retirementPromise = new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const complete = () => {
        if (this.currentState !== "RETIRING" || this.inFlight !== 0) return;
        if (timer !== undefined) clearTimeout(timer);
        this.currentState = "RETIRED";
        this.resolveIdle = undefined;
        resolve();
      };
      this.resolveIdle = complete;
      if (this.inFlight === 0) {
        complete();
        return;
      }
      timer = setTimeout(() => {
        // A timeout only reports that retirement is not yet proven. The
        // in-flight drain watcher remains installed so a late settlement can
        // still transition the fence to RETIRED.
        reject(
          runtimeKernelProblem(
            "runtime.generation.settlement_timeout",
            `Generation did not settle within ${settleTimeoutMs}ms`,
          ),
        );
      }, settleTimeoutMs);
    });
    return this.retirementPromise;
  }
}

/** Creates an active generation fence for a Runtime owner. */
export function createGenerationFence(): GenerationFence {
  return new GenerationFence();
}
