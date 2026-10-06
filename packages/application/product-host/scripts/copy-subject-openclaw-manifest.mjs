// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(packageRoot, "dist"), { recursive: true });
await copyFile(
  resolve(packageRoot, "src/openclaw.plugin.json"),
  resolve(packageRoot, "dist/openclaw.plugin.json"),
);
