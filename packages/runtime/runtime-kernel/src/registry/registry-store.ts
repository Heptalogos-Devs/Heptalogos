// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stores Runtime registry entries and their execution context projections while
 * preserving owner-scoped lifecycle cleanup for registered providers.
 * @module registry-store
 */

import type { ActivityRequest } from "@heptalogos/execution-lineage";
import type { RuntimeActivityRunner } from "@heptalogos/execution-lineage/runtime-kernel";
import type { ProviderId } from "@heptalogos/foundation-contracts";
import { GenerationFence } from "../generation/generation-fence.js";

/** Couples one published provider descriptor to its implementation and fence. */
export interface RegistryBinding<
  TDescriptor extends { readonly providerId: ProviderId },
> {
  readonly descriptor: TDescriptor;
  readonly implementation: object;
  readonly fence: GenerationFence;
  readonly runtimeActivity?: RuntimeActivityRunner;
}

/** Builds the stable owner/provider key shared by Runtime registries. */
export function registryBindingKey(ownerId: string, providerId: ProviderId): string {
  return `${ownerId}\u0000${providerId}`;
}

/** Stores runtime bindings by semantic key for registry owners. */
export class RegistryStore<T> {
  private readonly valuesByKey = new Map<string, T>();

  /** Returns the binding stored under a semantic key. */
  get(key: string): T | undefined {
    return this.valuesByKey.get(key);
  }

  /** Reports whether a semantic key is currently registered. */
  has(key: string): boolean {
    return this.valuesByKey.has(key);
  }

  /** Registers or replaces a binding under its semantic key. */
  set(key: string, value: T): void {
    this.valuesByKey.set(key, value);
  }

  /** Returns a stable snapshot of all registered bindings. */
  values(): readonly T[] {
    return [...this.valuesByKey.values()];
  }

  /** Returns bindings selected by the supplied semantic predicate. */
  filter(predicate: (value: T) => boolean): readonly T[] {
    return this.values().filter(predicate);
  }

  /** Removes bindings selected by the supplied predicate. */
  removeWhere(predicate: (value: T) => boolean): number {
    let removed = 0;
    for (const [key, value] of this.valuesByKey) {
      if (!predicate(value)) continue;
      this.valuesByKey.delete(key);
      removed += 1;
    }
    return removed;
  }

  /** Reports the number of currently registered bindings. */
  get size(): number {
    return this.valuesByKey.size;
  }
}

/** Lists provider identities matching a registry descriptor predicate. */
export function registryProviderIds<
  TDescriptor extends { readonly providerId: ProviderId },
>(
  store: RegistryStore<RegistryBinding<TDescriptor>>,
  matches: (descriptor: TDescriptor) => boolean,
): readonly ProviderId[] {
  return store
    .filter((binding) => matches(binding.descriptor))
    .map((binding) => binding.descriptor.providerId)
    .sort();
}

/** Removes and retires all bindings owned by one generation fence. */
export async function retireRegistryGeneration<
  T extends { readonly fence: GenerationFence },
>(
  store: RegistryStore<T>,
  fence: GenerationFence,
  settleTimeoutMs: number,
): Promise<void> {
  const removed = store.removeWhere((registration) => registration.fence === fence);
  if (removed === 0) return;
  await fence.retire(settleTimeoutMs);
}

/** Selects active bindings matching a registry predicate. */
export function activeRegistryBindings<
  T extends RegistryBinding<{ readonly providerId: ProviderId }>,
>(store: RegistryStore<T>, matches: (binding: T) => boolean): readonly T[] {
  return store.filter(
    (binding) => binding.fence.state === "ACTIVE" && matches(binding),
  );
}

/** Invokes a binding through its generation and optional Activity fences. */
export function invokeRegistryBinding<
  TDescriptor extends { readonly providerId: ProviderId },
  TResult,
>(
  binding: RegistryBinding<TDescriptor>,
  operationId: string,
  call: () => TResult | Promise<TResult>,
  activity: ActivityRequest,
): Promise<TResult> {
  const invoke = () => binding.fence.invoke(operationId, call);
  binding.fence.assertActive();
  if (binding.runtimeActivity === undefined) return Promise.resolve(invoke());
  return binding.runtimeActivity.runActivity(activity, async () => invoke());
}
