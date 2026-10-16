// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Owns one actual QQ account lifecycle across native registry/discovery registrations.
 * @module account-runtime
 */
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
/** A lifecycle identity can only release the exact account service it acquired. */
export interface QqAccountOwnership {
  readonly owner: symbol;
}
interface AccountState<T> extends QqAccountOwnership {
  adapter?: T;
}
/** Uses the public SDK's named cross-module slot; registry views never create another sender. */
export function createQqAccountRuntime<T>(
  installationAnchorRoot: string,
  accountId: string,
) {
  const slot = createPluginRuntimeStore<AccountState<T>>({
    key:
      "heptalogos.qq.account.v1:" + JSON.stringify([installationAnchorRoot, accountId]),
    errorMessage: "QQ native account has not started",
  });
  const owner = {
    /** Claims synchronously before any startup await, excluding a second physical account service. */
    acquire(): QqAccountOwnership {
      if (slot.tryGetRuntime())
        throw Error("QQ native account lifecycle is already owned");
      const state: AccountState<T> = { owner: Symbol("qq-account-lifecycle") };
      slot.setRuntime(state);
      return state;
    },
    /** Wraps exactly one native account lifecycle, releasing partial startup and completed drain ownership. */
    ownLifecycle<C>(
      operation: (context: C, ownership: QqAccountOwnership) => Promise<void>,
    ): (context: C) => Promise<void> {
      return async (context) => {
        const ownership = owner.acquire();
        try {
          await operation(context, ownership);
        } finally {
          owner.release(ownership);
        }
      };
    },
    /** Publishes only the adapter built by the actual acquired startAccount lifecycle. */
    activate(ownership: QqAccountOwnership, adapter: T): void {
      const state = slot.tryGetRuntime();
      if (!state || state !== ownership)
        throw Error("QQ native account lifecycle changed");
      state.adapter = adapter;
    },
    /** Discovery/request registries resolve the one running account instead of their own unstarted closure. */
    adapter(): T {
      const state = slot.tryGetRuntime();
      if (!state?.adapter) throw Error("QQ native account has not started");
      return state.adapter;
    },
    /** Stops new adapter use while the current lifecycle drains, without admitting another sender yet. */
    deactivate(ownership: QqAccountOwnership): void {
      const state = slot.tryGetRuntime();
      if (state === ownership) state.adapter = undefined;
    },
    /** Stale cleanup cannot clear another actual lifecycle's runtime. */
    release(ownership: QqAccountOwnership): void {
      if (slot.tryGetRuntime() === ownership) slot.clearRuntime();
    },
  };
  return owner;
}
