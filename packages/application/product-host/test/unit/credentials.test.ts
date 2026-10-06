// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createInstallationId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import { createProductionBootstrapKeyProvider } from "../../src/credentials.js";

function storeFixture(initial: ReadonlyMap<string, Uint8Array> = new Map()) {
  const values = new Map<string, Uint8Array>(
    [...initial.entries()].map(([key, value]) => [key, Uint8Array.from(value)]),
  );
  const keyId = (key: { service: string; account: string }) =>
    key.service + "\u0000" + key.account;
  return {
    values,
    store: {
      async exists(key: { service: string; account: string }) {
        return values.has(keyId(key));
      },
      async set(key: { service: string; account: string }, secret: Uint8Array) {
        values.set(keyId(key), Uint8Array.from(secret));
      },
      async delete(key: { service: string; account: string }) {
        return values.delete(keyId(key));
      },
      async withCredential<T>(
        key: { service: string; account: string },
        use: (secret: Uint8Array) => Promise<T>,
      ) {
        const value = values.get(keyId(key));
        if (value === undefined) throw new Error("missing");
        return use(Uint8Array.from(value));
      },
    },
  };
}

describe("production BootstrapKeyProvider", () => {
  it("provisions the complete fresh-install credential set", async () => {
    const installationId = createInstallationId();
    const instanceId = createInstanceId();
    const fixture = storeFixture();
    await createProductionBootstrapKeyProvider({
      installationId,
      instanceId,
      existingInstallation: false,
      store: fixture.store,
    });
    expect(fixture.values.size).toBe(5);
    expect([...fixture.values.values()].every((value) => value.byteLength > 0)).toBe(
      true,
    );
  });

  it("fails closed when an existing installation lacks one credential", async () => {
    const installationId = createInstallationId();
    const instanceId = createInstanceId();
    const fixture = storeFixture();
    await expect(
      createProductionBootstrapKeyProvider({
        installationId,
        instanceId,
        existingInstallation: true,
        store: fixture.store,
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "product-host.bootstrap_credential_missing" },
    });
    expect(fixture.values.size).toBe(0);
  });
});
