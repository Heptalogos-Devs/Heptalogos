// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import type {
  ProductManagement,
  ManagementAuthentication,
} from "@heptalogos/management";
import { createGatewayRuntime } from "../../../packages/application/product-host/src/gateway-runtime.js";
import { createProductHttpApp } from "../../../packages/application/product-host/src/product-http.js";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("installed Pursuit composition uses real Product owners", () => {
  it("serves bound list/history authority without contacting an unavailable Nous instance", async () => {
    const c = await composeProductPersistence(),
      root = await mkdtemp(join(tmpdir(), "pursuit-composition-"));
    try {
      const subjectId = randomUUID();
      const product = {
        configuration: async () => ({
          revision: randomUUID(),
          settings: {
            subject: { id: subjectId, enabled: false },
            nous: { runRoot: join(root, "no-nous-instance"), expectedInstanceId: null },
            qq: {
              accountId: "100",
              nativeAgentId: "qq",
              conversations: [],
              tools: [],
              sourceRefs: [],
              maxRunMs: 60000,
            },
          },
        }),
      } as unknown as ProductManagement;
      const gateway = await createGatewayRuntime({
        persistence: c.persistence,
        product,
        secretRoot: join(root, "secret"),
        dataRoot: join(root, "data"),
        now: () => new Date().toISOString(),
        runMutation: (_kind, operation) => c.run(operation),
      });
      const app = await createProductHttpApp({
        product,
        authentication: {} as ManagementAuthentication,
        identity: { installationId: "fixture", bootId: "fixture" },
        onAdministratorClaimed: async () => {},
        gateway: gateway.http,
        pursuit: gateway.pursuitHttp,
      });
      try {
        const service = (
          await readFile(join(root, "secret/channel-service-token"), "utf8")
        ).trim();
        const request = (subject: string, token: string) =>
          app.inject({
            method: "POST",
            url: "/gateway/v1/pursuit/list",
            headers: { authorization: "Bearer " + token },
            payload: { subjectId: subject, states: [], limit: 10 },
          });
        expect((await request(subjectId, "ordinary-admin-session")).statusCode).toBe(
          401,
        );
        expect((await request(randomUUID(), service)).statusCode).toBe(403);
        const list = await request(subjectId, service);
        expect(list.statusCode).toBe(200);
        expect(list.json()).toEqual({ pursuits: [], nextId: null });
        expect(await gateway.pursuits.forActivity(subjectId, randomUUID())).toEqual([]);
      } finally {
        await app.close();
      }
    } finally {
      await c.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120000);
});
