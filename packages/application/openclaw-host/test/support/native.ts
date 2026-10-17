// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ChannelIngressQueue } from "openclaw/plugin-sdk/channel-message";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-plugin-common";
const dist = dirname(
  dirname(fileURLToPath(import.meta.resolve("openclaw/plugin-sdk/channel-message"))),
);
// Test-only access to the pinned provider's real state/registry constructors,
// following the official Nous native-custody qualification fixture. Production
// plugin imports remain exclusively public SDK entrypoints.
export async function nativeQueue(
  stateDir: string,
): Promise<{ queue: ChannelIngressQueue<string>; close: () => boolean }> {
  const provider = (await import(
    pathToFileURL(join(dist, "ingress-queue-C7H3VLUf.js")).href
  )) as {
    t: (options: {
      channelId: string;
      accountId: string;
      stateDir: string;
    }) => ChannelIngressQueue<string>;
  };
  return {
    queue: provider.t({
      channelId: "heptalogos-qq",
      accountId: "3644596926",
      stateDir,
    }),
    close: await nativeStateCloser(stateDir),
  };
}
export async function nativeStateCloser(stateDir: string): Promise<() => boolean> {
  const state = (await import(
    pathToFileURL(join(dist, "openclaw-state-db-cache-AunrvrzG.js")).href
  )) as {
    _: (options: { env: NodeJS.ProcessEnv }) => string;
    r: (path: string) => boolean;
  };
  const databasePath = state._({
    env: { ...process.env, OPENCLAW_STATE_DIR: stateDir },
  });
  // The pinned native owner caches SQLite beyond monitor.stop(); release only this fixture's handle.
  return () => state.r(databasePath);
}
export async function nativeRegistry(plugin: ChannelPlugin) {
  const provider = (await import(
    pathToFileURL(join(dist, "registry-empty-55wlVNzO.js")).href
  )) as { t: () => { channels: Array<{ plugin: ChannelPlugin }> } };
  const registry = provider.t();
  registry.channels.push({ plugin });
  const scope = (await import(
    pathToFileURL(join(dist, "gateway-request-scope-CmMd3nUp.js")).href
  )) as { d: <T>(registry: unknown, run: () => Promise<T>) => Promise<T> };
  return { run: <T>(operation: () => Promise<T>) => scope.d(registry, operation) };
}
