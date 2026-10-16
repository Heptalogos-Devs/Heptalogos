// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createInstallationId, createBootId } from "@heptalogos/foundation-contracts";
import { createGatewayHostClient } from "@heptalogos/management-client/gateway";
import { createProductHttpApp } from "../../../packages/application/product-host/src/product-http.js";
import { createArchiveStore } from "../../../packages/application/product-host/src/archive-store.js";
import type { GatewayHttpOptions } from "../../../packages/application/product-host/src/gateway-http.js";
import {
  managementProblem,
  type ManagementAuthentication,
  type ProductManagement,
} from "../../../packages/system/management/src/index.js";
it("uses the generated service client for real bounded media and raw archives, and rejects unauthorized ingress before the owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-gateway-transport-"));
  const installationId = createInstallationId();
  const bootId = createBootId();
  let receive = true;
  let acceptCalls = 0;
  const gateway = {
    authenticate: async (token: string | undefined) => {
      if (token !== "channel-service-fixture")
        throw managementProblem(
          "gateway.service_invalid",
          "Invalid service credential",
          "Use the Channel service credential",
          "authentication",
        );
    },
    runMutation: async <T>(_kind: string, run: () => Promise<T>) => run(),
    scope: async () => ({
      subjectId: "subject-fixture",
      accountId: "bot-fixture",
      nativeAgentId: "subject-bot-fixture",
      tools: [],
      sourceRefs: [],
      maxRunMs: 60000,
      revision: receive ? "1" : "2",
      conversations: [
        {
          kind: "group" as const,
          conversationId: "observed-group",
          receive,
          observe: true,
          effects: [],
        },
      ],
    }),
    archive: createArchiveStore(root, 128 * 1024),
    messaging: {
      accept: async () => {
        acceptCalls++;
        return { results: [] };
      },
    },
  } as unknown as GatewayHttpOptions;
  const app = await createProductHttpApp({
    identity: { installationId, bootId },
    authentication: {} as ManagementAuthentication,
    product: {} as ProductManagement,
    onAdministratorClaimed: async () => {},
    gateway,
  });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw Error("No actual loopback listener");
    const origin = "http://127.0.0.1:" + address.port;
    await writeFile(
      join(root, "heptalogos.bootstrap.json"),
      JSON.stringify({ schemaVersion: 1, installationId, roots: { RUN: root } }),
    );
    await writeFile(
      join(root, "management-endpoint.json"),
      JSON.stringify({ schemaVersion: 1, installationId, bootId, origin }),
    );
    const client = createGatewayHostClient({
      hostAnchorRoot: root,
      serviceToken: "channel-service-fixture",
    });
    await expect(
      createGatewayHostClient({
        hostAnchorRoot: root,
        serviceToken: "administrator-session-fixture",
      }).gatewayScope(),
    ).rejects.toMatchObject({ status: 401 });
    expect((await client.gatewayScope()).conversations[0]!.effects).toEqual([]);
    const raw = {
      id: "90071992547409939999",
      parts: [{ type: "text", data: { text: "[CQ:image,file=literal]" } }],
    };
    const archived = await client.archiveEnvelope({ kind: "envelope", value: raw });
    expect((await client.readArchive(archived)).value).toEqual(raw);
    const large = await client.archiveEnvelope({
      kind: "envelope",
      value: { text: "x".repeat(70000) },
    });
    expect(
      ((await client.readArchive(large)).value as { text: string }).text.length,
    ).toBe(70000);

    const bytes = new Uint8Array([0, 1, 2, 255, 128, 10]);
    const upload = await client.uploadAttachment(
      new Blob([bytes]),
      "application/octet-stream",
    );
    expect(upload.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(upload.bytes).toBe(bytes.length);
    expect(new Uint8Array(await readFile(join(root, upload.sha256)))).toEqual(bytes);
    await expect(
      client.uploadAttachment(
        new Blob([new Uint8Array(128 * 1024 + 1)]),
        "application/octet-stream",
      ),
    ).rejects.toBeDefined();
    const fact = {
      kind: "event" as const,
      conversation: {
        platform: "qq",
        accountId: "bot-fixture",
        conversationId: "observed-group",
        kind: "group" as const,
      },
      eventKey: "native:notice",
      eventType: "notice",
      receivedAt: "2026-10-16T00:00:00.000Z",
      platformSentAt: null,
      sourceEnvelopeRef: archived.reference,
    };
    await client.acceptFacts({ facts: [fact] });
    expect(acceptCalls).toBe(1);
    receive = false;
    await expect(client.acceptFacts({ facts: [fact] })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      client.acceptFacts({
        facts: [
          { ...fact, conversation: { ...fact.conversation, accountId: "other-bot" } },
        ],
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(acceptCalls).toBe(1);
    const response = await fetch(origin + "/nous/v1/prepare", {
      method: "POST",
      headers: {
        Authorization: "Bearer channel-service-fixture",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ version: 1, unknown: true }),
    });
    expect(response.status).toBe(400);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
