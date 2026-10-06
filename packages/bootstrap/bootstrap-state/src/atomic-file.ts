// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Writes Bootstrap state through a temporary file and atomic replacement so a
 * crash cannot expose a partially encoded durable record.
 * @module atomic-file
 */

import { createRequire } from "node:module";
import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

const writeFileAtomic = require("write-file-atomic") as (
  filename: string,
  data: string,
  options?: { readonly encoding?: BufferEncoding },
) => Promise<void>;

/** Publishes data atomically and syncs the containing directory where supported. */
export async function writeAtomicPublishedFile(
  filename: string,
  data: string,
): Promise<void> {
  const target = resolve(filename);

  await writeFileAtomic(target, data, { encoding: "utf8" });

  if (process.platform !== "win32") {
    const directory = await open(dirname(target), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
