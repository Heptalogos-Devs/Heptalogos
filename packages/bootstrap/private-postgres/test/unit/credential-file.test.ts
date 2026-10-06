// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { access, mkdtemp, readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { withRestrictedPasswordFile } from "../../src/credential-file.js";

const SENTINEL = "PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6";

describe("withRestrictedPasswordFile", () => {
  it("writes one newline and removes the password file after success", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-temp-"));
    let callbackPath = "";

    const returnedPath = await withRestrictedPasswordFile(
      tempRoot,
      new TextEncoder().encode(SENTINEL),
      async (passwordFilePath) => {
        callbackPath = passwordFilePath;
        expect(isAbsolute(passwordFilePath)).toBe(true);
        await expect(readFile(passwordFilePath, "utf8")).resolves.toBe(`${SENTINEL}\n`);
        if (process.platform !== "win32") {
          await expect(stat(passwordFilePath)).resolves.toMatchObject({
            mode: expect.any(Number),
          });
          const mode = (await stat(passwordFilePath)).mode & 0o777;
          expect(mode).toBe(0o600);
        }
        return passwordFilePath;
      },
    );

    expect(returnedPath).toBe(callbackPath);
    expect(returnedPath).not.toContain(SENTINEL);
    await expect(access(callbackPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the password file when the callback throws", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-temp-"));
    let callbackPath = "";

    await expect(
      withRestrictedPasswordFile(
        tempRoot,
        new TextEncoder().encode(SENTINEL),
        async (passwordFilePath) => {
          callbackPath = passwordFilePath;
          throw new Error("callback failed without secret detail");
        },
      ),
    ).rejects.toThrow("callback failed without secret detail");

    await expect(access(callbackPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["empty", new Uint8Array()],
    ["LF", new TextEncoder().encode("abc\nxyz")],
    ["CR", new TextEncoder().encode("abc\rxyz")],
    ["NUL", new Uint8Array([0x61, 0x00, 0x62])],
  ])(
    "rejects a password containing %s before creating a pwfile",
    async (_label, password) => {
      const tempRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-temp-"));

      await expect(
        withRestrictedPasswordFile(tempRoot, password, async () => {
          throw new Error("callback must not run");
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "private-postgres.credential_file.invalid_password" },
      });
    },
  );

  it("accepts a normal UTF-8 single-line password", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-temp-"));
    const password = "密码-安全-🔐";

    await expect(
      withRestrictedPasswordFile(
        tempRoot,
        new TextEncoder().encode(password),
        async (passwordFilePath) => readFile(passwordFilePath, "utf8"),
      ),
    ).resolves.toBe(`${password}\n`);
  });
});
