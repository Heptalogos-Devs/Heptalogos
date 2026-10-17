// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates operational budgets and consumes the existing private OneBot connection file.
 * @module config
 */
import { readFileSync, lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { compileSchema } from "@heptalogos/schema-runtime";
import { parseOneBotJson, record, nativeId } from "./lossless.js";
/** Shared Host integration exists without a QQ account or transport. */
const hostPluginConfigSchema = Type.Object(
  {
    hostAnchorRoot: Type.String({ minLength: 1 }),
    serviceTokenFile: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
/** Operational plugin configuration contains no recipient authorization or model-facing raw API. */
const qqPluginConfigSchema = Type.Object(
  {
    connectionFile: Type.String({ minLength: 1 }),
    hostAnchorRoot: Type.String({ minLength: 1 }),
    serviceTokenFile: Type.String({ minLength: 1 }),
    mediaTempRoot: Type.String({ minLength: 1 }),
    napcatExportRoots: Type.Array(Type.String({ minLength: 1 }), { maxItems: 16 }),
    requestTimeoutMs: Type.Integer({ minimum: 100, maximum: 60000 }),
    reconnectMinMs: Type.Integer({ minimum: 10, maximum: 60000 }),
    reconnectMaxMs: Type.Integer({ minimum: 10, maximum: 300000 }),
    maxTextBytes: Type.Integer({ minimum: 1, maximum: 65536 }),
    mediaMaxBytes: Type.Integer({ minimum: 1, maximum: 67108864 }),
    mediaConcurrency: Type.Integer({ minimum: 1, maximum: 8 }),
    mediaDailyBytes: Type.Integer({ minimum: 1, maximum: 10737418240 }),
    mediaAllowFakeIpDns: Type.Optional(Type.Boolean()),
    forwardMaxDepth: Type.Integer({ minimum: 0, maximum: 32 }),
    forwardMaxNodes: Type.Integer({ minimum: 1, maximum: 4096 }),
    forwardMaxBytes: Type.Integer({ minimum: 1, maximum: 4194304 }),
    forwardMaxRequests: Type.Integer({ minimum: 0, maximum: 32 }),
    historyPageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    historyMaxPages: Type.Integer({ minimum: 1, maximum: 100 }),
  },
  { additionalProperties: false },
);
/** Strongly typed operational settings, separate from Host-owned effect scope. */
export type QqPluginConfig = Static<typeof qqPluginConfigSchema>;
const validator = compileSchema<QqPluginConfig>(qqPluginConfigSchema);
/** Validates actual bounded settings before transport, filesystem or SDK lifecycle work. */
function parsePluginConfig(value: unknown): QqPluginConfig {
  const result = validator.validate(value);
  if (!result.ok) throw Error("QQ plugin operational configuration is invalid");
  const config = result.value;
  for (const path of [
    config.connectionFile,
    config.hostAnchorRoot,
    config.serviceTokenFile,
    config.mediaTempRoot,
    ...config.napcatExportRoots,
  ])
    if (!isAbsolute(path)) throw Error("QQ operational paths must be absolute");
  if (config.reconnectMaxMs < config.reconnectMinMs)
    throw Error("QQ reconnect budgets are invalid");
  return config;
}
/** One plugin accepts either Host-only input or the complete explicit QQ contract. */
export const nativePluginConfigSchema = Type.Union([
  hostPluginConfigSchema,
  qqPluginConfigSchema,
]);
/** Validated common Host or explicit QQ operational input. */
export type NativePluginConfig = Static<typeof nativePluginConfigSchema>;
const nativeValidator = compileSchema<NativePluginConfig>(nativePluginConfigSchema);
/** Partial or malformed QQ settings never silently become a Host-only setup. */
export function parseNativePluginConfig(value: unknown): NativePluginConfig {
  const result = nativeValidator.validate(value);
  if (!result.ok) throw Error("Host plugin operational configuration is invalid");
  const config = result.value;
  if (!isAbsolute(config.hostAnchorRoot) || !isAbsolute(config.serviceTokenFile))
    throw Error("Host operational paths must be absolute");
  return "connectionFile" in config ? parsePluginConfig(config) : config;
}
function readPrivate(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0))
    throw Error("QQ private input must be a protected regular file");
  return readFileSync(path, "utf8");
}
/** Reads the already-configured url/token/accountId contract without logging or rewriting it. */
export function readConnectionFile(path: string): {
  url: string;
  token: string;
  accountId: string;
} {
  const value = record(parseOneBotJson(readPrivate(path)));
  const accountId = nativeId(value.accountId);
  if (typeof value.url !== "string" || typeof value.token !== "string" || !accountId)
    throw Error("QQ connection file is invalid");
  return { url: value.url, token: value.token, accountId };
}
/** Keeps the service credential in memory only for the generated Host Client. */
export function readServiceToken(path: string): string {
  const value = readPrivate(path).trim();
  if (!value || /\s/u.test(value)) throw Error("Gateway service token file is invalid");
  return value;
}
