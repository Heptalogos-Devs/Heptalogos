// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createOsCredentialStore } from "../../src/index.js";

const native = process.env.HEPTALOGOS_TEST_NATIVE_KEYRING === "1";
const suite = native ? describe : describe.skip;
const keys: Array<{ service: string; account: string }> = [];

afterEach(async () => {
  const store = createOsCredentialStore();
  await Promise.all(keys.splice(0).map((key) => store.delete(key).catch(() => false)));
});

suite("native OS credential adapter", () => {
  it("creates, reads, replaces, deletes, and reports absence", async () => {
    const store = createOsCredentialStore();
    const key = {
      service: "Heptalogos/os-credential-test-" + randomUUID(),
      account: "credential",
    };
    keys.push(key);
    const first = new TextEncoder().encode("first-secret");
    const second = new TextEncoder().encode("second-secret");
    await store.set(key, first);
    first.fill(0);
    await expect(store.exists(key)).resolves.toBe(true);
    await expect(
      store.withCredential(key, async (value) => new TextDecoder().decode(value)),
    ).resolves.toBe("first-secret");
    await store.set(key, second);
    second.fill(0);
    await expect(
      store.withCredential(key, async (value) => new TextDecoder().decode(value)),
    ).resolves.toBe("second-secret");
    await expect(store.delete(key)).resolves.toBe(true);
    await expect(store.exists(key)).resolves.toBe(false);
    await expect(
      store.withCredential(key, async () => "unreachable"),
    ).rejects.toMatchObject({
      problem: { problemCode: "os-credential.not_found" },
    });
  });
});

describe("OS credential input validation", () => {
  it("normalizes invalid keys at the adapter boundary", async () => {
    await expect(
      createOsCredentialStore().exists({ service: "", account: "missing" }),
    ).rejects.toMatchObject({ problem: { problemCode: "os-credential.invalid_key" } });
  });
});
