// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Opens the existing Gateway client only after local administrator authentication for the same installation.
 * @module gateway-access
 */
import { readFile, lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  createGatewayHostClient,
  type GatewayHostClient,
} from "@heptalogos/management-client/gateway";
import type { LocalManagementClient } from "@heptalogos/management-client/node";
import { CliFailure } from "./base-command.js";
/** Uses the OS-keyring authenticated Management client before reading any service credential. */
export async function openOperatorGateway(
  local: LocalManagementClient,
  options: { readonly signal?: AbortSignal; readonly fetch?: typeof fetch } = {},
): Promise<GatewayHostClient> {
  await local.client.getConfiguration();
  let token: string;
  try {
    const locator = JSON.parse(
      await readFile(join(local.anchorRoot, "heptalogos.bootstrap.json"), "utf8"),
    );
    if (
      locator.schemaVersion !== 1 ||
      locator.installationId !== local.installationId ||
      typeof locator.roots?.SECRET !== "string" ||
      !isAbsolute(locator.roots.SECRET)
    )
      throw Error("installation mismatch");
    const path = join(locator.roots.SECRET, "channel-service-token");
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > 4096 ||
      (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
    )
      throw Error("credential not protected");
    token = (await readFile(path, "utf8")).trim();
    if (!token) throw Error("credential empty");
  } catch {
    throw new CliFailure(
      "installation.gateway_credential_unavailable",
      "该安装的受保护 Gateway 服务凭据不可用；请先完成安装配置。",
      4,
    );
  }
  return createGatewayHostClient({
    hostAnchorRoot: local.anchorRoot,
    serviceToken: token,
    ...options,
  });
}
