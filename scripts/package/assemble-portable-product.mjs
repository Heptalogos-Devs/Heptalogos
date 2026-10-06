// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Assembles the current built Product Host and reference CLI into one
 * portable Product root from two already-built application artifacts. Nx owns
 * the build/prune graph; this repository-only assembly step materializes the
 * artifact dependency closure, replaces changed application payloads, and
 * preserves unchanged private runtimes and lifecycle roots.
 * @module assemble-portable-product
 */

import { createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcessSync } from "@heptalogos/repo-kit";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pnpmCommand = "pnpm";
const requiredPostgresTools =
  process.platform === "win32"
    ? [
        "postgres.exe",
        "initdb.exe",
        "pg_ctl.exe",
        "pg_controldata.exe",
        "pg_isready.exe",
      ]
    : ["postgres", "initdb", "pg_ctl", "pg_controldata", "pg_isready"];
const exactOpenClawVersion = "2026.9.1";
const exactOpenClawWireVersion = "4";
const artifactNodeLinker = "hoisted";
const subprocessEnvironment = {
  ...process.env,
  CI: "true",
  FORCE_COLOR: "0",
  NO_COLOR: "1",
};

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (
      (option === "--target" ||
        option === "--host-artifact" ||
        option === "--cli-artifact" ||
        option === "--node-root" ||
        option === "--postgres-root") &&
      (value === undefined || value.startsWith("--"))
    ) {
      fail(`${option} requires one path value`);
    }
    if (
      option === "--target" ||
      option === "--host-artifact" ||
      option === "--cli-artifact" ||
      option === "--node-root" ||
      option === "--postgres-root"
    ) {
      values.set(option, resolve(value));
      index += 1;
      continue;
    }
    if (option === "--incremental") {
      values.set(option, true);
      continue;
    }
    fail(`Unknown option ${String(option)}`);
  }
  for (const option of ["--target", "--node-root", "--postgres-root"]) {
    if (!values.has(option)) fail(`${option} is required`);
  }
  return {
    target: values.get("--target"),
    incremental: values.has("--incremental"),
    hostArtifact:
      values.get("--host-artifact") ??
      resolve(repositoryRoot, "packages/application/product-host/dist"),
    cliArtifact:
      values.get("--cli-artifact") ??
      resolve(repositoryRoot, "packages/application/cli/dist"),
    nodeRoot: values.get("--node-root"),
    postgresRoot: values.get("--postgres-root"),
  };
}

function isInside(parent, child) {
  const parentPath = resolve(parent) + sep;
  const childPath = resolve(child);
  return childPath.startsWith(parentPath);
}

