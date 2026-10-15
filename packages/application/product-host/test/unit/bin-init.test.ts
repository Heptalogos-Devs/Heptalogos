// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../src/host.js", () => ({ startProductHostFromArgv: vi.fn() }));
import { startProductHostFromArgv } from "../../src/host.js";

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
let root: string | undefined;
afterEach(async () => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
}, 30_000);

it("initializes through the host binary without starting the host or reading stdin", async () => {
  root = await mkdtemp(join(tmpdir(), "heptalogos-bin-init-"));
  process.argv = [process.execPath, "bin.js", "init", "--anchor-root", root];
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stdin = vi.spyOn(process.stdin, "read");
  await import("../../src/bin.js");
  const result = JSON.parse(String(output.mock.calls[0]?.[0]));
  const locator = JSON.parse(
    await readFile(join(root, "heptalogos.bootstrap.json"), "utf8"),
  );
  expect(result).toEqual({ type: "INITIALIZED", ...locator });
  expect(startProductHostFromArgv).not.toHaveBeenCalled();
  expect(stdin).not.toHaveBeenCalled();
}, 30_000);
