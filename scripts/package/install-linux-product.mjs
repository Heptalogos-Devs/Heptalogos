// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Installs built application artifacts and fixed user-systemd services on Linux.
 * @module install-linux-product
 */
import { runProcessSyncChecked } from "@heptalogos/repo-kit";
import { cp, mkdir, readFile, lstat, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureArtifactDependencies,
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
  ];
  for (let index = 0; index < argv.length; index += 2) {
    if (
      !accepted.includes(argv[index]) ||
      !argv[index + 1] ||
      argv[index + 1].startsWith("--")
    )
      throw new Error(
        "Expected --target, --node-root, --postgres-root and optional --host-artifact/--cli-artifact paths",
      );
    values.set(argv[index], resolve(argv[index + 1]));
  }
  for (const key of ["--target", "--node-root", "--postgres-root"])
    if (!values.has(key)) throw new Error(`${key} is required`);
  return {
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
function quoteUnit(value, command = false) {
  if (/[\r\n\0]/u.test(value))
    throw new Error("A service path contains unsupported control characters");
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%");
  return `"${command ? escaped.replaceAll("$", () => "$$") : escaped}"`;
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
  const hostDigest = await ensureArtifactDependencies(options.host, "product-host");
  const cliDigest = await ensureArtifactDependencies(options.cli, "cli");
  const identityText = await readFile(
    join(options.host, "generated/build-identities.js"),
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
  await cp(options.host, product, { recursive: true, verbatimSymlinks: true });
  await cp(options.cli, cli, { recursive: true, verbatimSymlinks: true });
  await normalizeCliArtifactManifest(cli);
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
        schemaVersion: 1,
        platform: process.platform,
        arch: process.arch,
        productGeneration: generation,
        nodeVersion: "24.21.0",
        postgresVersion: "18.6",
        assembly: {
          hostDigest,
          cliDigest,
          dependencyClosure:
            "Nx prune-lockfile/copy-workspace-modules and frozen pnpm production installation",
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
  run("systemctl", ["--user", "enable", unitPath], 10_000);
  run("systemctl", ["--user", "daemon-reload"], 10_000);
  console.log(
    JSON.stringify({
      installed: true,
      anchorRoot: options.target,
      installationId,
      command: join(bin, "heptalogos"),
      services,
    }),
  );
}
function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await install(argumentsFrom(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `Linux installation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
