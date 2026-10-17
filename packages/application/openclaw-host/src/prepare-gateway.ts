#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Prepares this installation's native profile from the same verified Host discovery used by the Channel.
 * @module prepare-gateway
 */
import { readFile, writeFile, rename, lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalManagementEndpointReader } from "@heptalogos/management-client/discovery";
import { parseNativePluginConfig, readServiceToken } from "./config.js";
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || !value || Array.isArray(value))
    throw Error("Native Subject Gateway profile is invalid");
  return value as Record<string, unknown>;
}
/** Prepares the same real Host bridge for QQ and Host-only installations. */
export async function prepareQqGateway(
  profilePath: string,
): Promise<{ installationId: string; bootId: string; origin: string }> {
  const path = resolve(profilePath);
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
  )
    throw Error("Native profile must be a protected regular file");
  const profile = object(JSON.parse(await readFile(path, "utf8")) as unknown);
  const plugins = object(profile.plugins);
  const entries = object(plugins.entries);
  const config = parseNativePluginConfig(object(entries["heptalogos-qq"]).config);
  const current = await createLocalManagementEndpointReader({
    anchorRoot: config.hostAnchorRoot,
  }).read();
  const bridge = object(object(object(entries["nous-cognition"]).config).hostBridge);
  if (typeof bridge.credentialFile !== "string" || !isAbsolute(bridge.credentialFile))
    throw Error(
      "Native Subject Gateway requires its configured Nous Host bridge credential file",
    );
  readServiceToken(bridge.credentialFile);
  if (bridge.origin !== current.endpoint.origin) {
    bridge.origin = current.endpoint.origin;
    const temporary = path + ".prepared";
    await writeFile(temporary, JSON.stringify(profile, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(temporary, path);
  }
  return {
    installationId: current.installationId,
    bootId: current.endpoint.bootId,
    origin: current.endpoint.origin,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3)
    throw Error("Usage: heptalogos-qq-prepare <native-profile-path>");
  console.log(JSON.stringify(await prepareQqGateway(process.argv[2]!)));
}
