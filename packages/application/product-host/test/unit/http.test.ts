// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { ManagementService } from "@heptalogos/management";
import { createManagementHttpApp } from "../../src/http.js";

function serviceFixture(): ManagementService {
  return {
    contractVersion: "management.v1" as const,
    getCompatibilityDescriptor: () => ({
      schemaVersion: 1 as const,
      instanceId: "instance",
      continuityEpochId: "epoch",
      productGeneration: "generation",
      coreContractVersion: "management.v1" as const,
      supportedClientContractRange: {
        kind: "exact" as const,
        version: "management.v1" as const,
      },
      problemSchemaVersion: 1 as const,
    }),
    getDiscovery: () => ({
      schemaVersion: 1 as const,
      installationId: "installation",
      compatibility: {
        schemaVersion: 1 as const,
        instanceId: "instance",
        continuityEpochId: "epoch",
        productGeneration: "generation",
        coreContractVersion: "management.v1" as const,
        supportedClientContractRange: {
          kind: "exact" as const,
          version: "management.v1" as const,
        },
        problemSchemaVersion: 1 as const,
      },
      apiBasePath: "/management/v1" as const,
    }),
    getSystemStatus: async () => ({}),
    getHost: () => ({}),
    getRuntimeGraph: () => ({}),
    getCapabilityGraph: () => ({}),
    getReadiness: async () => ({}),
    getProductState: async () => ({}),
    getSystemActionCatalog: () => [],
    planAction: async () => ({}),
    executeAction: async () => ({}),
    ensureFirstAdministratorClaim: async () => undefined,
    claimFirstAdministrator: async () => ({
      schemaVersion: 1,
      administratorId: "administrator",
    }),
    login: async () => ({}),
    authenticate: async () => ({}),
    logout: async () => undefined,
  } as unknown as ManagementService;
}

describe("Management HTTP adapter", () => {
  it("exposes discovery, rejects unauthenticated reads, and documents bearer auth", async () => {
    const app = await createManagementHttpApp(serviceFixture());
    const discovery = await app.inject({
      method: "GET",
      url: "/.well-known/heptalogos-management",
    });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({ apiBasePath: "/management/v1" });
    const unauthorized = await app.inject({
      method: "GET",
      url: "/management/v1/host",
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["content-type"]).toContain("application/problem+json");
    const openapi = app.swagger() as unknown as {
      readonly openapi: string;
      readonly components?: { readonly securitySchemes?: Record<string, unknown> };
      readonly paths: Record<string, unknown>;
    };
    expect(openapi.openapi).toBe("3.1.0");
    expect(openapi.components?.securitySchemes).toHaveProperty("bearerAuth");
    expect(openapi.paths).toHaveProperty("/management/v1/runtime/graph");
    expect(openapi.paths).toHaveProperty("/management/v1/actions");
    expect(openapi.paths).toHaveProperty("/management/v1/actions/plan");
    expect(openapi.paths).toHaveProperty("/management/v1/actions/execute");
    expect(openapi.paths).toHaveProperty("/management/v1/product/state");
    await app.close();
  });

  it("preserves the canonical rate-limit Problem through Fastify", async () => {
    const app = await createManagementHttpApp(serviceFixture());
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await app.inject({
        method: "POST",
        url: "/management/v1/bootstrap/claim",
        payload: { claimId: "a", claimSecret: "b", password: "c" },
      });
    }
    expect(response?.statusCode).toBe(429);
    expect(response?.json()).toMatchObject({
      schemaVersion: 1,
      problemCode: "management.rate_limited",
      category: "conflict",
      retryClass: "after-change",
    });
    await app.close();
  });
});
