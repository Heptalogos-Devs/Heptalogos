// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Installed Linux service identities and bounded user-systemd operations.
 * @module services
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { execa } from "execa";
import { openLocalManagementClient } from "@heptalogos/management-client/node";
import { CliFailure } from "./base-command.js";

/** The three service slots owned by one installed product. */
export type InstalledComponent = "host" | "subject" | "maintenance";
/** Lifecycle operations admitted by the reference CLI. */
export type ServiceOperation = "start" | "stop" | "restart" | "status";
interface InstalledService {
  readonly unit: string;
  readonly configured: boolean;
}
interface InstalledServices {
  readonly installationId: string;
  readonly services: Readonly<Record<InstalledComponent, InstalledService>>;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function invalidDescriptor(): never {
  throw new CliFailure(
    "installation.services_invalid",
    "The installed service descriptor is missing or does not match this installation; run the Linux installer",
    4,
  );
}

/** Reads only the installer-owned descriptor; arbitrary unit names are never accepted. */
export async function readInstalledServices(
  anchorRoot: string,
): Promise<InstalledServices> {
  if (!isAbsolute(anchorRoot)) return invalidDescriptor();
  try {
    const locator = record(
      JSON.parse(await readFile(join(anchorRoot, "heptalogos.bootstrap.json"), "utf8")),
    );
    const roots = record(locator?.roots);
    if (
      locator?.schemaVersion !== 1 ||
      typeof locator.installationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        locator.installationId,
      ) ||
      typeof roots?.CONFIGURATION !== "string" ||
      !isAbsolute(roots.CONFIGURATION)
    )
      return invalidDescriptor();
    const descriptor = record(
      JSON.parse(
        await readFile(join(roots.CONFIGURATION, "installation-services.json"), "utf8"),
      ),
    );
    const services = record(descriptor?.services);
    if (
      descriptor?.schemaVersion !== 1 ||
      descriptor.installationId !== locator.installationId ||
      !services
    )
      return invalidDescriptor();
    for (const component of ["host", "subject", "maintenance"] as const) {
      const service = record(services[component]);
      if (
        !service ||
        service.unit !== `heptalogos-${locator.installationId}-${component}.service` ||
        typeof service.configured !== "boolean"
      )
        return invalidDescriptor();
    }
    return descriptor as unknown as InstalledServices;
  } catch (error) {
    if (error instanceof CliFailure) throw error;
    return invalidDescriptor();
  }
}

async function systemctl(args: readonly string[], timeout: number) {
  try {
    const result = await execa("systemctl", ["--user", "--no-pager", ...args], {
      timeout,
      reject: false,
    });
    if (result.exitCode !== 0 || result.timedOut)
      throw new Error("service operation failed");
    return result.stdout;
  } catch {
    throw new CliFailure(
      "installation.service_failed",
      "The user service manager could not complete the operation; inspect systemctl --user status for this installation",
      7,
      503,
    );
  }
}

async function waitForManagement(anchorRoot: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      await openLocalManagementClient({
        anchorRoot,
        fetch: (input, options) =>
          fetch(input, { ...options, signal: AbortSignal.timeout(2_000) }),
      });
      return;
    } catch {
      await delay(200);
    }
  }
  throw new CliFailure(
    "installation.management_start_timeout",
    "The Host service started but Management did not publish a matching endpoint within 90 seconds; inspect its user-service journal",
    7,
    503,
  );
}

/** Controls one fixed installed unit without depending on an available Management Host. */
export async function operateInstalledService(
  anchorRoot: string,
  component: InstalledComponent,
  operation: ServiceOperation,
) {
  if (process.platform !== "linux")
    throw new CliFailure(
      "installation.service_platform_unsupported",
      "Service commands require a Linux user-systemd installation; use the portable foreground launcher on Windows",
      4,
    );
  const descriptor = await readInstalledServices(anchorRoot);
  const service = descriptor.services[component];
  if (!service.configured) {
    const result = {
      installationId: descriptor.installationId,
      component,
      unit: service.unit,
      state: "unconfigured",
      nextStep: `Install the ${component} Gateway artifact and register its independent service using the installer`,
    };
    if (operation === "status") return result;
    throw new CliFailure("installation.gateway_unconfigured", result.nextStep, 4);
  }
  if (operation !== "status") {
    await systemctl([operation, service.unit], operation === "stop" ? 55_000 : 95_000);
    if (component === "host" && operation !== "stop")
      await waitForManagement(anchorRoot);
  }
  const output = await systemctl(
    ["show", service.unit, "--property=LoadState,ActiveState,SubState,MainPID"],
    5_000,
  );
  const properties = Object.fromEntries(
    output.split("\n").map((line) => line.split("=", 2)),
  );
  if (properties.LoadState !== "loaded" && operation !== "status")
    throw new CliFailure(
      "installation.service_unavailable",
      "The installed service unit is not registered with the user service manager; register the installer-owned unit before starting it",
      4,
    );
  return {
    installationId: descriptor.installationId,
    component,
    unit: service.unit,
    state:
      properties.LoadState === "loaded"
        ? (properties.ActiveState ?? "unknown")
        : "unregistered",
    subState: properties.SubState ?? "unknown",
    mainPid: Number(properties.MainPID ?? 0),
  };
}
