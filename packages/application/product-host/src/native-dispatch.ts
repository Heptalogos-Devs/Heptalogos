// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Installed adapter to the public OpenClaw SDK CLI; owns no execution loop.
 * @module native-dispatch
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { InstallationId } from "@heptalogos/foundation-contracts";
import type { NativeActivityDispatch } from "./activity-dispatch-contracts.js";

/** Resolves the current installed Subject and invokes its SDK once over stdin. */
export function createInstalledNativeDispatcher(options: {
  readonly anchorRoot: string;
  readonly configurationRoot: string;
  readonly installationId: InstallationId;
  readonly signal: AbortSignal;
}): NativeActivityDispatch {
  return async (params) => {
    const descriptor = JSON.parse(
      await readFile(
        join(options.configurationRoot, "installation-services.json"),
        "utf8",
      ),
    );
    const subject = descriptor.services?.subject;
    if (
      descriptor.schemaVersion !== 1 ||
      descriptor.installationId !== options.installationId ||
      subject?.identity !== `${options.installationId}/subject` ||
      subject.configured !== true
    )
      return { status: "unresolved", code: "native_subject_not_configured" };
    for (const name of ["CONFIGURATION", "DATA", "SECRET"])
      if (typeof subject.roots?.[name] !== "string" || !isAbsolute(subject.roots[name]))
        throw Error("Invalid installed Subject roots");
    if (
      subject.environmentFile !== undefined &&
      (typeof subject.environmentFile !== "string" ||
        !isAbsolute(subject.environmentFile))
    )
      throw Error("Invalid installed Subject environment path");
    const password = (
      await readFile(join(subject.roots.SECRET, "gateway-password"), "utf8")
    ).trim();
    if (!password) throw Error("The installed native credential is empty");
    const entry = join(
      options.anchorRoot,
      "runtime/openclaw-subject/node_modules/@heptalogos/openclaw-host/dist/dispatch.js",
    );
    const args = [
      ...(subject.environmentFile ? ["--env-file=" + subject.environmentFile] : []),
      entry,
    ];
    return new Promise((resolve) => {
      const child = spawn(join(options.anchorRoot, "runtime/node/bin/node"), args, {
        cwd: options.anchorRoot,
        env: {
          ...process.env,
          OPENCLAW_STATE_DIR: subject.roots.DATA,
          OPENCLAW_CONFIG_PATH: join(subject.roots.CONFIGURATION, "openclaw.json"),
          OPENCLAW_GATEWAY_PASSWORD: password,
        },
        stdio: ["pipe", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let exceeded = false;
      let stopping = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      };
      // Matches the public CLI's RPC timeout, plus process shutdown allowance.
      const timer = setTimeout(stop, 675_000);
      options.signal.addEventListener("abort", stop, { once: true });
      if (options.signal.aborted) stop();
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) {
          exceeded = true;
          stop();
        } else chunks.push(chunk);
      });
      const unresolved = () => {
        resolve({ status: "unresolved", code: "native_dispatch_failed" });
      };
      child.on("error", unresolved);
      child.stdin.on("error", () => {
        /* The close/error event records uncertain submission. */
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        options.signal.removeEventListener("abort", stop);
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!stopping && !exceeded && code === 0 && result.status === "terminal")
            resolve({ status: "terminal", result: result.result });
          else unresolved();
        } catch {
          unresolved();
        }
      });
      child.stdin.end(JSON.stringify(params));
    });
  };
}
