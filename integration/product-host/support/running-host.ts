// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Observes the same built Host protocol in development and portable qualification.
 * @module running-host
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

/** Machine-readable readiness published by the built Host. */
export interface HostReady {
  readonly type: "READY";
  readonly installationId: string;
  readonly instanceId: string;
  readonly bootId: string;
  readonly origin: string;
  readonly productGeneration: string;
  readonly bootstrapRuntimeGeneration: string;
}

/** A started Host process and its bounded lifecycle controls. */
export interface RunningHost {
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: HostReady;
  readonly stop: () => Promise<void>;
  readonly crash: () => Promise<void>;
  readonly stderr: () => string;
}

/** Waits for the built Host readiness event and observes its actual process lifetime. */
export async function observeRunningHost(
  child: ChildProcessWithoutNullStreams,
): Promise<RunningHost> {
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const stdoutReader = createInterface({ input: child.stdout });
  const stderrReader = createInterface({ input: child.stderr });
  const ready = await new Promise<HostReady>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Product Host did not publish READY: " + stderr));
      child.kill();
    }, 150_000);
    const inspectLine = (line: string, stream: "stdout" | "stderr") => {
      try {
        const value = JSON.parse(line) as Partial<HostReady>;
        if (value.type === "READY") {
          clearTimeout(timer);
          resolvePromise(value as HostReady);
        } else if (value.type === "ERROR") {
          clearTimeout(timer);
          reject(
            new Error(
              `Product Host startup failed on ${stream}: ${line}${stderr.length === 0 ? "" : `; stderr=${stderr}`}`,
            ),
          );
        }
      } catch {
        // Keep waiting for the machine-readable READY line.
      }
    };
    stdoutReader.on("line", (line) => inspectLine(line, "stdout"));
    stderrReader.on("line", (line) => inspectLine(line, "stderr"));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Product Host exited before READY (${code}): ${stderr}`));
    });
  });
  stdoutReader.close();
  stderrReader.close();
  return {
    child,
    ready,
    stderr: () => stderr,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolvePromise, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Product Host did not stop")),
          60_000,
        );
        child.once("exit", () => {
          clearTimeout(timer);
          resolvePromise();
        });
      });
    },
    async crash() {
      if (child.exitCode !== null) return;
      child.kill("SIGKILL");
      await new Promise<void>((resolvePromise) => {
        child.once("exit", () => resolvePromise());
      });
    },
  };
}
