// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shares native systemd value quoting across installed Gateway services.
 * @module service-unit
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Quotes a native systemd unit value without invoking a shell. */
export function quoteUnit(value, command = false) {
  if (/[\r\n\0]/u.test(value))
    throw new Error("A service path contains unsupported control characters");
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%");
  return `"${command ? escaped.replaceAll("$", () => "$$") : escaped}"`;
}

/** Reads the single installer-owned locator and service descriptor without selecting or changing a slot. */
export async function readInstallationServices(target) {
  const locator = JSON.parse(
    await readFile(join(target, "heptalogos.bootstrap.json"), "utf8"),
  );
  const descriptorPath = join(
    locator.roots.CONFIGURATION,
    "installation-services.json",
  );
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  return { locator, descriptorPath, descriptor };
}
