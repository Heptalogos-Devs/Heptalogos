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

/** Installed Subject execution is shared by agent invocation and native cron projection. */
export interface InstalledNativeOptions {
  readonly anchorRoot: string;
  readonly configurationRoot: string;
  readonly installationId: InstallationId;
  readonly signal: AbortSignal;
}
/** One real projection into the existing native scheduler. */
interface NativeWorldScheduleInput {
  readonly realAt: string | null;
  readonly subjectId: string;
  readonly worldId?: string;
  readonly activityId?: string;
  readonly requestId: string;
}
/** No Host timer or secondary scheduler exists behind this operation. */
export type NativeWorldSchedule = (input: NativeWorldScheduleInput) => Promise<void>;
function installedCommand(
  options: InstalledNativeOptions,
  entryName: "dispatch" | "world-schedule" | "agent-catalog",
) {
  return async (
    params: unknown,
    timeoutSeconds: number,
  ): Promise<
    | { status: "resolved"; response: { status?: unknown; result?: unknown } }
    | { status: "unresolved"; code: string }
  > => {
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
      `runtime/openclaw-subject/node_modules/@heptalogos/openclaw-host/dist/${entryName}.js`,
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
      const timer = setTimeout(stop, timeoutSeconds * 1000 + 45_000);
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
          const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (
            !stopping &&
            !exceeded &&
            code === 0 &&
            value &&
            typeof value === "object" &&
            !Array.isArray(value)
          )
            resolve({ status: "resolved", response: value });
          else unresolved();
        } catch {
          unresolved();
        }
      });
      child.stdin.end(JSON.stringify(params));
    });
  };
}

/** Resolves the actual installation and invokes the existing public agent SDK entry once. */
export function createInstalledNativeDispatcher(
  options: InstalledNativeOptions,
): NativeActivityDispatch {
  const invoke = installedCommand(options, "dispatch");
  return async (params) => {
    const result = await invoke(params, params.timeout);
    return result.status === "resolved" &&
      ["terminal", "accepted"].includes(String(result.response.status))
      ? result.response.status === "accepted"
        ? { status: "accepted", result: result.response.result }
        : { status: "terminal", result: result.response.result }
      : {
          status: "unresolved",
          code: result.status === "unresolved" ? result.code : "native_dispatch_failed",
        };
  };
}
/** Reuses the same descriptor, credential, Node process, stdin and abort boundary for the public cron entry. */
export function createInstalledWorldScheduler(
  options: InstalledNativeOptions & { readonly serviceCredentialFile: string },
): NativeWorldSchedule {
  const invoke = installedCommand(options, "world-schedule");
  return async (input) => {
    const result = await invoke(
      {
        realAt: input.realAt,
        wake: {
          hostAnchorRoot: options.anchorRoot,
          installationId: options.installationId,
          credentialFile: options.serviceCredentialFile,
          request: {
            subjectId: input.subjectId,
            worldId: input.worldId,
            activityId: input.activityId,
            requestId: input.requestId,
          },
        },
      },
      30,
    );
    if (
      result.status !== "resolved" ||
      !["scheduled", "disabled"].includes(String(result.response.status))
    )
      throw Error("native_world_schedule_unavailable");
  };
}

/** Selects only an explicitly bound profile present before the first native execution. */
export type NativeAgentSelect = (candidates: readonly string[]) => Promise<string>;
/** Public agents.list is read once before invocation; failed paid runs never switch profiles. */
export function createInstalledAgentSelector(
  options: InstalledNativeOptions,
): NativeAgentSelect {
  const invoke = installedCommand(options, "agent-catalog");
  return async (candidates) => {
    const value = await invoke({}, 30);
    if (
      value.status !== "resolved" ||
      value.response.status !== "catalog" ||
      !Array.isArray(value.response.result) ||
      value.response.result.some((id) => typeof id !== "string")
    )
      throw Error("native_agent_catalog_unavailable");
    const present = new Set(value.response.result);
    const selected = candidates.find((id) => present.has(id));
    if (!selected) throw Error("native_bound_agent_unavailable");
    return selected;
  };
}
