// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product Host-local adapter for the adopted atomic file publication package.
 * @module atomic-file
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Signature of the adopted atomic file writer. */
export type AtomicWrite = (
  path: string,
  data: string,
  options?: { readonly encoding?: "utf8"; readonly mode?: number },
) => Promise<void>;

/** Writes one Product Host publication file through the adopted atomic writer. */
export const writeFileAtomic = require("write-file-atomic") as AtomicWrite;
