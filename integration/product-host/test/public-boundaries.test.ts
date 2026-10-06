// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFile(resolve(repositoryRoot, path), "utf8");

describe("Product Host public and generation boundaries", () => {
  it("keeps ProductHost Authority and framework internals out of its public handle", async () => {
    const [root, handle] = await Promise.all([
      read("packages/application/product-host/dist/index.d.ts"),
      read("packages/application/product-host/dist/host.d.ts"),
    ]);
    expect(root).not.toMatch(
      /createManagementHttpApp|deriveProductGeneration|parseProductHostInputs/u,
    );
    expect(handle).not.toMatch(
      /BootstrapManagedHostContext|FastifyInstance|ManagementService|MicroSystemSupervisor|HostOwnershipToken|PersistenceService/u,
    );
    expect(handle).toContain("interface ProductHostHandle");
  });

  it("keeps Management repository and password mechanics out of its root", async () => {
    const root = await read("packages/system/management/dist/index.d.ts");
    expect(root).not.toMatch(
      /createManagementRepository|ManagementRepository|ARGON2_PARAMETERS|digestManagementSecret|hashAdministratorPassword/u,
    );
    expect(root).toMatch(
      /SystemActionDefinition|SystemChangePlan|SystemActionExecuteResult/u,
    );
  });

  it("keeps generated transport private behind the ManagementClient facade", async () => {
    const [root, client] = await Promise.all([
      read("packages/application/management-client/dist/index.d.ts"),
      read("packages/application/management-client/dist/client.d.ts"),
    ]);
    expect(root).not.toContain("./generated/");
    expect(client).not.toContain("readonly transport");
    expect(client).toMatch(
      /SystemStatusResult|RuntimeGraphResult|CapabilityGraphResult|ReadinessResult/u,
    );
  });

  it("uses a ProductHost-owned OpenAPI artifact without client code imports", async () => {
    const [hostGenerator, clientGenerator, artifact] = await Promise.all([
      read("packages/application/product-host/scripts/generate-openapi.mjs"),
      read("packages/application/management-client/scripts/generate.mjs"),
      read("packages/application/product-host/generated/management.openapi.json"),
    ]);
    expect(hostGenerator).toContain("createManagementHttpApp");
    expect(clientGenerator).toContain("product-host/generated/management.openapi.json");
    expect(clientGenerator).not.toMatch(/product-host\/dist|product-host\/src/u);
    expect(JSON.parse(artifact)).toHaveProperty("openapi", "3.1.0");
  });
});
