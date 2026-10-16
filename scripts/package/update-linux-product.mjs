// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Updates the installed application generation while preserving lifecycle roots and private runtimes.
 * @module update-linux-product
 */
import { cp, mkdir, readFile, rename, rm, writeFile, lstat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runProcessSync, runProcessSyncChecked } from "@heptalogos/repo-kit";
import {
  ensureArtifactDependencies,
  normalizeCliArtifactManifest,
  verifyPortableLinks,
} from "./assemble-portable-product.mjs";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const run = (command, args) =>
  runProcessSyncChecked(command, args, {
    timeout: 120000,
    stdin: "ignore",
  }).stdout.trim();
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
async function atomic(path, text, mode = 0o600) {
  const staged = path + ".update-" + process.pid;
  await writeFile(staged, text, { mode });
  await rename(staged, path);
}
/** Stages complete source-free artifacts, stops the existing Host, backs up stopped state and selects the new generation. */
export async function updateLinuxProduct(options) {
  if (process.platform !== "linux") throw Error("Use the Linux updater only on Linux");
  const target = resolve(options.target);
  const manifest = await json(join(target, "manifest.json"));
  const locatorText = await readFile(join(target, "heptalogos.bootstrap.json"), "utf8");
  const locator = JSON.parse(locatorText);
  const descriptor = await json(
    join(locator.roots.CONFIGURATION, "installation-services.json"),
  );
  if (
    manifest.installationId !== locator.installationId ||
    descriptor.installationId !== locator.installationId ||
    manifest.managementUnit !== descriptor.services.host.unit
  )
    throw Error("Existing installation identity does not match its service descriptor");
  if (manifest.platform !== "linux" || manifest.arch !== process.arch)
    throw Error("Installed platform does not match this updater");
  const lock = join(target, ".heptalogos-update.lock");
  await mkdir(lock, { mode: 0o700 });
  try {
    const hostArtifact = resolve(
      options.host ?? join(repositoryRoot, "packages/application/product-host/dist"),
    );
    const cliArtifact = resolve(
      options.cli ?? join(repositoryRoot, "packages/application/cli/dist"),
    );
    const hostDigest = await ensureArtifactDependencies(hostArtifact, "product-host");
    const cliDigest = await ensureArtifactDependencies(cliArtifact, "cli");
    const source = await readFile(
      join(hostArtifact, "generated/build-identities.js"),
      "utf8",
    );
    const generation = /PRODUCT_GENERATION_ID = "([0-9a-f]{64})"/u.exec(source)?.[1];
    if (!generation) throw Error("Built generation identity is unavailable");
    if (generation === manifest.productGeneration)
      return { updated: false, installationId: locator.installationId, generation };
    const product = join(target, "program/product", generation);
    const stage = product + ".stage-" + process.pid;
    try {
      await lstat(product);
      throw Error(
        "New generation is already present; inspect it before selecting an existing payload",
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await mkdir(stage, { mode: 0o700 });
    await cp(hostArtifact, stage, { recursive: true, verbatimSymlinks: true });
    await cp(cliArtifact, join(stage, "cli"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    await normalizeCliArtifactManifest(join(stage, "cli"));
    await verifyPortableLinks(stage);
    await rename(stage, product);
    const unitPath = join(
      locator.roots.CONFIGURATION,
      "systemd",
      manifest.managementUnit,
    );
    const unitText = await readFile(unitPath, "utf8");
    const previousProduct = join(target, "program/product", manifest.productGeneration);
    const previousEntry = join(previousProduct, "bin.js");
    if (!unitText.includes(previousEntry))
      throw Error("Installed service does not select its recorded product generation");
    run("systemctl", ["--user", "stop", manifest.managementUnit]);
    if (
      run("systemctl", [
        "--user",
        "show",
        manifest.managementUnit,
        "--property=MainPID",
        "--value",
      ]) !== "0"
    )
      throw Error("The installed Host has not stopped");
    const postgresData = join(locator.roots.DATA, "private-postgres");
    const stopped = runProcessSync(
      join(target, "runtime/postgresql/bin/pg_ctl"),
      ["status", "-D", postgresData],
      { reject: false },
    );
    if (stopped.exitCode !== 3)
      throw Error("Private PostgreSQL must be stopped before copying its data");
    const backup = join(
      locator.roots.BACKUP,
      "product-update-" + new Date().toISOString().replaceAll(":", "-"),
    );
    await mkdir(backup, { recursive: true, mode: 0o700 });
    // The owned Host drains and stops its PostgreSQL before releasing the process.
    for (const root of ["INSTANCE", "DATA", "CONFIGURATION", "SECRET", "BLOB"])
      await cp(locator.roots[root], join(backup, root.toLowerCase()), {
        recursive: true,
        verbatimSymlinks: true,
      });
    await writeFile(join(backup, "heptalogos.bootstrap.json"), locatorText, {
      mode: 0o600,
    });
    await writeFile(
      join(backup, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o600 },
    );
    run(join(target, "runtime/postgresql/bin/pg_controldata"), [
      join(backup, "data/private-postgres"),
    ]);
    const node = join(target, "runtime/node/bin/node");
    const launcher = `#!/bin/sh\nexec ${quote(node)} ${quote(join(product, "cli/bin.js"))} "$@" --anchor-root ${quote(target)}\n`;
    await atomic(unitPath, unitText.replace(previousEntry, join(product, "bin.js")));
    await atomic(join(target, "bin/heptalogos"), launcher, 0o700);
    await atomic(
      join(target, "manifest.json"),
      JSON.stringify(
        {
          ...manifest,
          productGeneration: generation,
          assembly: { ...manifest.assembly, hostDigest, cliDigest },
        },
        null,
        2,
      ) + "\n",
    );
    run("systemctl", ["--user", "daemon-reload"]);
    return {
      updated: true,
      installationId: locator.installationId,
      generation,
      backup,
      started: false,
    };
  } finally {
    await rm(lock, { recursive: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        target: { type: "string" },
        "host-artifact": { type: "string" },
        "cli-artifact": { type: "string" },
      },
    });
    if (!values.target) throw Error("--target is required");
    console.log(
      JSON.stringify(
        await updateLinuxProduct({
          target: values.target,
          host: values["host-artifact"],
          cli: values["cli-artifact"],
        }),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
