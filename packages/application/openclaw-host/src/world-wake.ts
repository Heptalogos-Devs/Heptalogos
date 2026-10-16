#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** One deterministic scheduler callback into the authenticated Host owner. @module world-wake */
import { readFile, lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createLocalManagementEndpointReader } from "@heptalogos/management-client/discovery";
/** Scheduler data contains a secret file reference, never the service token itself. */
export interface WorldWake {
  readonly hostAnchorRoot: string;
  readonly installationId: string;
  readonly credentialFile: string;
  readonly request: {
    subjectId: string;
    worldId: string;
    activityId: string;
    requestId: string;
  };
}
/** Validates a Host-authored local wake. Generic remote callbacks are outside this surface. */
export function validateWorldWake(value: unknown): WorldWake {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("invalid_world_wake");
  const input = value as WorldWake;
  if (
    !isAbsolute(input.hostAnchorRoot) ||
    !isAbsolute(input.credentialFile) ||
    !/^[0-9a-f-]{36}$/i.test(input.installationId)
  )
    throw Error("invalid_world_wake");
  for (const key of ["subjectId", "worldId", "activityId", "requestId"] as const)
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.request?.[key],
      )
    )
      throw Error("invalid_world_wake");
  return input;
}
/** Uses the existing private service credential; no model or QQ process is started. */
export async function wakeWorld(value: unknown) {
  const input = validateWorldWake(value);
  const current = await createLocalManagementEndpointReader({
    anchorRoot: input.hostAnchorRoot,
  }).read();
  if (current.installationId !== input.installationId)
    throw Error("world_wake_installation_changed");
  const stat = await lstat(input.credentialFile);
  if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0))
    throw Error("world_wake_credential_invalid");
  const token = (await readFile(input.credentialFile, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error("world_wake_credential_invalid");
  const result = await fetch(
    new URL("/gateway/v1/world/advance", current.endpoint.origin),
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(input.request),
      signal: AbortSignal.timeout(600000),
      redirect: "error",
    },
  );
  if (!result.ok) throw Error("world_wake_host_rejected");
  await result.body?.cancel();
  return { status: "processed" as const };
}
