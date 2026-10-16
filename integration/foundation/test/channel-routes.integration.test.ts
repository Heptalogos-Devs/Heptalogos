// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createChannelRouteStore } from "../../../packages/application/product-host/src/channel-routes.js";
import type { GatewayScope } from "../../../packages/application/product-host/src/gateway-contracts.js";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("actual native routing persistence", () => {
  it("retains actual provider facts across unrelated revisions and fences current account, agent, Subject and receive grants", async () => {
    const c = await composeProductPersistence();
    try {
      let scope: GatewayScope = {
        subjectId: randomUUID(),
        revision: randomUUID(),
        accountId: "3644596926",
        nativeAgentId: "qq",
        conversations: [
          {
            kind: "group",
            conversationId: "1101497265",
            receive: true,
            observe: true,
            effects: ["send"],
          },
        ],
        tools: [],
        sourceRefs: [],
        maxRunMs: 60000,
      };
      const store = createChannelRouteStore({
        persistence: c.persistence,
        scope: async () => scope,
        now: () => new Date().toISOString(),
      });
      const route = {
        accountId: scope.accountId,
        nativeAgentId: scope.nativeAgentId,
        conversation: { kind: "group" as const, id: "1101497265" },
        sessionKey: "agent:qq:heptalogos-qq:group:1101497265",
        mainSessionKey: "agent:qq:main",
        matchedBy: "binding.account" as const,
      };
      await c.run(() => store.register(route));
      expect(await store.read(route.conversation)).toEqual(route);
      scope = { ...scope, revision: randomUUID(), tools: ["browser"] };
      expect(await store.read(route.conversation)).toEqual(route);
      await expect(
        c.run(() => store.register({ ...route, accountId: "ungranted" })),
      ).rejects.toMatchObject({ problem: { problemCode: "gateway.scope_denied" } });
      await expect(
        c.run(() => store.register({ ...route, nativeAgentId: "maintenance" })),
      ).rejects.toMatchObject({ problem: { problemCode: "gateway.scope_denied" } });
      scope = {
        ...scope,
        conversations: scope.conversations.map((c) => ({
          ...c,
          receive: false,
          observe: false,
          effects: [],
        })),
      };
      await expect(store.read(route.conversation)).rejects.toMatchObject({
        problem: { problemCode: "gateway.scope_denied" },
      });
      scope = { ...scope, subjectId: randomUUID() };
      await expect(store.read(route.conversation)).rejects.toMatchObject({
        problem: { problemCode: "gateway.route_unavailable" },
      });
    } finally {
      await c.close();
    }
  }, 120000);
});
