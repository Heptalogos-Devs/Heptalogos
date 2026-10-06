// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Serializes mutations independently per logical key while preserving FIFO
 * ordering after rejection, preventing concurrent store writes from crossing.
 * @module keyed-serialization
 */

/** Serializes same-key operations while allowing independent keys to proceed. */
export class KeyedAsyncSerializer {
  private readonly tails = new Map<string, Promise<void>>();

  /** Runs an operation after the prior same-key tail, including after rejection. */
  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    const barrier = current.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, barrier);
    return current.finally(() => {
      if (this.tails.get(key) === barrier) this.tails.delete(key);
    });
  }
}
