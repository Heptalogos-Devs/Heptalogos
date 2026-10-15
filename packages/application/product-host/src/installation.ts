// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Creates one installation locator without replacing an existing identity or state.
 * @module installation
 */
// Register lock cleanup before the atomic writer's signal-exit adapter.
import lockfile from "@bybrave/proper-lockfile2";
import { lstat, mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  createInstallationId,
  createInstanceId,
  LIFECYCLE_ROOT_IDS,
} from "@heptalogos/foundation-contracts";
import {
  loadBootstrapLocator,
  type BootstrapLocatorV1,
} from "@heptalogos/bootstrap-runtime";
import { writeFileAtomic } from "./atomic-file.js";

/** Initializes once under the installation lock and atomically publishes the complete locator. */
export async function initializeProductInstallation(
  anchorRoot: string,
): Promise<BootstrapLocatorV1> {
  if (!isAbsolute(anchorRoot)) throw new Error("Installation root must be absolute");
  const root = resolve(anchorRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(root, {
    lockfilePath: join(root, ".heptalogos-initialize.lock"),
    stale: 10_000,
    retries: { retries: 150, minTimeout: 50, maxTimeout: 100 },
  });
  try {
    const path = join(root, "heptalogos.bootstrap.json");
    let exists = true;
    try {
      await lstat(path);
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
      exists = false;
    }
    if (exists) return await loadBootstrapLocator(root);
    const roots = Object.fromEntries(
      LIFECYCLE_ROOT_IDS.map((id) => [
        id,
        id === "PROGRAM" ? root : join(root, id.toLowerCase()),
      ]),
    ) as Record<(typeof LIFECYCLE_ROOT_IDS)[number], string>;
    for (const directory of Object.values(roots))
      await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFileAtomic(
      path,
      JSON.stringify(
        {
          schemaVersion: 1,
          installationId: createInstallationId(),
          instanceId: createInstanceId(),
          roots,
        },
        null,
        2,
      ) + "\n",
      { encoding: "utf8", mode: 0o600 },
    );
    return await loadBootstrapLocator(root);
  } finally {
    await release();
  }
}
