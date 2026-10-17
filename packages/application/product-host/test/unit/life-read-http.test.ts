// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { it, expect, vi } from "vitest";
import { createProductHttpApp } from "../../src/product-http.js";
import type { GatewayHttpOptions } from "../../src/gateway-http.js";
import {
  managementProblem,
  type ProductManagement,
  type ManagementAuthentication,
} from "@heptalogos/management";
it("reads exact Life identity only for the current bound Subject and service credential", async () => {
  const subjectId = randomUUID(),
    activityId = randomUUID(),
    get = vi.fn(async () => undefined),
    qqScope = vi.fn(async () => {
      throw Error("QQ is not configured");
    });
  const gateway = {
    authenticate: async (token: string | undefined) => {
      if (token !== "service-only")
        throw managementProblem(
          "gateway.service_invalid",
          "Service credential required",
          "Use the current installation credential",
          "authorization",
        );
    },
    currentSubject: async () => subjectId,
    scope: qqScope,
    life: { get },
  } as unknown as GatewayHttpOptions;
  const app = await createProductHttpApp({
    authentication: {} as ManagementAuthentication,
    product: {} as ProductManagement,
    identity: { installationId: "fixture", bootId: "fixture" },
    onAdministratorClaimed: async () => {},
    gateway,
  });
  try {
    const read = (subject: string, credential: string) =>
      app.inject({
        method: "POST",
        url: "/gateway/v1/life/read",
        headers: { authorization: "Bearer " + credential },
        payload: { subjectId: subject, activityId },
      });
    expect((await read(subjectId, "ordinary-administrator")).statusCode).toBe(401);
    expect((await read(randomUUID(), "service-only")).statusCode).toBe(403);
    expect(get).not.toHaveBeenCalled();
    const result = await read(subjectId, "service-only");
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ activity: null });
    expect(get).toHaveBeenCalledWith(subjectId, activityId);
    expect(qqScope).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
