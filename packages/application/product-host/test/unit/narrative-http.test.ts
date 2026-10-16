// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createProductHttpApp } from "../../src/product-http.js";
import { registerNarrativeHttp } from "../../src/narrative-http.js";
describe("read-only narrative operator HTTP", () => {
  it("queries the bound Subject only and exposes no caller-written review or commit route", async () => {
    const unavailable = async (): Promise<never> => {
      throw Error("not used");
    };
    const app = await createProductHttpApp({
      authentication: {
        authenticate: unavailable,
        claimFirstAdministrator: unavailable,
        login: unavailable,
        logout: unavailable,
      },
      product: {
        configuration: unavailable,
        status: unavailable,
        check: unavailable,
        configure: unavailable,
      },
      identity: { installationId: "fixture", bootId: "fixture" },
      onAdministratorClaimed: unavailable,
    });
    const subjectId = randomUUID();
    const claimsTo = vi.fn(async () => ({ claims: [], more: false })),
      explainStatement = vi.fn(async () => ({ claims: [] }));
    registerNarrativeHttp(app, {
      authenticate: async (token) => {
        if (token !== "service") throw Error("authentication denied");
      },
      currentSubject: async () => subjectId,
      runMutation: async (_kind, operation) => operation(),
      narrative: { claimsTo, explainStatement },
    });
    try {
      const headers = { authorization: "Bearer service" };
      const body = { subjectId, conversationRef: "conversation:actual", limit: 10 };
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/gateway/v1/narrative/claims",
            headers,
            payload: body,
          })
        ).json(),
      ).toEqual({ claims: [], more: false });
      expect(claimsTo).toHaveBeenCalledWith(body);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/gateway/v1/narrative/claims",
            headers,
            payload: { ...body, subjectId: randomUUID() },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/gateway/v1/narrative/claims",
            headers,
            payload: { ...body, review: { claims: [] } },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/gateway/v1/narrative/commit",
            headers,
            payload: body,
          })
        ).statusCode,
      ).toBe(404);
      expect(claimsTo).toHaveBeenCalledTimes(1);
      expect(explainStatement).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
