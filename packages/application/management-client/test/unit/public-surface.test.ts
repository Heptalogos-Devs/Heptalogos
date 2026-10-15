// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { createManagementClient } from "../../src/index.js";
import * as managementClientPublic from "../../src/index.js";

describe("ManagementClient public facade", () => {
  it("keeps generated transport and modules closure-private", () => {
    expect(Object.keys(managementClientPublic).sort()).toEqual([
      "ManagementClientError",
      "createManagementClient",
    ]);
    const client = createManagementClient({ origin: "http://127.0.0.1:1" });
    expect("transport" in client).toBe(false);
  });

  it("unwraps Hey API's typed fields response at the facade boundary", async () => {
    const discovery = {
      installationId: "installation",
      bootId: "boot",
      apiBasePath: "/v1",
      contractVersion: "management.v1",
    };
    const client = createManagementClient({
      origin: "http://127.0.0.1",
      fetch: async () =>
        new Response(JSON.stringify(discovery), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.getDiscovery()).resolves.toEqual(discovery);
  });

  it("generates only from the ProductHost-owned OpenAPI artifact", async () => {
    const source = await readFile(
      resolve("packages/application/management-client/scripts/generate.mjs"),
      "utf8",
    );
    expect(source).toContain("product-host/generated/management.openapi.json");
    expect(source).not.toContain("product-host/dist");
    expect(source).not.toContain("createManagementHttpApp");
  });
});
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
