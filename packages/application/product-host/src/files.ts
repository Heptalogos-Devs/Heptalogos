// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns the small atomically published Product Host discovery files. They carry
 * discovery and first-claim material only; canonical PostgreSQL state remains
 * authoritative.
 * @module files
 */

import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  parseBootId,
  parseInstallationId,
  parseInstant,
  parseUuidV7Id,
  type BootId,
  type InstallationId,
  type Instant,
} from "@heptalogos/foundation-contracts";
import type { FirstClaimMaterial } from "@heptalogos/management";
import { asRecord } from "./value-utils.js";

import { writeFileAtomic } from "./atomic-file.js";

/** The descriptor written after the loopback HTTP listener is ready. */
export interface ManagementEndpointDescriptorV1 {
  readonly schemaVersion: 1;
  readonly installationId: InstallationId;
  readonly bootId: BootId;
  readonly origin: string;
}

const ENDPOINT_FILENAME = "management-endpoint.json";
const CLAIM_FILENAME = "management-first-claim.json";

function endpointPath(runRoot: string): string {
  return join(runRoot, ENDPOINT_FILENAME);
}

function claimPath(runRoot: string): string {
  return join(runRoot, CLAIM_FILENAME);
}

function canonicalClaimSecret(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const bytes = Buffer.from(value, "base64url");
    return bytes.byteLength === 32 && bytes.toString("base64url") === value;
  } catch {
    return false;
  }
}

/** Reads a JSON file while treating absence or malformed content as stale. */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** Reads and validates the current local endpoint descriptor. */
export async function readManagementEndpointDescriptor(
  runRoot: string,
): Promise<ManagementEndpointDescriptorV1 | undefined> {
  const value = asRecord(await readJson(endpointPath(runRoot)));
  if (
    value === undefined ||
    value.schemaVersion !== 1 ||
    parseInstallationId(value.installationId) === undefined ||
    parseBootId(value.bootId) === undefined ||
    typeof value.origin !== "string"
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 1,
    installationId: value.installationId as InstallationId,
    bootId: value.bootId as BootId,
    origin: value.origin,
  });
}

/** Reads local first-claim material without treating it as canonical state. */
export async function readFirstClaimMaterial(
  runRoot: string,
): Promise<FirstClaimMaterial | undefined> {
  const value = asRecord(await readJson(claimPath(runRoot)));
  if (
    value === undefined ||
    value.schemaVersion !== 1 ||
    parseUuidV7Id("FirstAdministratorClaimId", value.claimId) === undefined ||
    !canonicalClaimSecret(value.claimSecret) ||
    typeof value.expiresAt !== "string" ||
    parseInstant(value.expiresAt) === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    claimId: value.claimId as FirstClaimMaterial["claimId"],
    claimSecret: value.claimSecret,
    expiresAt: value.expiresAt as Instant,
  });
}

/** Atomically publishes discovery metadata after HTTP begins listening. */
export async function writeManagementEndpointDescriptor(
  runRoot: string,
  descriptor: ManagementEndpointDescriptorV1,
): Promise<void> {
  await writeFileAtomic(endpointPath(runRoot), JSON.stringify(descriptor), {
    encoding: "utf8",
    mode: 0o600,
  });
}

/** Atomically publishes the current plaintext first claim. */
export async function writeFirstClaimMaterial(
  runRoot: string,
  material: FirstClaimMaterial,
): Promise<void> {
  await writeFileAtomic(
    claimPath(runRoot),
    JSON.stringify({
      schemaVersion: 1,
      claimId: material.claimId,
      claimSecret: material.claimSecret,
      expiresAt: material.expiresAt,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
}

/** Removes a descriptor only when it still belongs to the current BootId. */
export async function removeCurrentEndpointDescriptor(
  runRoot: string,
  bootId: BootId,
): Promise<void> {
  const descriptor = await readManagementEndpointDescriptor(runRoot);
  if (descriptor?.bootId !== bootId) return;
  await unlink(endpointPath(runRoot)).catch(() => undefined);
}

/** Removes the local first-claim file after claim or administrator creation. */
export async function removeFirstClaimMaterial(runRoot: string): Promise<void> {
  await unlink(claimPath(runRoot)).catch(() => undefined);
}
