// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Updates the installed application generation while preserving lifecycle roots and private runtimes.
 * @module update-linux-product
 */
import { cp, mkdir, readFile, rename, rm, writeFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runProcessSync, runProcessSyncChecked } from "@heptalogos/repo-kit";
import { digestTree, verifyPortableLinks } from "./assemble-portable-product.mjs";
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
/** Stages only a manifest-bound frozen payload; it never rebuilds dependencies. */
async function stageFrozenProduct(candidate, stage, platform) {
  const artifact = await json(join(resolve(candidate), "manifest.json"));
  const generation = artifact.productGeneration;
  if (artifact.schemaVersion !== 2)
    throw Error("Frozen candidate must use artifact manifest schemaVersion 2");
  if (
    artifact.target?.os !== platform.os ||
    artifact.target?.arch !== platform.arch ||
    !/^[0-9a-f]{64}$/u.test(generation)
  )
    throw Error("Candidate identity or platform does not match this installation");
  const components = new Map(
    (artifact.components ?? []).map((component) => [component.name, component]),
  );
  const hostDigest = components.get("product-host")?.digest;
  const cliDigest = components.get("reference-cli")?.digest;
  if (!/^[0-9a-f]{64}$/u.test(hostDigest) || !/^[0-9a-f]{64}$/u.test(cliDigest))
    throw Error("Candidate application closure digests are missing");
  const source = join(resolve(candidate), "program/product", generation);
  const verify = async (root) => {
    await verifyPortableLinks(root);
    const identity = await readFile(
      join(root, "generated/build-identities.js"),
      "utf8",
    );
    if (!identity.includes(`PRODUCT_GENERATION_ID = "${generation}"`))
      throw Error("Candidate Host identity does not match its manifest");
    await Promise.all([lstat(join(root, "bin.js")), lstat(join(root, "cli/bin.js"))]);
    if (
      (await digestTree(root)) !== hostDigest ||
      (await digestTree(join(root, "cli"))) !== cliDigest
    )
      throw Error("Candidate application closure does not match its manifest");
  };
  await verify(source);
  await mkdir(stage, { mode: 0o700 });
  try {
    await cp(source, stage, { recursive: true, verbatimSymlinks: true });
    await verify(stage);
    return { generation, hostDigest, cliDigest };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
/** Stages complete source-free artifacts, stops the existing Host, backs up stopped state and selects the new generation. */
export async function updateLinuxProduct(options) {
  if (process.platform !== "linux") throw Error("Use the Linux updater only on Linux");
  if (!options.candidate)
    throw Error("--candidate is required; use one frozen assembled Product artifact");
  const target = resolve(options.target);
  const manifest = await json(join(target, "manifest.json"));
  const locatorText = await readFile(join(target, "heptalogos.bootstrap.json"), "utf8");
  const locator = JSON.parse(locatorText);
  const descriptor = await json(
    join(locator.roots.CONFIGURATION, "installation-services.json"),
  );
  if (![1, 2].includes(manifest.schemaVersion))
    throw Error("Unsupported installed manifest version");
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
  const stage = join(target, "program/product", ".update-stage-" + process.pid);
  let staged = false;
  try {
    const { generation, hostDigest, cliDigest } = await stageFrozenProduct(
      options.candidate,
      stage,
      { os: manifest.platform, arch: manifest.arch },
    );
    staged = true;
    const product = join(target, "program/product", generation);
    const sameGeneration = generation === manifest.productGeneration;
    const existing = await lstat(product).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (
      existing &&
      sameGeneration &&
      (await digestTree(product)) === hostDigest &&
      manifest.schemaVersion === 2 &&
      manifest.assembly?.hostDigest === hostDigest &&
      manifest.assembly?.cliDigest === cliDigest
    ) {
      await rm(stage, { recursive: true });
      return { updated: false, installationId: locator.installationId, generation };
    }
    if (existing && !sameGeneration) {
      await rm(stage, { recursive: true });
      throw Error(
        "New generation is already present; inspect it before selecting an existing payload",
      );
    }
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
    if (sameGeneration && existing) {
      await cp(product, join(backup, "product-payload"), {
        recursive: true,
        verbatimSymlinks: true,
      });
      const replaced = product + ".replaced-" + process.pid;
      await rename(product, replaced);
      try {
        await rename(stage, product);
      } catch (error) {
        await rename(replaced, product);
        throw error;
      }
      await rm(replaced, { recursive: true });
    } else await rename(stage, product);
    const node = join(target, "runtime/node/bin/node");
    const launcher = `#!/bin/sh\nexec ${quote(node)} ${quote(join(product, "cli/bin.js"))} "$@" --anchor-root ${quote(target)}\n`;
    await atomic(unitPath, unitText.replace(previousEntry, join(product, "bin.js")));
    await atomic(join(target, "bin/heptalogos"), launcher, 0o700);
    await atomic(
      join(target, "manifest.json"),
      JSON.stringify(
        {
          ...manifest,
          schemaVersion: 2,
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
    if (staged) await rm(stage, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        target: { type: "string" },
        candidate: { type: "string" },
      },
    });
    if (!values.target) throw Error("--target is required");
    console.log(
      JSON.stringify(
        await updateLinuxProduct({
          target: values.target,
          candidate: values.candidate,
        }),
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
