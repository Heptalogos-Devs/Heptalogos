// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createRuntimeSubstrate,
  type ActivationResourceScope,
  type RuntimeSubstrateFailure,
  type SubstrateActivationRequest,
} from "../../src/index.js";

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function request(
  label: string,
  activate: (scope: ActivationResourceScope) => Promise<void> | void,
  failures: RuntimeSubstrateFailure[],
): SubstrateActivationRequest {
  return {
    label,
    async activate(scope) {
      await activate(scope);
    },
    onFailure(failure: RuntimeSubstrateFailure) {
      failures.push(failure);
    },
  };
}

describe("RuntimeSubstrate", () => {
  it("cleans already-registered effects after partial activation failure", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    const order: string[] = [];

    await expect(
      substrate.activate(
        request(
          "partial-activation",
          (scope) => {
            scope.defer("first", () => {
              order.push("first");
            });
            scope.defer("second", () => {
              order.push("second");
            });
            throw new Error("partial activation");
          },
          failures,
        ),
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "runtime.substrate.activation_failed" },
    });
    expect(order).toEqual(["second", "first"]);
    await substrate.close();
  });

  it("makes repeated and concurrent disposal idempotent", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    let disposed = 0;
    const handle = await substrate.activate(
      request(
        "idempotent-disposal",
        (scope) => {
          scope.defer("resource", async () => {
            await Promise.resolve();
            disposed += 1;
          });
        },
        failures,
      ),
    );

    await Promise.all([handle.dispose(), handle.dispose(), handle.dispose()]);
    expect(disposed).toBe(1);
    expect(handle.state).toBe("DISPOSED");
    await substrate.close();
  });

  it("cancels an activation settling asynchronously without resurrecting its Fiber", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    const started = deferred<void>();
    let disposed = false;
    const activation = substrate.activate(
      request(
        "async-cancellation",
        (scope) => {
          scope.defer("resource", () => {
            disposed = true;
          });
          started.resolve();
          return new Promise<void>((resolve) => {
            scope.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
        failures,
      ),
    );

    await started.promise;
    await expect(substrate.close()).resolves.toBeUndefined();
    await expect(activation).rejects.toMatchObject({
      problem: { problemCode: "runtime.substrate.activation_cancelled" },
    });
    expect(disposed).toBe(true);
    expect(failures).toEqual([]);
  });

  it("reports disposer rejection instead of converting disposal to success", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    const handle = await substrate.activate(
      request(
        "disposer-rejection",
        (scope) => {
          scope.defer("bad-disposer", () => {
            throw new Error("dispose failed");
          });
        },
        failures,
      ),
    );

    await expect(handle.dispose()).rejects.toMatchObject({
      problem: { problemCode: "runtime.substrate.disposal_failed" },
    });
    expect(failures).toMatchObject([
      { phase: "DISPOSAL", label: "bad-disposer", cause: new Error("dispose failed") },
    ]);
    expect(handle.state).toBe("DISPOSED");
    await expect(substrate.close()).resolves.toBeUndefined();
  });

  it("reports a stable settlement timeout for never-settling tracked work", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 10 });
    const failures: RuntimeSubstrateFailure[] = [];
    const handle = await substrate.activate(
      request(
        "settlement-timeout",
        (scope) => {
          scope.track("never", new Promise<void>(() => undefined));
        },
        failures,
      ),
    );

    await expect(handle.dispose()).rejects.toMatchObject({
      problem: { problemCode: "runtime.substrate.settlement_timeout" },
    });
    expect(failures).toMatchObject([
      { phase: "SETTLEMENT_TIMEOUT", label: "settlement-timeout" },
    ]);
    expect(handle.state).toBe("DISPOSED");
  });

  it("drains a late disposer admitted while disposal is in progress", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    const disposalGate = deferred<void>();
    const lateDisposer = deferred<void>();
    let capturedScope!: ActivationResourceScope;
    const handle = await substrate.activate(
      request(
        "late-disposer",
        (scope) => {
          capturedScope = scope;
          scope.defer("blocking", () => disposalGate.promise);
        },
        failures,
      ),
    );

    const disposal = handle.dispose();
    capturedScope.defer("late", () => lateDisposer.promise);
    let completed = false;
    void disposal.then(() => {
      completed = true;
    });
    await flush();
    expect(completed).toBe(false);
    lateDisposer.resolve();
    disposalGate.resolve();

    await expect(disposal).resolves.toBeUndefined();
    expect(failures).toEqual([]);
    await substrate.close();
  });
});
