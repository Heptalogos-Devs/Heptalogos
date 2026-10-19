// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Installs built application artifacts and fixed user-systemd services on Linux.
 * @module install-linux-product
 */
import {
  quoteUnit,
  readInstallationServices,
  registerService,
  autostartChoice,
} from "./service-unit.mjs";
import { configureMaintenanceGateway } from "./configure-maintenance.mjs";
import { runProcessSyncChecked } from "@heptalogos/repo-kit";
import { cp, mkdir, readFile, lstat, writeFile, chmod, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  materializeApplicationArtifact,
  digestTree,
  normalizeCliArtifactManifest,
  verifyPortableLinks,
} from "./assemble-portable-product.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function run(command, args, timeout = 120_000) {
  return runProcessSyncChecked(command, args, {
    timeout,
    stdin: "ignore",
  }).stdout.trim();
}
function argumentsFrom(argv) {
  const values = new Map();
  const accepted = [
    "--target",
    "--node-root",
    "--postgres-root",
    "--host-artifact",
    "--cli-artifact",
    "--autostart",
  ];
  for (let index = 0; index < argv.length; index += 2) {
    if (
      !accepted.includes(argv[index]) ||
      !argv[index + 1] ||
      argv[index + 1].startsWith("--")
    )
      throw new Error(
        "Expected --target, --node-root, --postgres-root and optional --host-artifact/--cli-artifact paths, --autostart yes|no",
      );
    values.set(
      argv[index],
      argv[index] === "--autostart" ? argv[index + 1] : resolve(argv[index + 1]),
    );
  }
  for (const key of ["--target", "--node-root", "--postgres-root"])
    if (!values.has(key)) throw new Error(`${key} is required`);
  return {
    autostart: autostartChoice(values.get("--autostart")) ?? false,
    target: values.get("--target"),
    nodeRoot: values.get("--node-root"),
    postgresRoot: values.get("--postgres-root"),
    host:
      values.get("--host-artifact") ??
      join(repositoryRoot, "packages/application/product-host/dist"),
    cli:
      values.get("--cli-artifact") ??
      join(repositoryRoot, "packages/application/cli/dist"),
  };
}

