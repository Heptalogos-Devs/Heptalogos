// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { resolveQqNativeRoute } from "../../src/routing.js";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
it("uses actual SDK account bindings to isolate two accounts in the same native group and direct peer", () => {
  const cfg: Parameters<typeof resolveQqNativeRoute>[0] = {
    session: { dmScope: "per-account-channel-peer", groupScope: "per-group" },
    agents: { list: [{ id: "subject-a" }, { id: "subject-b" }] },
    bindings: [
      {
        agentId: "subject-a",
        match: { channel: "heptalogos-qq", accountId: "account-a" },
      },
      {
        agentId: "subject-b",
        match: { channel: "heptalogos-qq", accountId: "account-b" },
      },
    ],
  };
  for (const kind of ["group", "direct"] as const) {
    const a = resolveQqNativeRoute(
      cfg,
      "account-a",
      { kind, id: "same-peer" },
      "subject-a",
    );
    const b = resolveQqNativeRoute(
      cfg,
      "account-b",
      { kind, id: "same-peer" },
      "subject-b",
    );
    expect(a.matchedBy).toBe("binding.account");
    expect(b.matchedBy).toBe("binding.account");
    expect(a.sessionKey).not.toBe(b.sessionKey);
    expect(a.sessionKey).toMatch(/^agent:subject-a:/);
    expect(resolveAgentIdFromSessionKey(a.sessionKey)).toBe("subject-a");
    expect(a.lastRoutePolicy).toBe("session");
  }
  expect(() =>
    resolveQqNativeRoute(
      { ...cfg, bindings: [] },
      "account-a",
      { kind: "group", id: "same-peer" },
      "subject-a",
    ),
  ).toThrow(/explicit/);
  expect(() =>
    resolveQqNativeRoute(
      { ...cfg, agents: { list: [{ id: "subject-a" }] }, bindings: [] },
      "account-a",
      { kind: "group", id: "same-peer" },
      "subject-a",
    ),
  ).toThrow(/explicit account binding/);
  expect(() =>
    resolveQqNativeRoute(
      { ...cfg, session: { dmScope: "main" } },
      "account-a",
      { kind: "direct", id: "same-peer" },
      "subject-a",
    ),
  ).toThrow(/isolated/);
});
