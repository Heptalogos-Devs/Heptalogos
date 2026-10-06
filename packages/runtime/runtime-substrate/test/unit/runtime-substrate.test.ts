// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createRuntimeSubstrate,
  runtimeSubstrateProblem,
  type ActivationResourceScope,
  type RuntimeSubstrateFailure,
  type SubstrateActivationRequest,
} from "../../src/index.js";
import { ProblemError } from "@heptalogos/foundation-contracts";

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
  it("uses the canonical ProblemError contract for stable substrate failures", () => {
    const error = runtimeSubstrateProblem(
      "runtime.substrate.closed",
      "substrate closed",
    );
    expect(error).toBeInstanceOf(ProblemError);
    expect(error.constructor).toBe(ProblemError);
    expect(error.name).toBe("ProblemError");
    expect(error.problem).toMatchObject({
      schemaVersion: 1,
      problemCode: "runtime.substrate.closed",
      category: "conflict",
      retryClass: "manual",
    });
  });

  it("activates one Cordis-backed scope and disposes its resource", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    let disposed = 0;
    const handle = await substrate.activate(
      request(
        "single-activation",
        (scope) => {
          scope.defer("resource", () => {
            disposed += 1;
          });
        },
        failures,
      ),
    );

    expect(handle.state).toBe("ACTIVE");
    await handle.dispose();
    expect(handle.state).toBe("DISPOSED");
    expect(disposed).toBe(1);
    expect(failures).toEqual([]);
    await substrate.close();
  });

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

  it("isolates parent and sibling activation resources", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    let parentDisposed = false;
    let siblingDisposed = false;
    const parent = await substrate.activate(
      request(
        "parent",
        (scope) => {
          scope.defer("parent-resource", () => {
            parentDisposed = true;
          });
        },
        failures,
      ),
    );
    const sibling = await substrate.activate(
      request(
        "sibling",
        (scope) => {
          scope.defer("sibling-resource", () => {
            siblingDisposed = true;
          });
        },
        failures,
      ),
    );

    await sibling.dispose();
    expect(siblingDisposed).toBe(true);
    expect(parentDisposed).toBe(false);
    expect(parent.state).toBe("ACTIVE");
    await parent.dispose();
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

  it("surfaces tracked background rejection through onFailure", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    const background = deferred<void>();
    const handle = await substrate.activate(
      request(
        "background-rejection",
        (scope) => {
          scope.track("background", background.promise);
        },
        failures,
      ),
    );

    background.reject(new Error("background failed"));
    await flush();
    expect(handle.state).toBe("FAILED");
    expect(failures).toMatchObject([
      {
        phase: "BACKGROUND",
        label: "background",
        cause: new Error("background failed"),
      },
    ]);
    await handle.dispose();
    await substrate.close();
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

  it("aborts the scope before owned disposal starts", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    const order: string[] = [];
    const handle = await substrate.activate(
      request(
        "abort-before-disposal",
        (scope) => {
          scope.signal.addEventListener("abort", () => order.push("aborted"), {
            once: true,
          });
          scope.defer("resource", () => {
            order.push(
              scope.signal.aborted ? "disposed-after-abort" : "disposed-before-abort",
            );
          });
        },
        failures,
      ),
    );

    await handle.dispose();
    expect(order).toEqual(["aborted", "disposed-after-abort"]);
    await substrate.close();
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

  it("closes remaining handles in reverse activation order", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    const order: string[] = [];
    const first = await substrate.activate(
      request(
        "first",
        (scope) => {
          scope.defer("first-resource", () => {
            order.push("first");
          });
        },
        failures,
      ),
    );
    const second = await substrate.activate(
      request(
        "second",
        (scope) => {
          scope.defer("second-resource", () => {
            order.push("second");
          });
        },
        failures,
      ),
    );

    await substrate.close();
    expect(order).toEqual(["second", "first"]);
    expect(first.state).toBe("DISPOSED");
    expect(second.state).toBe("DISPOSED");
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

  it("reports a late disposer failure through dispose", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    const disposalGate = deferred<void>();
    const lateDisposer = deferred<void>();
    let capturedScope!: ActivationResourceScope;
    const handle = await substrate.activate(
      request(
        "late-disposer-failure",
        (scope) => {
          capturedScope = scope;
          scope.defer("blocking", () => disposalGate.promise);
        },
        failures,
      ),
    );

    const disposal = handle.dispose();
    capturedScope.defer("late", () => lateDisposer.promise);
    lateDisposer.reject(new Error("late disposer failed"));
    disposalGate.resolve();

    await expect(disposal).rejects.toMatchObject({
      problem: { problemCode: "runtime.substrate.disposal_failed" },
    });
    expect(failures).toMatchObject([
      { phase: "DISPOSAL", label: "late", cause: new Error("late disposer failed") },
    ]);
    await substrate.close().catch(() => undefined);
  });

  it("rejects new tracked work after disposal begins", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    let capturedScope!: ActivationResourceScope;
    const handle = await substrate.activate(
      request(
        "late-tracked-work",
        (scope) => {
          capturedScope = scope;
        },
        failures,
      ),
    );

    const disposal = handle.dispose();
    expect(() => capturedScope.track("late-task", Promise.resolve())).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "runtime.substrate.scope_closed",
        }),
      }),
    );
    await disposal;
    await substrate.close();
  });

  it("removes settled tracked work from the activation drain set", async () => {
    const substrate = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const failures: RuntimeSubstrateFailure[] = [];
    let capturedHandle!: object;
    const handle = await substrate.activate(
      request(
        "settled-tracked-work",
        (scope) => {
          for (let index = 0; index < 100; index += 1) {
            scope.track(`settled-${index}`, Promise.resolve());
          }
        },
        failures,
      ),
    );
    capturedHandle = handle as unknown as object;

    await flush();
    expect(
      (capturedHandle as { readonly trackedTasks: Set<unknown> }).trackedTasks.size,
    ).toBe(0);
    await handle.dispose();
    await substrate.close();
  });

  it("keeps the production adapter on the public Cordis package-root surface", async () => {
    const source = await readFile(
      new URL("../../src/cordis-adapter.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\.isolate\(/u);
    expect(source).not.toMatch(/\.waterfall\(/u);
    expect(source).not.toContain('from "cordis/src/');
    expect(source).not.toContain("@cordisjs/plugin-");
    expect(source).not.toContain("@deepseek-ai/cordis");
    expect(source).toContain('from "cordis"');
  });
});
