// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Gives Nx's flat CLI artifact the same oclif entrypoints used by installers.
 * @module normalize-cli-artifact
 */
import { fileURLToPath } from "node:url";
import { normalizeCliArtifactManifest } from "./assemble-portable-product.mjs";

await normalizeCliArtifactManifest(
  fileURLToPath(new URL("../../packages/application/cli/dist", import.meta.url)),
);
