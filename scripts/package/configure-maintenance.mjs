// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Provisions the installation's independent operator Gateway, without Subject cognition or channels.
 * @module configure-maintenance
 */
import { readFile, writeFile, mkdir, lstat, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { runProcessSyncChecked } from "@heptalogos/repo-kit";
import {
  quoteUnit,
  readInstallationServices,
  registerService,
} from "./service-unit.mjs";
const run = (command, args, timeout = 30000) =>
  runProcessSyncChecked(command, args, { timeout, stdin: "ignore" }).stdout.trim();
async function protectedFile(path) {
  const stat = await lstat(path);
  if (
    !isAbsolute(path) ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
  )
    throw Error("Use an absolute protected regular file");
}
async function availablePort(port) {
  if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535))
    throw Error("Maintenance port must be an integer between 1024 and 65535");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port ?? 0, "127.0.0.1", resolve);
  });
  const selected = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return selected;
}
/** Renders one independent user service; it has no Host dependency or Subject bootstrap hook. */
export function maintenanceGatewayServiceUnit({
  node,
  anchorRoot,
  nativeEntry,
  profilePath,
  stateRoot,
  passwordFile,
  environmentFile,
  logPath,
}) {
  return `[Unit]\nDescription=Heptalogos Operator Maintenance Gateway\nAfter=network-online.target\n\n[Service]\nType=exec\nWorkingDirectory=${anchorRoot.replaceAll("%", "%%")}\nEnvironment=${quoteUnit("OPENCLAW_STATE_DIR=" + stateRoot)}\nEnvironment=${quoteUnit("OPENCLAW_CONFIG_PATH=" + profilePath)}\nExecStart=${[node, "--env-file=" + environmentFile, nativeEntry, "gateway", "run", "--password-file", passwordFile, "--ws-log", "compact"].map((value) => quoteUnit(value, true)).join(" ")}\nUMask=0077\nRestart=on-failure\nRestartSec=5s\nKillSignal=SIGINT\nTimeoutStopSec=45s\nStandardOutput=append:${logPath.replaceAll("%", "%%")}\nStandardError=inherit\n\n[Install]\nWantedBy=default.target\n`;
}
/** Creates only the maintenance slot; existing profiles/state/secrets are preserved and validated. */
export async function configureMaintenanceGateway({
  target,
  environmentFile,
  sourceProfile,
  model,
  port,
  autostart,
}) {
  await protectedFile(environmentFile);
  await protectedFile(sourceProfile);
  const { locator, descriptorPath, descriptor } =
    await readInstallationServices(target);
  const maintenance = descriptor.services?.maintenance;
  if (
    descriptor.schemaVersion !== 1 ||
    descriptor.installationId !== locator.installationId ||
    maintenance?.identity !== `${locator.installationId}/maintenance` ||
    maintenance.unit !== `heptalogos-${locator.installationId}-maintenance.service`
  )
    throw Error("The authoritative maintenance service descriptor is invalid");
  for (const key of ["CONFIGURATION", "DATA", "SECRET", "CACHE", "RUN"]) {
    const path = maintenance.roots?.[key];
    if (typeof path !== "string" || !isAbsolute(path))
      throw Error("The maintenance roots are invalid");
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  const state = run("systemctl", [
    "--user",
    "show",
    maintenance.unit,
    "--property=ActiveState",
    "--value",
  ]);
  if (!["inactive", "failed"].includes(state))
    throw Error("Stop only the maintenance Gateway before configuring it");
  const node = join(target, "runtime/node/bin/node"),
    nativeRoot = join(target, "runtime/openclaw-maintenance"),
    nativeEntry = join(nativeRoot, "node_modules/openclaw/openclaw.mjs");
  for (const path of [node, nativeEntry])
    if (!(await lstat(path)).isFile())
      throw Error("Install the separate official maintenance runtime first");
  const runtime = JSON.parse(await readFile(join(nativeRoot, "package.json"), "utf8"));
  if (runtime.nousManagedRuntime !== 1)
    throw Error(
      "The maintenance runtime must be installed by the official Nous installer",
    );
  const profilePath = join(maintenance.roots.CONFIGURATION, "openclaw.json"),
    passwordFile = join(maintenance.roots.SECRET, "gateway-password");
  const existing = await lstat(profilePath).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  let profile;
  if (existing) {
    await protectedFile(profilePath);
    profile = JSON.parse(await readFile(profilePath, "utf8"));
    if (
      profile.plugins?.enabled !== false ||
      profile.gateway?.mode !== "local" ||
      profile.gateway?.bind !== "loopback" ||
      !Number.isInteger(profile.gateway.port) ||
      profile.gateway.port < 1024 ||
      profile.gateway.port > 65535 ||
      profile.gateway?.auth?.mode !== "password"
    )
      throw Error(
        "The existing maintenance profile must remain a local operator runtime without plugins/channels",
      );
    if (port !== undefined && port !== profile.gateway.port)
      throw Error(
        "Preserve the existing maintenance port or explicitly edit its stopped profile first",
      );
    await availablePort(profile.gateway.port);
  } else {
    const source = JSON.parse(await readFile(sourceProfile, "utf8"));
    const separator = model.indexOf("/");
    if (separator < 1) throw Error("Use a provider/model identifier");
    const providerId = model.slice(0, separator),
      modelId = model.slice(separator + 1),
      provider = source.models?.providers?.[providerId];
    const selected = provider?.models?.find((value) => value.id === modelId);
    if (
      !selected ||
      provider.apiKey?.source !== "env" ||
      typeof provider.apiKey.id !== "string" ||
      (provider.headers && Object.keys(provider.headers).length)
    )
      throw Error(
        "Select an existing model with an environment-backed credential; literal secrets/headers are not copied",
      );
    const workspace = join(maintenance.roots.DATA, "workspace");
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    profile = {
      gateway: {
        mode: "local",
        port: await availablePort(port),
        bind: "loopback",
        auth: { mode: "password" },
      },
      session: { dmScope: "per-account-channel-peer" },
      cron: { enabled: false },
      agents: {
        defaults: { workspace, model: { primary: model }, heartbeat: { every: "0" } },
        list: [{ id: "maintenance", default: true, workspace }],
      },
      plugins: {
        enabled: false,
        allow: [],
        entries: {
          "nous-cognition": { enabled: false },
          "heptalogos-qq": { enabled: false },
        },
      },
      tools: {
        allow: ["read", "exec", "process", "session_status"],
        deny: ["message", "sessions_spawn", "cron", "gateway"],
        exec: { host: "gateway", security: "full", ask: "off" },
      },
      models: { providers: { [providerId]: { ...provider, models: [selected] } } },
      logging: { file: join(maintenance.roots.RUN, "native.log") },
    };
    await writeFile(profilePath, JSON.stringify(profile, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  }
  const passwordExists = await lstat(passwordFile).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (passwordExists) {
    await protectedFile(passwordFile);
    if (!(await readFile(passwordFile, "utf8")).trim())
      throw Error("The existing maintenance password is empty");
  } else
    await writeFile(passwordFile, randomBytes(48).toString("base64url") + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  const unitDirectory = join(locator.roots.CONFIGURATION, "systemd");
  await mkdir(unitDirectory, { recursive: true, mode: 0o700 });
  const unitPath = join(unitDirectory, maintenance.unit);
  await writeFile(
    unitPath,
    maintenanceGatewayServiceUnit({
      node,
      anchorRoot: target,
      nativeEntry,
      profilePath,
      stateRoot: maintenance.roots.DATA,
      passwordFile,
      environmentFile,
      logPath: join(maintenance.roots.RUN, "gateway.log"),
    }),
    { mode: 0o600 },
  );
  const enabled = registerService(unitPath, autostart);
  const latestDescriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  if (
    latestDescriptor.installationId !== descriptor.installationId ||
    latestDescriptor.services?.maintenance?.identity !== maintenance.identity ||
    latestDescriptor.services.maintenance.unit !== maintenance.unit ||
    Object.keys(maintenance.roots).some(
      (key) =>
        latestDescriptor.services.maintenance.roots?.[key] !== maintenance.roots[key],
    )
  )
    throw Error("The installation descriptor changed during maintenance registration");
  latestDescriptor.services.maintenance.configured = true;
  latestDescriptor.services.maintenance.environmentFile = environmentFile;
  const temporary = descriptorPath + ".maintenance-configured";
  await writeFile(temporary, JSON.stringify(latestDescriptor, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(temporary, descriptorPath);
  console.log(
    JSON.stringify({
      configured: true,
      installationId: descriptor.installationId,
      autostart: enabled,
      unit: maintenance.unit,
      origin: `http://127.0.0.1:${profile.gateway.port}`,
      profilePath,
    }),
  );
}
