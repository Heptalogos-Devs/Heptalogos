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
import { readYamlFile, runProcessSync } from "@heptalogos/repo-kit";

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

/** Hashes the exact artifact tree, including dependency bytes and symlink targets. */
export async function digestTree(root, ignoredDirectories = new Set()) {
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

/** Materializes a deployment closure outside compiler output, using the workspace package policy. */
export async function materializeApplicationArtifact(sourceRoot, label) {
  const stateDirectory = join(repositoryRoot, "tmp", "product-artifact-state");
  const statePath = join(stateDirectory, `${label}.json`);
  const artifactRoot = join(repositoryRoot, "tmp", "product-artifacts", label);
  const sourceDigest = await digestArtifactInputs(sourceRoot);
  const previous = await readJsonIfPresent(statePath);
  if (previous?.sourceDigest !== sourceDigest || !(await pathExists(artifactRoot))) {
    await rm(artifactRoot, { recursive: true, force: true });
    await cp(sourceRoot, artifactRoot, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (path) => !relative(sourceRoot, path).split(sep).includes("node_modules"),
    });
  }
  await requireFile(join(artifactRoot, "package.json"), `${label} artifact manifest`);
  const manifestPath = join(artifactRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const workspace = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  let manifestChanged = manifest.packageManager !== workspace.packageManager;
  manifest.packageManager = workspace.packageManager;
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (
      typeof version !== "string" ||
      !version.startsWith("file:") ||
      !version.endsWith(".tgz")
    )
      continue;
    if (isInside(artifactRoot, resolve(artifactRoot, version.slice(5)))) continue;
    const archive = resolve(
      repositoryRoot,
      "packages/application",
      label,
      version.slice(5),
    );
    await requireFile(archive, `official artifact dependency ${name}`);
    const relativePath = `local_path_modules/${await digestFile(archive)}.tgz`;
    await mkdir(join(artifactRoot, "local_path_modules"), { recursive: true });
    await cp(archive, join(artifactRoot, relativePath));
    manifest.dependencies[name] = `file:./${relativePath}`;
    manifestChanged = true;
  }
  if (manifestChanged) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  await requireFile(join(artifactRoot, "pnpm-lock.yaml"), `${label} artifact lockfile`);
  await requireFile(
    join(artifactRoot, "pnpm-workspace.yaml"),
    `${label} artifact workspace settings`,
  );
  const settingsPath = join(artifactRoot, "pnpm-workspace.yaml");
  const settings = readYamlFile(settingsPath);
  const workspacePolicy = readYamlFile(join(repositoryRoot, "pnpm-workspace.yaml"));
  const overrides = workspacePolicy.overrides ?? {};
  if (JSON.stringify(settings.overrides ?? {}) !== JSON.stringify(overrides)) {
    await writeFile(
      settingsPath,
      JSON.stringify({ ...settings, overrides }, null, 2) + "\n",
    );
  }
  await access(join(artifactRoot, "workspace_modules")).catch(() => {
    fail(`${label} artifact workspace modules are missing: ${artifactRoot}`);
  });

  const inputDigest = await digestArtifactInputs(artifactRoot);
  if (
    previous?.schemaVersion === 5 &&
    previous?.sourceDigest === sourceDigest &&
    previous?.inputDigest === inputDigest &&
    previous?.nodeLinker === artifactNodeLinker &&
    (await pathExists(join(artifactRoot, "node_modules/.modules.yaml"))) &&
    previous.outputDigest === (await digestTree(join(artifactRoot, "node_modules")))
  ) {
    return { root: artifactRoot, digest: inputDigest };
  }

  // Nx owns the pruned artifact and workspace-module copy. pnpm owns the
  // lockfile reconciliation and dependency materialization inside that artifact.
  // File-directory dependencies may change without a new package version or
  // lockfile identity. Force-install alone can retain an existing hoisted
  // payload. Cached/Nx-restored dependency bytes can also drift independently
  // from unchanged inputs; rebuild that generated tree when either digest changes.
  await rm(join(artifactRoot, "node_modules"), { recursive: true, force: true });
  run(pnpmCommand, ["install", "--lockfile-only"], artifactRoot);
  run(
    pnpmCommand,
    [
      "install",
      "--force",
      "--prod",
      "--frozen-lockfile",
      `--config.node-linker=${artifactNodeLinker}`,
    ],
    artifactRoot,
  );
  const finalInputDigest = await digestArtifactInputs(artifactRoot);
  const outputDigest = await digestTree(join(artifactRoot, "node_modules"));
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({
      schemaVersion: 5,
      sourceDigest,
      inputDigest: finalInputDigest,
      outputDigest,
      nodeLinker: artifactNodeLinker,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  return { root: artifactRoot, digest: finalInputDigest };
}

async function replaceDirectory(source, destination) {
  await rm(destination, { recursive: true, force: true });
  await copyDirectory(source, destination);
}

/** Rewrites oclif and binary paths for Nx's flat CLI artifact. */
export async function normalizeCliArtifactManifest(root) {
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

/** Rejects dependency links that escape the assembled artifact. */
export async function verifyPortableLinks(root) {
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

/** Retires superseded application code while preserving private runtimes and lifecycle state. */
export async function retirePreviousProductPayloads(target, currentGeneration) {
  if (!/^[0-9a-f]{64}$/u.test(currentGeneration))
    fail("Current product generation is invalid");
  const directory = join(target, "program", "product");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      (entry.isDirectory() || entry.isSymbolicLink()) &&
      /^[0-9a-f]{64}$/u.test(entry.name) &&
      entry.name !== currentGeneration
    ) {
      await rm(join(directory, entry.name), { recursive: true });
    }
  }
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
    const installed = readYamlFile(join(root, "node_modules/.modules.yaml"));
    if (
      installed.nodeLinker !== artifactNodeLinker ||
      typeof installed.hoistedLocations !== "object" ||
      installed.hoistedLocations === null
    ) {
      fail(`Deployed artifact does not contain the required hoisted layout: ${root}`);
    }
    const deployedPackages = new Map();
    const deployedFileVersions = new Map();
    const deployedFileLicenses = new Map();
    for (const [locator, locations] of Object.entries(installed.hoistedLocations)) {
      if (!Array.isArray(locations)) fail("Invalid deployed hoisted package locations");
      for (const location of locations) {
        if (typeof location !== "string") fail("Invalid deployed package location");
        const packagePath = await realpath(resolve(root, location));
        if (!isInside(root, packagePath)) {
          fail(`Deployed package location escapes the Product root: ${packagePath}`);
        }
        const packageJson = join(packagePath, "package.json");
        await requireFile(packageJson, "deployed package manifest");
        const metadata = JSON.parse(await readFile(packageJson, "utf8"));
        if (typeof metadata.name !== "string" || typeof metadata.version !== "string") {
          fail(`Deployed package identity is missing: ${packageJson}`);
        }
        const key = `${metadata.name}@${metadata.version}`;
        if (locator.startsWith(`${metadata.name}@file:`)) {
          const versions = deployedFileVersions.get(metadata.name) ?? new Set();
          versions.add(metadata.version);
          deployedFileVersions.set(metadata.name, versions);
          deployedFileLicenses.set(key, metadata.license);
        }
        const paths = deployedPackages.get(key) ?? new Set();
        paths.add(packagePath);
        deployedPackages.set(key, paths);
      }
    }
    const byLicense = runJson(
      pnpmCommand,
      ["licenses", "list", "--prod", "--json"],
      root,
    );
    for (const [license, entries] of Object.entries(byLicense)) {
      if (!Array.isArray(entries)) fail("Invalid deployed license entries");
      for (const entry of entries) {
        if (
          typeof entry !== "object" ||
          entry === null ||
          typeof entry.name !== "string" ||
          !Array.isArray(entry.versions) ||
          entry.versions.length === 0 ||
          !Array.isArray(entry.paths)
        ) {
          fail("Invalid deployed license package identity");
        }
        // pnpm omits versions for file-directory dependencies. Their exact
        // versions and licenses come from the deployed package manifests.
        const versions = entry.versions.flatMap((version) => {
          if (version !== null) return [String(version)];
          const installedVersions = deployedFileVersions.get(entry.name);
          if (installedVersions === undefined || installedVersions.size === 0) {
            fail(
              `License metadata has no matching deployed file package: ${entry.name}`,
            );
          }
          return [...installedVersions].map((installedVersion) => {
            const key = `${entry.name}@${installedVersion}`;
            if (deployedFileLicenses.get(key) !== license) {
              fail(`Deployed file package license does not match its metadata: ${key}`);
            }
            return installedVersion;
          });
        });
        for (const version of versions) {
          const key = `${entry.name}@${version}`;
          const paths = deployedPackages.get(key);
          if (paths === undefined || paths.size === 0) {
            fail(`License metadata has no matching deployed package identity: ${key}`);
          }
          // pnpm licenses can report a virtual-store path for a hoisted install.
          // Resolve only the exact installed name/version, including nested copies.
          const packageJsons = [...paths]
            .sort((left, right) => left.localeCompare(right))
            .map((path) =>
              relative(root, join(path, "package.json")).split(sep).join("/"),
            );
          if (!packages.has(key)) {
            packages.set(key, {
              name: entry.name,
              version: String(version),
              license,
              packageJson: packageJsons[0],
              packageJsons,
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
  if (nodeVersion !== "v24.21.0")
    fail(`Expected Node v24.21.0, observed ${nodeVersion}`);
  for (const name of requiredPostgresTools) {
    await requireFile(join(options.postgresRoot, "bin", name), `PostgreSQL ${name}`);
  }
  const postgresVersion = probe(
    join(options.postgresRoot, "bin", requiredPostgresTools[0]),
    ["--version"],
  );
  if (!/18\.6/u.test(postgresVersion))
    fail("Expected PostgreSQL 18.6, observed " + postgresVersion);
  const postgresLicenseMaterials =
    process.platform === "win32"
      ? [
          ["server_license.txt", "postgresql-server-license.txt"],
          [
            "commandlinetools_3rd_party_licenses.txt",
            "postgresql-commandline-third-party.txt",
          ],
        ]
      : [
          ["COPYRIGHT", "postgresql/COPYRIGHT"],
          ["LICENSE", "postgresql/LICENSE"],
          ["README.md", "postgresql/README.md"],
        ];
  for (const [source] of postgresLicenseMaterials) {
    await requireFile(
      join(options.postgresRoot, source),
      `PostgreSQL distribution license material ${source}`,
    );
  }
  await requireFile(
    join(options.hostArtifact, "bin.js"),
    "built Product Host artifact",
  );
  await requireFile(
    join(options.cliArtifact, "bin.js"),
    "built reference CLI artifact",
  );
  const hostArtifact = await materializeApplicationArtifact(
    options.hostArtifact,
    "product-host",
  );
  const cliArtifact = await materializeApplicationArtifact(options.cliArtifact, "cli");
  const applicationArtifactDigest = createHash("sha256")
    .update(JSON.stringify([hostArtifact.digest, cliArtifact.digest]))
    .digest("hex");
  const productIdentities = join(hostArtifact.root, "generated/build-identities.js");
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
  let applicationNeedsReplacement =
    existingManifest?.schemaVersion !== 2 ||
    existingManifest?.assembly?.applicationArtifactDigest !==
      applicationArtifactDigest ||
    !(await pathExists(join(productRoot, "bin.js"))) ||
    !(await pathExists(join(cliRoot, "bin.js")));
  const nodeNeedsReplacement =
    !targetExists ||
    previousComponents.get("node")?.version !== nodeVersion.slice(1) ||
    previousComponents.get("node")?.digest === undefined ||
    !(await pathExists(
      join(
        options.target,
        "runtime",
        "node",
        process.platform === "win32" ? "node.exe" : "bin/node",
      ),
    ));
  const postgresNeedsReplacement =
    !targetExists ||
    previousComponents.get("postgresql")?.version !== "18.6" ||
    previousComponents.get("postgresql")?.digest === undefined ||
    !(await pathExists(join(options.target, "runtime", "postgresql", "bin")));
  let existingPayloadDigests = !applicationNeedsReplacement
    ? await Promise.all([digestTree(productRoot), digestTree(cliRoot)])
    : undefined;
  if (
    existingPayloadDigests &&
    (previousComponents.get("product-host")?.digest !== existingPayloadDigests[0] ||
      previousComponents.get("reference-cli")?.digest !== existingPayloadDigests[1])
  ) {
    // Never bless drift in a prior payload by merely resealing its manifest.
    applicationNeedsReplacement = true;
    existingPayloadDigests = undefined;
  }
  const applicationChanged = applicationNeedsReplacement;
  if (
    targetExists &&
    !applicationNeedsReplacement &&
    !nodeNeedsReplacement &&
    !postgresNeedsReplacement &&
    previousComponents.get("product-host")?.digest === existingPayloadDigests?.[0] &&
    previousComponents.get("reference-cli")?.digest === existingPayloadDigests?.[1]
  ) {
    await retirePreviousProductPayloads(options.target, productGeneration);
    console.log("PASS portable Product unchanged at " + options.target);
    return;
  }
  if (applicationNeedsReplacement) {
    await replaceDirectory(hostArtifact.root, productRoot);
    await replaceDirectory(cliArtifact.root, cliRoot);
    await normalizeCliArtifactManifest(cliRoot);
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
    for (const [source, destination] of postgresLicenseMaterials) {
      const target = join(options.target, "licenses", destination);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(options.postgresRoot, source), target);
    }
  }
  await cp(
    join(repositoryRoot, "LICENSE"),
    join(options.target, "licenses/Heptalogos-AGPL-3.0-only.txt"),
  );
  await cp(
    join(repositoryRoot, "NOTICE"),
    join(options.target, "licenses/Heptalogos-NOTICE.txt"),
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
  // The frozen manifest binds the actual assembled code and node_modules,
  // rather than the mutable source/prune inputs used for incremental builds.
  const productComponentDigest =
    existingPayloadDigests?.[0] ?? (await digestTree(productRoot));
  const cliComponentDigest = existingPayloadDigests?.[1] ?? (await digestTree(cliRoot));
  const manifest = {
    schemaVersion: 2,
    productGeneration,
    bootstrapGeneration,
    target: { os: process.platform, arch: process.arch },
    initialization: {
      state: "UNINITIALIZED",
      locator: "created-by-bin/heptalogos.cmd-on-first-run",
      port: "allocated-by-the-launcher-on-first-start-and-persisted-in-BootstrapState",
    },
    gateways: {
      subject: { state: "unconfigured", owner: "independent subject Gateway artifact" },
      maintenance: {
        state: "unconfigured",
        owner: "independent maintenance Gateway artifact",
      },
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
  await retirePreviousProductPayloads(options.target, productGeneration);
  console.log("PASS portable Product assembled at " + options.target);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
