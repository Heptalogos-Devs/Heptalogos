// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import fastify from "fastify";
import { registerReactorHttp } from "../../src/reactor-http.js";
import {
  managementProblem,
  type ManagementAuthentication,
  type ProductManagement,
} from "@heptalogos/management";
import { createProductHttpApp, closeProductHttpApp } from "../../src/product-http.js";

describe("Product Management input boundary", () => {
  it("preserves null CAS and identity values and refuses coercion or hidden extra input", async () => {
    let received: unknown;
    const settings = {
      nous: { runRoot: "/nous/run", expectedInstanceId: null },
      subject: { id: null, enabled: false },
      subjectGateway: { origin: "http://127.0.0.1:1235" },
      maintenanceGateway: { origin: "http://127.0.0.1:1236" },
    };
    const app = await createProductHttpApp({
      identity: { installationId: "installation", bootId: "boot" },
      onAdministratorClaimed: async () => {},
      authentication: {
        async authenticate(token: string) {
          if (token !== "authorized")
            throw managementProblem(
              "management.session_invalid",
              "Invalid session",
              "Authenticate first",
            );
        },
      } as unknown as ManagementAuthentication,
      product: {
        async configure(value: unknown, revision: unknown) {
          received = { value, revision };
          return { revision: "new", settings: value };
        },
      } as unknown as ProductManagement,
    });
    try {
      const request = (payload: unknown, authorization = "Bearer authorized") =>
        app.inject({
          method: "PUT",
          url: "/v1/config",
          headers: { authorization },
          payload: payload as object,
        });
      const accepted = await request({ expectedRevision: null, settings });
      expect(accepted.statusCode).toBe(200);
      expect(received).toEqual({ value: settings, revision: null });
      expect(
        (
          await request({
            expectedRevision: null,
            settings: { ...settings, unknown: true },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await request({
            expectedRevision: null,
            settings: { ...settings, subject: { id: null, enabled: "false" } },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (await request({ expectedRevision: null, settings }, "Bearer invalid"))
          .statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});

it("bounds shutdown when an unauthenticated peer withholds its request body", async () => {
  const app = await createProductHttpApp({
    identity: { installationId: "installation", bootId: "boot" },
    onAdministratorClaimed: async () => {},
    authentication: {} as ManagementAuthentication,
    product: {} as ProductManagement,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  const socket = createConnection({ host: "127.0.0.1", port: address.port });
  socket.on("error", () => {});
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const requestStarted = new Promise<void>((resolve) =>
      app.server.once("request", () => resolve()),
    );
    socket.write(
      "POST /v1/session HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{",
    );
    await requestStarted;
    await Promise.race([
      closeProductHttpApp(app),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Management drain remained blocked")),
          10_000,
        );
      }),
    ]);
    expect(app.server.listening).toBe(false);
  } finally {
    clearTimeout(deadline);
    socket.destroy();
    await app.close();
  }
}, 15_000);

it("serializes a read-only empty Reactor history page with an explicit terminal cursor", async () => {
  const subjectId = randomUUID();
  let reads = 0;
  const app = fastify();
  registerReactorHttp(app, {
    authenticate: async () => {},
    currentSubject: async () => subjectId,
    settings: async () => {
      throw Error("History does not read configuration");
    },
    foreground: {
      current: async () => undefined,
      readReaction: async () => undefined,
      lastAction: async () => undefined,
      history: async () => {
        reads++;
        return { reactions: [], more: false, nextReactionId: null };
      },
    },
    attention: { explain: async () => undefined },
    runMutation: async (_kind, operation) => operation(),
    wake: async () => {},
    projection: () => ({ state: "not_requested" }),
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/gateway/v1/reactor/history",
      payload: { subjectId, limit: 3 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      reactions: [],
      more: false,
      nextReactionId: null,
    });
    expect(reads).toBe(1);
  } finally {
    await app.close();
  }
});