async function requireFile(path, label) {
  try {
    const entry = await lstat(path);
    if (!entry.isFile()) fail(`${label} is not a regular file: ${path}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      fail(`${label} is missing: ${path}`);
    }
    throw error;
  }
}

function run(command, args, cwd) {
  const result = runProcessSync(command, args, {
    cwd,
    env: subprocessEnvironment,
    reject: false,
  });
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  if (result.failed)
    fail(`${command} ${args.join(" ")} exited with ${String(result.exitCode)}`);
}

function probe(command, args, cwd = repositoryRoot) {
  const result = runProcessSync(command, args, {
    cwd,
    env: subprocessEnvironment,
    reject: false,
  });
  if (result.failed) {
    const diagnostics = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .trim()
      .replace(/\s+/gu, " ")
      .slice(-2000);
    fail(
      `Could not verify ${command} ${args.join(" ")}${
        diagnostics === "" ? "" : `: ${diagnostics}`
      }`,
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

async function digestFile(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function digestTree(root, ignoredDirectories = new Set()) {
  const entries = [];
  async function visit(directory, prefix) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = join(directory, child.name);
      const name = prefix === "" ? child.name : `${prefix}/${child.name}`;
      if (child.isDirectory() && ignoredDirectories.has(child.name)) continue;
      if (child.isSymbolicLink()) {
        entries.push({ path: name, link: await readlink(path) });
      } else if (child.isDirectory()) {
        await visit(path, name);
      } else if (child.isFile()) {
        entries.push({ path: name, sha256: await digestFile(path) });
      }
    }
  }
  await visit(root, "");
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

async function digestArtifactInputs(root) {
  return digestTree(root, new Set(["node_modules"]));
}

async function copyDirectory(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    force: true,
    dereference: false,
    verbatimSymlinks: true,
    errorOnExist: false,
  });
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensureArtifactDependencies(artifactRoot, label) {
  await requireFile(join(artifactRoot, "package.json"), `${label} artifact manifest`);
  await requireFile(join(artifactRoot, "pnpm-lock.yaml"), `${label} artifact lockfile`);
  await requireFile(
    join(artifactRoot, "pnpm-workspace.yaml"),
    `${label} artifact workspace settings`,
  );
  await access(join(artifactRoot, "workspace_modules")).catch(() => {
    fail(`${label} artifact workspace modules are missing: ${artifactRoot}`);
  });

  const stateDirectory = join(repositoryRoot, "tmp", "product-artifact-state");
  const statePath = join(stateDirectory, `${label}.json`);
  const inputDigest = await digestArtifactInputs(artifactRoot);
  const previous = await readJsonIfPresent(statePath);
  if (
    previous?.inputDigest === inputDigest &&
    previous?.nodeLinker === artifactNodeLinker &&
    (await pathExists(join(artifactRoot, "node_modules/.modules.yaml")))
  ) {
    return inputDigest;
  }

  // Nx owns the pruned artifact and workspace-module copy. pnpm owns the
  // lockfile reconciliation and dependency materialization inside that artifact.
  run(pnpmCommand, ["install", "--lockfile-only"], artifactRoot);
  run(
    pnpmCommand,
    [
      "install",
      "--prod",
      "--frozen-lockfile",
      `--config.node-linker=${artifactNodeLinker}`,
    ],
    artifactRoot,
  );
  const finalInputDigest = await digestArtifactInputs(artifactRoot);
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({
      schemaVersion: 2,
      inputDigest: finalInputDigest,
      nodeLinker: artifactNodeLinker,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  return finalInputDigest;
}

async function replaceDirectory(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await copyDirectory(source, destination);
}

async function normalizeCliArtifactManifest(root) {
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    typeof manifest.oclif !== "object" ||
    manifest.oclif === null ||
    typeof manifest.oclif.commands !== "object" ||
    manifest.oclif.commands === null
  ) {
    fail(
      `The CLI artifact manifest has no usable oclif command configuration: ${manifestPath}`,
    );
  }
  manifest.oclif.commands = {
    ...manifest.oclif.commands,
    target: "./commands",
  };
  if (typeof manifest.bin === "object" && manifest.bin !== null) {
    manifest.bin = { ...manifest.bin, heptalogos: "./bin.js" };
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function verifyPortableLinks(root) {
  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const path = join(directory, child.name);
      if (child.isSymbolicLink()) {
        const target = resolve(dirname(path), await readlink(path));
        if (!isInside(root, target) && resolve(root) !== target) {
          fail(`Portable dependency link escapes the Product root: ${path}`);
        }
      } else if (child.isDirectory()) {
        await visit(path);
      }
    }
  }
  await visit(root);
}

function runJson(command, args, cwd) {
  const result = runProcessSync(command, args, {
    cwd,
    env: subprocessEnvironment,
    reject: false,
  });
  if (result.failed) {
    fail(`${command} ${args.join(" ")} exited with ${String(result.exitCode)}`);
  }
  try {
    return JSON.parse(result.stdout ?? "");
  } catch (error) {
    throw new Error(
      `Could not parse JSON from ${command} ${args.join(" ")}: ${String(error)}`,
      { cause: error },
    );
  }
}

async function collectPackageLicenses(roots) {
  const packages = new Map();
  for (const root of roots) {
    const byLicense = runJson(
      pnpmCommand,
      ["licenses", "list", "--prod", "--json"],
      root,
    );
    for (const [license, entries] of Object.entries(byLicense)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (
          typeof entry !== "object" ||
          entry === null ||
          typeof entry.name !== "string" ||
          !Array.isArray(entry.versions) ||
          !Array.isArray(entry.paths)
        ) {
          continue;
        }
        for (let index = 0; index < entry.paths.length; index += 1) {
          const packagePath = resolve(String(entry.paths[index]));
          if (!isInside(root, packagePath)) {
            fail(
              `License metadata points outside the deployed Product root: ${packagePath}`,
            );
          }
          const version = String(
            entry.versions[index] ?? entry.versions[0] ?? "unknown",
          );
          const packageJson = join(packagePath, "package.json");
          await requireFile(packageJson, `deployed package manifest for ${entry.name}`);
          const key = `${entry.name}@${version}`;
          if (!packages.has(key)) {
            packages.set(key, {
              name: entry.name,
              version,
              license,
              packageJson: relative(root, packageJson).split(sep).join("/"),
            });
          }
        }
      }
    }
  }
  return [...packages.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
}

async function writeLauncher(target) {
  await mkdir(join(target, "bin"), { recursive: true });
  await cp(
    resolve(repositoryRoot, "scripts/package/portable-launcher.mjs"),
    join(target, "bin", "portable-launcher.mjs"),
  );
  const launcher = `@echo off\r\nsetlocal\r\nset "ROOT=%~dp0.."\r\nset "NODE=%ROOT%\\runtime\\node\\node.exe"\r\nif not exist "%NODE%" (\r\n  echo Portable Node runtime is missing 1>&2\r\n  exit /b 1\r\n)\r\n"%NODE%" "%ROOT%\\bin\\portable-launcher.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n`;
  await writeFile(join(target, "bin", "heptalogos.cmd"), launcher, {
    encoding: "utf8",
    mode: 0o755,
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const targetExists = await pathExists(options.target);
  if (targetExists) {
    if (!options.incremental) {
      fail(
        `Portable Product target must be new unless --incremental is supplied: ${options.target}`,
      );
    }
    const existingManifest = await readJsonIfPresent(
      join(options.target, "manifest.json"),
    );
    if (existingManifest === undefined) {
      fail(`Incremental Product target has no assembly manifest: ${options.target}`);
    }
  }
  await requireFile(
    join(options.nodeRoot, process.platform === "win32" ? "node.exe" : "bin/node"),
    "Node runtime",
  );
  const nodeExecutable = join(
    options.nodeRoot,
    process.platform === "win32" ? "node.exe" : "bin/node",
  );
  const nodeVersion = probe(nodeExecutable, ["--version"]);
  if (nodeVersion !== "v24.20.0")
    fail(`Expected Node v24.20.0, observed ${nodeVersion}`);
  for (const name of requiredPostgresTools) {
    await requireFile(join(options.postgresRoot, "bin", name), `PostgreSQL ${name}`);
  }
  const postgresVersion = probe(
    join(options.postgresRoot, "bin", requiredPostgresTools[0]),
    ["--version"],
  );
  if (!/18\.6/u.test(postgresVersion))
    fail("Expected PostgreSQL 18.6, observed " + postgresVersion);
  await requireFile(
    join(options.hostArtifact, "bin.js"),
    "built Product Host artifact",
  );
  await requireFile(
    join(options.cliArtifact, "bin.js"),
    "built reference CLI artifact",
  );
  const hostArtifactDigest = await ensureArtifactDependencies(
    options.hostArtifact,
    "product-host",
  );
  const cliArtifactDigest = await ensureArtifactDependencies(
    options.cliArtifact,
    "cli",
  );
  const applicationArtifactDigest = createHash("sha256")
    .update(JSON.stringify([hostArtifactDigest, cliArtifactDigest]))
    .digest("hex");
  const productIdentities = join(options.hostArtifact, "generated/build-identities.js");
  await requireFile(productIdentities, "Product Host build identities");
  const identityText = await readFile(productIdentities, "utf8");
  const productGeneration = /PRODUCT_GENERATION_ID = "([0-9a-f]{64})"/u.exec(
    identityText,
  )?.[1];
  const bootstrapGeneration =
    /BOOTSTRAP_RUNTIME_GENERATION_ID = "([0-9a-f]{64})"/u.exec(identityText)?.[1];
  if (productGeneration === undefined || bootstrapGeneration === undefined) {
    fail("Built Product Host identities are missing or invalid");
  }

  const productRoot = join(options.target, "program", "product", productGeneration);
  const cliRoot = join(productRoot, "cli");
  const existingManifest = await readJsonIfPresent(
    join(options.target, "manifest.json"),
  );
  const previousComponents = new Map(
    (Array.isArray(existingManifest?.components) ? existingManifest.components : [])
      .filter((component) => component && typeof component.name === "string")
      .map((component) => [component.name, component]),
  );
  await mkdir(join(options.target, "program", "product"), { recursive: true });
  const applicationNeedsReplacement =
    existingManifest?.assembly?.applicationArtifactDigest !==
      applicationArtifactDigest ||
    !(await pathExists(join(productRoot, "bin.js"))) ||
    !(await pathExists(join(cliRoot, "bin.js")));
  const applicationChanged = applicationNeedsReplacement;
  const nodeNeedsReplacement =
    !targetExists ||
    previousComponents.get("node")?.version !== nodeVersion.slice(1) ||
    previousComponents.get("node")?.digest === undefined ||
    !(await pathExists(join(options.target, "runtime", "node", "node.exe")));
  const postgresNeedsReplacement =
    !targetExists ||
    previousComponents.get("postgresql")?.version !== "18.6" ||
    previousComponents.get("postgresql")?.digest === undefined ||
    !(await pathExists(join(options.target, "runtime", "postgresql", "bin")));
  if (
    targetExists &&
    !applicationNeedsReplacement &&
    !nodeNeedsReplacement &&
    !postgresNeedsReplacement
  ) {
    console.log("PASS portable Product unchanged at " + options.target);
    return;
  }
  if (applicationNeedsReplacement) {
    await replaceDirectory(options.hostArtifact, productRoot);
    await replaceDirectory(options.cliArtifact, cliRoot);
    await normalizeCliArtifactManifest(cliRoot);
  }

  const hostOpenClawPackage = JSON.parse(
    await readFile(join(productRoot, "node_modules/openclaw/package.json"), "utf8"),
  );
  if (hostOpenClawPackage.version !== exactOpenClawVersion) {
    fail(
      `Product deploy did not contain exact OpenClaw ${exactOpenClawVersion}: ${String(hostOpenClawPackage.version)}`,
    );
  }
  await requireFile(
    join(productRoot, "node_modules/openclaw/openclaw.mjs"),
    "deployed OpenClaw executable",
  );
  const gatewayClientPackagePath = join(
    productRoot,
    "node_modules/@openclaw/gateway-client/package.json",
  );
  const gatewayProtocolPackagePath = join(
    productRoot,
    "node_modules/@openclaw/gateway-protocol/package.json",
  );
  await requireFile(gatewayClientPackagePath, "deployed OpenClaw Gateway client");
  await requireFile(gatewayProtocolPackagePath, "deployed OpenClaw Gateway protocol");
  const gatewayClientPackage = JSON.parse(
    await readFile(gatewayClientPackagePath, "utf8"),
  );
  const gatewayProtocolPackage = JSON.parse(
    await readFile(gatewayProtocolPackagePath, "utf8"),
  );
  for (const [label, packageJson] of [
    ["Gateway client", gatewayClientPackage],
    ["Gateway protocol", gatewayProtocolPackage],
  ]) {
    if (packageJson.version !== exactOpenClawVersion) {
      fail(
        `Product deploy did not contain exact OpenClaw ${label} ${exactOpenClawVersion}: ${String(packageJson.version)}`,
      );
    }
  }
  const wireProtocolVersion = applicationChanged
    ? probe(
        nodeExecutable,
        [
          "--input-type=module",
          "--eval",
          'import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol"; console.log(PROTOCOL_VERSION);',
        ],
        productRoot,
      )
    : previousComponents.get("openclaw")?.wireProtocolVersion;
  if (wireProtocolVersion !== exactOpenClawWireVersion) {
    fail(
      `Product deploy did not expose exact OpenClaw wire protocol ${exactOpenClawWireVersion}: ${wireProtocolVersion}`,
    );
  }

  await requireFile(join(productRoot, "bin.js"), "deployed Product Host");
  await requireFile(join(cliRoot, "bin.js"), "deployed reference CLI");
  if (nodeNeedsReplacement) {
    await replaceDirectory(options.nodeRoot, join(options.target, "runtime", "node"));
  }
  if (postgresNeedsReplacement) {
    await rm(join(options.target, "runtime", "postgresql"), {
      recursive: true,
      force: true,
    });
    for (const directory of ["bin", "lib", "share"]) {
      await copyDirectory(
        join(options.postgresRoot, directory),
        join(options.target, "runtime", "postgresql", directory),
      );
    }
  }
  if (!targetExists || applicationChanged) {
    await mkdir(join(options.target, "licenses"), { recursive: true });
    await cp(
      join(options.nodeRoot, "LICENSE"),
      join(options.target, "licenses/node-LICENSE.txt"),
    );
    await cp(
      join(options.postgresRoot, "server_license.txt"),
      join(options.target, "licenses/postgresql-server-license.txt"),
    );
    await cp(
      join(options.postgresRoot, "commandlinetools_3rd_party_licenses.txt"),
      join(options.target, "licenses/postgresql-commandline-third-party.txt"),
    );
  }
  await cp(
    join(repositoryRoot, "LICENSE"),
    join(options.target, "licenses/Heptalogos-AGPL-3.0-only.txt"),
  );
  await cp(
    join(repositoryRoot, "NOTICE"),
    join(options.target, "licenses/Heptalogos-NOTICE.txt"),
  );
  const openclawRoot = await realpath(join(productRoot, "node_modules/openclaw"));
  await cp(
    join(openclawRoot, "LICENSE"),
    join(options.target, "licenses/openclaw-LICENSE.txt"),
  );
  await cp(
    join(openclawRoot, "THIRD_PARTY_NOTICES.md"),
    join(options.target, "licenses/openclaw-THIRD_PARTY_NOTICES.md"),
  );
  if (!targetExists || applicationChanged) {
    await writeFile(
      join(options.target, "licenses/npm-package-license-index.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          packages: await collectPackageLicenses([productRoot, cliRoot]),
        },
        null,
        2,
      ),
      { encoding: "utf8", mode: 0o600 },
    );
  }
  await writeLauncher(options.target);
  if (applicationChanged || nodeNeedsReplacement || postgresNeedsReplacement) {
    await verifyPortableLinks(join(productRoot, "node_modules"));
    await verifyPortableLinks(join(cliRoot, "node_modules"));
  }
  const nodeComponentDigest = nodeNeedsReplacement
    ? await digestTree(join(options.target, "runtime/node"))
    : previousComponents.get("node")?.digest;
  const postgresComponentDigest = postgresNeedsReplacement
    ? await digestTree(join(options.target, "runtime/postgresql"))
    : previousComponents.get("postgresql")?.digest;
  const openclawComponentDigest = applicationChanged
    ? hostArtifactDigest
    : previousComponents.get("openclaw")?.digest;
  const productComponentDigest = applicationChanged
    ? hostArtifactDigest
    : previousComponents.get("product-host")?.digest;
  const cliComponentDigest = applicationChanged
    ? cliArtifactDigest
    : previousComponents.get("reference-cli")?.digest;
  const manifest = {
    schemaVersion: 1,
    productGeneration,
    bootstrapGeneration,
    target: { os: process.platform, arch: process.arch },
    initialization: {
      state: "UNINITIALIZED",
      locator: "created-by-bin/heptalogos.cmd-on-first-run",
      port: "allocated-by-the-launcher-on-first-start-and-persisted-in-BootstrapState",
    },
    openclaw: {
      rootPackageVersion: hostOpenClawPackage.version,
      gatewayClientPackageVersion: gatewayClientPackage.version,
      gatewayProtocolPackageVersion: gatewayProtocolPackage.version,
      wireProtocolVersion,
    },
    assembly: {
      mode: options.incremental ? "development-incremental" : "clean-artifact",
      applicationArtifactDigest,
      packageManager: "pnpm@11.24.0",
      dependencyClosure:
        "Nx @nx/js prune-lockfile + copy-workspace-modules; pnpm lockfile-only reconciliation and hoisted frozen production install inside the application artifact",
    },
    components: [
      {
        name: "node",
        version: nodeVersion.slice(1),
        digest: nodeComponentDigest,
      },
      {
        name: "postgresql",
        version: "18.6",
        digest: postgresComponentDigest,
      },
      {
        name: "openclaw",
        version: hostOpenClawPackage.version,
        gatewayClientVersion: gatewayClientPackage.version,
        gatewayProtocolVersion: gatewayProtocolPackage.version,
        wireProtocolVersion,
        digest: openclawComponentDigest,
      },
      {
        name: "product-host",
        generation: productGeneration,
        digest: productComponentDigest,
      },
      { name: "reference-cli", digest: cliComponentDigest },
      {
        name: "portable-launcher",
        digest: await digestTree(join(options.target, "bin")),
      },
    ],
  };
  await writeFile(
    join(options.target, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  console.log("PASS portable Product assembled at " + options.target);
}

await main();
