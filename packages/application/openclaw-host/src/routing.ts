// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Consumes actual native account bindings and session routing without inventing session keys.
 * @module routing
 */
import {
  resolveAgentRoute,
  resolveAgentIdFromSessionKey,
} from "openclaw/plugin-sdk/routing";
import type { QqTarget } from "./policy.js";
/** Resolves the SDK's real agent/session identity and rejects fallback or shared-account routing. */
export function resolveQqNativeRoute(
  cfg: Parameters<typeof resolveAgentRoute>[0]["cfg"],
  accountId: string,
  target: QqTarget,
  nativeAgentId: string,
): ReturnType<typeof resolveAgentRoute> {
  if (
    cfg.session?.dmScope !== "per-account-channel-peer" ||
    (cfg.session.groupScope && cfg.session.groupScope !== "per-group")
  )
    throw Error("QQ requires explicit isolated native DM/group session configuration");
  const route = resolveAgentRoute({
    cfg,
    channel: "heptalogos-qq",
    accountId,
    peer: { kind: target.kind, id: target.id },
  });
  if (
    route.matchedBy !== "binding.account" ||
    route.agentId !== nativeAgentId ||
    resolveAgentIdFromSessionKey(route.sessionKey) !== nativeAgentId ||
    route.accountId !== accountId ||
    route.dmScope !== "per-account-channel-peer" ||
    route.groupScope !== "per-group"
  )
    throw Error(
      "QQ native route must match the Host-authorized explicit account binding",
    );
  return route;
}
