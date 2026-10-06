// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import pidusage from "pidusage";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentBootstrapProcessIdentity,
  inspectBootstrapProcessIdentity,
} from "../../src/bootstrap/process-identity.js";

vi.mock("pidusage", { spy: true });

type ChildIdentityMessage = {
  readonly type: "identity";
  readonly pid: number;
  readonly startedAtMs: number;
};

const FIXTURE = fileURLToPath(
  new URL("../support/fixtures/process-identity-child.mjs", import.meta.url),
);
const children: ChildProcess[] = [];
const PROCESS_INSPECTION_TEST_TIMEOUT_MS = 15_000;

async function startChild(): Promise<{
  readonly child: ChildProcess;
  readonly identity: ChildIdentityMessage;
}> {
  const child = spawn(process.execPath, [FIXTURE], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.push(child);
  const [message] = (await once(child, "message")) as [ChildIdentityMessage];
  return { child, identity: message };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.send?.({ type: "stop" });
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }),
  );
});

describe("bootstrap process identity", () => {
  it(
    "classifies the current process as SAME_PROCESS",
    async () => {
      const identity = currentBootstrapProcessIdentity();

      expect(identity.pid).toBe(process.pid);
      await expect(inspectBootstrapProcessIdentity(identity)).resolves.toBe(
        "SAME_PROCESS",
      );
    },
    PROCESS_INSPECTION_TEST_TIMEOUT_MS,
  );

  it(
    "classifies a live child process as SAME_PROCESS",
    async () => {
      const { identity } = await startChild();

      await expect(inspectBootstrapProcessIdentity(identity)).resolves.toBe(
        "SAME_PROCESS",
      );
    },
    PROCESS_INSPECTION_TEST_TIMEOUT_MS,
  );

  it("classifies a terminated child process as PROCESS_DEAD", async () => {
    const { child, identity } = await startChild();
    child.kill("SIGKILL");
    await once(child, "exit");

    await expect(inspectBootstrapProcessIdentity(identity)).resolves.toBe(
      "PROCESS_DEAD",
    );
  });

  it("classifies a live PID with a start-time mismatch as UNKNOWN", async () => {
    const identity = currentBootstrapProcessIdentity();

    await expect(
      inspectBootstrapProcessIdentity({
        pid: identity.pid,
        startedAtMs: identity.startedAtMs - 10_000,
      }),
    ).resolves.toBe("UNKNOWN");
  });

  it("classifies an ambiguous kill probe as UNKNOWN", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EPERM" });
    });

    await expect(
      inspectBootstrapProcessIdentity({ pid: process.pid, startedAtMs: Date.now() }),
    ).resolves.toBe("UNKNOWN");
  });

  it("classifies pidusage failure while the PID exists as UNKNOWN", async () => {
    vi.mocked(pidusage).mockRejectedValueOnce(new Error("pidusage unavailable"));

    await expect(
      inspectBootstrapProcessIdentity({ pid: process.pid, startedAtMs: Date.now() }),
    ).resolves.toBe("UNKNOWN");
  });
});
