// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProductManagement,
  ManagementAuthentication,
} from "@heptalogos/management";
import { createProductHttpApp } from "../../../packages/application/product-host/src/product-http.js";
import { createGatewayRuntime } from "../../../packages/application/product-host/src/gateway-runtime.js";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
vi.mock("../../../packages/application/product-host/src/nous.js", () => ({
  // Only the clock is supplied; any cognition/model operation fails this fixture.
  connectProductNous: async () => ({
    clocks: {
      readClock: async () => ({
        timeDomainRef: "time:real",
        now: { timeDomainRef: "time:real", at: sdk.timestampFromDate(new Date()) },
      }),
    },
  }),
}));
const metadataUrl = new URL(
  "../../../packages/application/product-host/node_modules/@nous-wave/client/package.json",
  import.meta.url,
);
const metadata = JSON.parse(await readFile(metadataUrl, "utf8")) as {
  exports: Record<string, { import: string }>;
};
const sdk = await import(
  new URL(metadata.exports["./host-bridge"]!.import, metadataUrl).href
);
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("Host-only native role admission", () => {
  it("adopts Life and prepares an authorized world planner without a QQ scope", async () => {
    const c = await composeProductPersistence(),
      root = await mkdtemp(join(tmpdir(), "host-only-role-"));
    try {
      const subjectId = randomUUID(),
        workContextId = randomUUID();
      let subjectEnabled = true;
      const product = {
        configuration: async () => ({
          revision: randomUUID(),
          settings: {
            subject: { id: subjectId, enabled: subjectEnabled },
            nous: { runRoot: join(root, "unused"), expectedInstanceId: null },
            roles: [
              {
                role: "world.planner",
                nativeAgentRef: "student-planner",
                enabled: true,
                outputContract: "structured_json",
                deadlineMs: 60000,
                inputTokens: 8192,
                outputTokens: 512,
                allowedTools: ["heptalogos_life"],
                fallbackAgentRefs: [],
              },
            ],
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
      const actor = (
        await c.run(() => gateway.identity.ensureSubjectEntity({ subjectId }))
      ).entityRef;
      const scope = {
        conversations: [],
        tools: ["heptalogos_life"],
        sourceRefs: [],
        maxRunMs: 60000,
      };
      let activity = await c.run(() =>
        gateway.life.propose({
          operationId: randomUUID(),
          subjectId,
          purpose: "Plan the student's school world",
          mode: "work",
          window: { notBefore: null, notAfter: null },
          proposedBy: actor,
          sourceRefs: [],
          workContextId,
          world: { timeDomainRef: "time:real", at: new Date().toISOString() },
          nextOpportunity: null,
          interruptOn: ["manual"],
        }),
      );
      activity = await c.run(() =>
        gateway.life.adopt({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          adoptedBy: actor,
          scope,
        }),
      );
      activity = await c.run(() =>
        gateway.life.transition({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          action: "start",
          reason: "Host-only planner dispatch",
        }),
      );
      const registration = {
        subjectId,
        activityId: activity.activityId,
        sessionKey: "student:planner",
        nativeAgentId: "student-planner",
        nativeRunId: randomUUID(),
        prompt: "Plan the explicitly adopted world task",
        role: "main" as const,
        tokenBudget: { inputTokens: 8192, outputTokens: 512 },
        allowedToolNames: ["heptalogos_life"],
        roleScope: {
          role: "world.planner" as const,
          purpose: "world_authoring" as const,
          view: "world_author" as const,
          contactNature: "execution_only" as const,
        },
        actorEntityRef: actor,
        workContextId,
        usage: sdk.decodeCognitionUsage({
          purpose: "world_authoring",
          role: "world.planner",
          view: "world_author",
          contactNature: "execution_only",
          sourceRead: { subjectId, sourceRefs: [] },
          intent: "Plan the adopted world",
          audience: { visibility: "internal" },
        }),
        sourceRefs: [],
        messageRefs: [],
        contacts: [],
      };
      const saved = await c.run(() => gateway.native.registerInput(registration));
      const response = await c.run(() =>
        gateway.native.prepare({
          version: 1,
          subjectId,
          nousSessionId: randomUUID(),
          contactRequestId: randomUUID(),
          invocationId: "planner:1",
          promptDigest: saved.promptDigest,
          native: {
            sessionKey: registration.sessionKey,
            sessionId: "student-session",
            runId: registration.nativeRunId,
            agentId: registration.nativeAgentId,
            historyGeneration: "history:1",
          },
        }),
      );
      expect(response.roleScope).toEqual(registration.roleScope);
      expect(response.contacts).toEqual([]);
      expect(response.allowedToolNames).toEqual(["heptalogos_life"]);
      expect(sdk.decodeCognitionUsage(response.usage).view).toBe("world_author");
      subjectEnabled = false;
      const app = await createProductHttpApp({
        product,
        authentication: {} as ManagementAuthentication,
        identity: { installationId: "fixture", bootId: "fixture" },
        onAdministratorClaimed: async () => {},
        gateway: gateway.http,
      });
      try {
        const token = (
          await readFile(join(root, "secret/channel-service-token"), "utf8")
        ).trim();
        const read = (id: string) =>
          app.inject({
            method: "POST",
            url: "/gateway/v1/life/read",
            headers: { authorization: "Bearer " + token },
            payload: { subjectId: id, activityId: activity.activityId },
          });
        const actual = await read(subjectId);
        expect(actual.statusCode).toBe(200);
        expect(actual.json().activity).toEqual(activity);
        expect(actual.json().activity.scope.conversations).toEqual([]);
        expect((await read(randomUUID())).statusCode).toBe(403);
      } finally {
        await app.close();
      }
      await expect(gateway.http.scope()).rejects.toThrow();
    } finally {
      await c.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120000);
});