/** Renders the installer-owned Host unit with bounded drain and independent Gateway lifetimes. */
export function managementServiceUnit({
  node,
  host,
  anchorRoot,
  postgresBin,
  initialPostgresPort,
}) {
  return `[Unit]\nDescription=Heptalogos independent Management Host\n\n[Service]\nType=exec\nWorkingDirectory=${anchorRoot.replaceAll("%", "%%")}\nExecStart=${[node, host, "--anchor-root", anchorRoot, "--postgres-bin", postgresBin, "--initial-postgres-port", String(initialPostgresPort)].map((value) => quoteUnit(value, true)).join(" ")}\nEnvironment=${quoteUnit("PATH=" + dirname(node) + ":/usr/local/bin:/usr/bin:/bin")}\nUMask=0077\nRestart=on-failure\nRestartSec=2s\nTimeoutStopSec=45s\nKillMode=mixed\n\n[Install]\nWantedBy=default.target\n`;
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const port = server.address().port;
  await new Promise((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return port;
}

async function install(options) {
  if (process.platform !== "linux")
    throw new Error(
      "Linux installation requires Linux; retain the Windows portable launcher for Windows",
    );
  if (
    options.target === repositoryRoot ||
    options.target.startsWith(repositoryRoot + sep)
  )
    throw new Error("The installation must be outside the source repository");
  try {
    await lstat(options.target);
    throw new Error(
      "The installation target already exists; existing state is never replaced by this installer",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const originalNode = join(options.nodeRoot, "bin/node");
  const originalPostgres = join(options.postgresRoot, "bin/postgres");
  if (run(originalNode, ["--version"]) !== "v24.21.0")
    throw new Error("Linux installation requires exactly Node 24.21.0");
  if (!/\b18\.6\b/u.test(run(originalPostgres, ["--version"])))
    throw new Error("Linux installation requires PostgreSQL 18.6");
  run("systemctl", ["--user", "show-environment"], 10_000);
  const hostArtifact = await materializeApplicationArtifact(
    options.host,
    "product-host",
  );
  const cliArtifact = await materializeApplicationArtifact(options.cli, "cli");
  const identityText = await readFile(
    join(hostArtifact.root, "generated/build-identities.js"),
    "utf8",
  );
  const generation = /PRODUCT_GENERATION_ID = "([0-9a-f]{64})"/u.exec(
    identityText,
  )?.[1];
  if (!generation) throw new Error("Built product generation is unavailable");
  await mkdir(options.target, { recursive: true, mode: 0o700 });
  const product = join(options.target, "program/product", generation);
  const cli = join(product, "cli");
  await mkdir(dirname(product), { recursive: true });
  await cp(hostArtifact.root, product, { recursive: true, verbatimSymlinks: true });
  await cp(cliArtifact.root, cli, { recursive: true, verbatimSymlinks: true });
  await normalizeCliArtifactManifest(cli);
  const hostDigest = await digestTree(product);
  const cliDigest = await digestTree(cli);
  const nodeRoot = join(options.target, "runtime/node");
  const postgresRoot = join(options.target, "runtime/postgresql");
  await mkdir(join(nodeRoot, "bin"), { recursive: true });
  await cp(originalNode, join(nodeRoot, "bin/node"), { dereference: true });
  await cp(join(options.nodeRoot, "LICENSE"), join(nodeRoot, "LICENSE"));
  await cp(options.postgresRoot, postgresRoot, {
    recursive: true,
    verbatimSymlinks: true,
  });
  await verifyPortableLinks(options.target);
  const node = join(nodeRoot, "bin/node");
  const host = join(product, "bin.js");
  const initialized = JSON.parse(
    run(node, [host, "init", "--anchor-root", options.target]),
  );
  const { installationId, roots } = initialized;
  const services = {};
  for (const component of ["host", "subject", "maintenance"]) {
    services[component] = {
      unit: `heptalogos-${installationId}-${component}.service`,
      configured: component === "host",
    };
    if (component !== "host") {
      services[component].identity = `${installationId}/${component}`;
      services[component].roots = {};
      for (const id of ["CONFIGURATION", "DATA", "SECRET", "CACHE", "RUN"]) {
        const path = join(roots[id], "gateways", component);
        await mkdir(path, { recursive: true, mode: 0o700 });
        services[component].roots[id] = path;
      }
    }
  }
  const descriptor = { schemaVersion: 1, installationId, services };
  const unitDirectory = join(roots.CONFIGURATION, "systemd");
  await mkdir(unitDirectory, { recursive: true, mode: 0o700 });
  const unitPath = join(unitDirectory, services.host.unit);
  await writeFile(
    unitPath,
    managementServiceUnit({
      node,
      host,
      anchorRoot: options.target,
      postgresBin: join(postgresRoot, "bin"),
      initialPostgresPort: await freeLoopbackPort(),
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(roots.CONFIGURATION, "installation-services.json"),
    JSON.stringify(descriptor, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  const bin = join(options.target, "bin");
  await mkdir(bin, { recursive: true });
  const launcher = `#!/bin/sh\nexec ${shellQuote(node)} ${shellQuote(join(cli, "bin.js"))} "$@" --anchor-root ${shellQuote(options.target)}\n`;
  await writeFile(join(bin, "heptalogos"), launcher, { mode: 0o700 });
  await chmod(join(bin, "heptalogos"), 0o700);
  await mkdir(join(options.target, "licenses"), { recursive: true });
  for (const file of ["LICENSE", "NOTICE"])
    await cp(join(repositoryRoot, file), join(options.target, "licenses", file));
  await writeFile(
    join(options.target, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 2,
        platform: process.platform,
        arch: process.arch,
        productGeneration: generation,
        nodeVersion: "24.21.0",
        postgresVersion: "18.6",
        assembly: {
          hostDigest,
          cliDigest,
          dependencyClosure:
            "Manifest v2 binds the copied Host and CLI payloads including materialized production dependencies",
        },
        installationId,
        managementUnit: services.host.unit,
        gatewayState: "unconfigured",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  const userUnitDirectory = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "systemd/user",
  );
  try {
    await lstat(join(userUnitDirectory, services.host.unit));
    throw new Error(
      "The generated service unit already exists; refusing to replace it",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const autostart = registerService(unitPath, options.autostart);
  console.log(
    JSON.stringify({
      installed: true,
      anchorRoot: options.target,
      installationId,
      command: join(bin, "heptalogos"),
      services,
      autostart,
    }),
  );
}
/** Renders the descriptor-owned native Subject service without a second profile or lifecycle owner. */
export function subjectGatewayServiceUnit({
  node,
  anchorRoot,
  hostUnit,
  nativeEntry,
  prepareEntry,
  profilePath,
  stateRoot,
  passwordFile,
  environmentFile,
  logPath,
}) {
  return `[Unit]\nDescription=Heptalogos Subject Gateway\nRequires=${hostUnit}\nAfter=${hostUnit} network-online.target\nPartOf=${hostUnit}\n\n[Service]\nType=exec\nWorkingDirectory=${anchorRoot.replaceAll("%", "%%")}\nEnvironment=${quoteUnit("OPENCLAW_STATE_DIR=" + stateRoot)}\nEnvironment=${quoteUnit("OPENCLAW_CONFIG_PATH=" + profilePath)}\nExecStartPre=${[node, ...(environmentFile ? ["--env-file=" + environmentFile] : []), prepareEntry, profilePath].map((value) => quoteUnit(value, true)).join(" ")}\nExecStart=${[node, ...(environmentFile ? ["--env-file=" + environmentFile] : []), nativeEntry, "gateway", "run", "--password-file", passwordFile, "--ws-log", "compact"].map((value) => quoteUnit(value, true)).join(" ")}\nUMask=0077\nRestart=on-failure\nRestartSec=5s\nKillSignal=SIGINT\nTimeoutStopSec=45s\nStandardOutput=append:${logPath.replaceAll("%", "%%")}\nStandardError=inherit\n\n[Install]\nWantedBy=default.target ${hostUnit}\n`;
}

/** Configures the one existing Subject slot through its authoritative installation descriptor. */
export async function configureSubjectGateway({ target, environmentFile, autostart }) {
  if (environmentFile) {
    const metadata = await lstat(environmentFile);
    if (
      !isAbsolute(environmentFile) ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0
    )
      throw Error(
        "Subject environment file must be an absolute protected regular file",
      );
  }
  const { locator, descriptorPath, descriptor } =
    await readInstallationServices(target);
  const subject = descriptor.services?.subject;
  if (
    descriptor.schemaVersion !== 1 ||
    descriptor.installationId !== locator.installationId ||
    subject?.identity !== `${locator.installationId}/subject` ||
    !subject.roots
  )
    throw Error("The installed Subject service descriptor is invalid");
  const hostUnit = descriptor.services?.host?.unit;
  for (const name of [subject.unit, hostUnit])
    if (typeof name !== "string" || !/^[A-Za-z0-9@_.-]+\.service$/u.test(name))
      throw Error("The installed service unit identity is invalid");
  for (const root of Object.values(subject.roots))
    if (typeof root !== "string" || !isAbsolute(root))
      throw Error("The installed Subject roots are invalid");
  const state = run(
    "systemctl",
    ["--user", "show", subject.unit, "--property=ActiveState", "--value"],
    10000,
  );
  if (!["inactive", "failed"].includes(state))
    throw Error("Stop the Subject Gateway before configuring its installed service");
  const node = join(target, "runtime/node/bin/node");
  const nativeRoot = join(target, "runtime/openclaw-subject");
  const nativeEntry = join(nativeRoot, "node_modules/openclaw/openclaw.mjs");
  const prepareEntry = join(
    nativeRoot,
    "node_modules/@heptalogos/openclaw-host/dist/prepare-gateway.js",
  );
  const profilePath = join(subject.roots.CONFIGURATION, "openclaw.json");
  const passwordFile = join(subject.roots.SECRET, "gateway-password");
  for (const path of [node, nativeEntry, prepareEntry, profilePath, passwordFile])
    if (!(await lstat(path)).isFile())
      throw Error("The installed Subject Gateway payload is incomplete");
  const prepared = JSON.parse(run(node, [prepareEntry, profilePath], 30000));
  if (prepared.installationId !== descriptor.installationId)
    throw Error("The native profile belongs to another Host installation");
  const unitDirectory = join(locator.roots.CONFIGURATION, "systemd");
  await mkdir(unitDirectory, { recursive: true, mode: 0o700 });
  const unitPath = join(unitDirectory, subject.unit);
  await writeFile(
    unitPath,
    subjectGatewayServiceUnit({
      node,
      anchorRoot: target,
      hostUnit,
      nativeEntry,
      prepareEntry,
      profilePath,
      stateRoot: subject.roots.DATA,
      passwordFile,
      environmentFile,
      logPath: join(subject.roots.RUN, "gateway.log"),
    }),
    { mode: 0o600 },
  );
  const enabled = registerService(unitPath, autostart);
  subject.configured = true;
  if (environmentFile) subject.environmentFile = environmentFile;
  else delete subject.environmentFile;
  const temporary = descriptorPath + ".configured";
  await writeFile(temporary, JSON.stringify(descriptor, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(temporary, descriptorPath);
  console.log(
    JSON.stringify({
      configured: true,
      installationId: descriptor.installationId,
      unit: subject.unit,
      profilePath,
      autostart: enabled,
    }),
  );
}

function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "configure-maintenance") {
      const args = process.argv.slice(3);
      const values = new Map();
      for (let index = 0; index < args.length; index += 2) {
        if (
          ![
            "--target",
            "--environment-file",
            "--source-profile",
            "--model",
            "--port",
            "--autostart",
          ].includes(args[index]) ||
          !args[index + 1] ||
          values.has(args[index])
        )
          throw Error(
            "Usage: install-linux-product.mjs configure-maintenance --target <anchor> --environment-file <private-env> --source-profile <native-profile> --model <provider/model> [--port <port>] [--autostart yes|no]",
          );
        values.set(args[index], args[index + 1]);
      }
      for (const required of [
        "--target",
        "--environment-file",
        "--source-profile",
        "--model",
      ])
        if (!values.has(required))
          throw Error(
            "Maintenance requires explicit installation, environment and model source",
          );
      await configureMaintenanceGateway({
        target: resolve(values.get("--target")),
        environmentFile: resolve(values.get("--environment-file")),
        sourceProfile: resolve(values.get("--source-profile")),
        model: values.get("--model"),
        port: values.has("--port") ? Number(values.get("--port")) : undefined,
        autostart: autostartChoice(values.get("--autostart")),
      });
    } else if (process.argv[2] === "configure-subject-gateway") {
      const values = new Map();
      const args = process.argv.slice(3);
      for (let index = 0; index < args.length; index += 2) {
        if (
          !["--target", "--environment-file", "--autostart"].includes(args[index]) ||
          !args[index + 1] ||
          values.has(args[index])
        )
          throw Error(
            "Expected --target, optional --environment-file and --autostart yes|no",
          );
        values.set(args[index], args[index + 1]);
      }
      if (!values.has("--target")) throw Error("--target is required");
      await configureSubjectGateway({
        target: resolve(values.get("--target")),
        environmentFile: values.has("--environment-file")
          ? resolve(values.get("--environment-file"))
          : undefined,
        autostart: autostartChoice(values.get("--autostart")),
      });
    } else await install(argumentsFrom(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `Linux installation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
