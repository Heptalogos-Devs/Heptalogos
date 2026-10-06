// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns the Node-only local discovery and session-token adapter. It reads only
 * the Bootstrap locator and Host-published RUN descriptors; Management state
 * remains authoritative in the live HTTP service.
 * @module local
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  parseBootId,
  parseInstallationId,
  parseInstant,
  parseUuidV7Id,
  ProblemError,
  type BootId,
  type InstallationId,
  type Instant,
} from "@heptalogos/foundation-contracts";
import {
  createOsCredentialStore,
  type OsCredentialStore,
} from "@heptalogos/os-credential";
import {
  createManagementClient,
  type ManagementClient,
  type ManagementClientOptions,
} from "./client.js";

const LOCATOR_FILENAME = "heptalogos.bootstrap.json";
const ENDPOINT_FILENAME = "management-endpoint.json";
const CLAIM_FILENAME = "management-first-claim.json";
const SESSION_ACCOUNT = "management/current-administrator-session";

/** The Host-published endpoint descriptor consumed by local clients. */
export interface ManagementEndpointDescriptor {
  readonly schemaVersion: 1;
  readonly installationId: InstallationId;
  readonly bootId: BootId;
  readonly origin: string;
}

/** The local first-claim material exposed to the first-administrator command. */
export interface LocalFirstClaim {
  readonly claimId: string;
  readonly claimSecret: string;
  readonly expiresAt: Instant;
}

/** A discovered Management client plus its local credential/discovery helpers. */
export interface LocalManagementClient {
  readonly anchorRoot: string;
  readonly runRoot: string;
  readonly endpoint: ManagementEndpointDescriptor;
  readonly installationId: InstallationId;
  readonly client: ManagementClient;
  /** Reads the local first-claim projection, if it is still published. */
  readFirstClaim(): Promise<LocalFirstClaim | undefined>;
  /** Reads the opaque session token from the OS credential store. */
  readSessionToken(): Promise<string | undefined>;
  /** Stores an opaque session token in the OS credential store. */
  saveSessionToken(token: string): Promise<void>;
  /** Deletes the local opaque session token. */
  deleteSessionToken(): Promise<void>;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function runRootFromAnchor(anchorRoot: string): Promise<string> {
  const locator = objectValue(await readJson(join(anchorRoot, LOCATOR_FILENAME)));
  const roots = objectValue(locator?.roots);
  const runRoot = roots?.RUN;
  if (
    locator?.schemaVersion !== 1 ||
    typeof runRoot !== "string" ||
    !isAbsolute(runRoot)
  ) {
    throw new Error("The local Management locator is invalid");
  }
  return runRoot;
}

async function readEndpoint(runRoot: string): Promise<ManagementEndpointDescriptor> {
  const value = objectValue(await readJson(join(runRoot, ENDPOINT_FILENAME)));
  const installationId =
    value === undefined ? undefined : parseInstallationId(value.installationId);
  const bootId = value === undefined ? undefined : parseBootId(value.bootId);
  if (
    value?.schemaVersion !== 1 ||
    installationId === undefined ||
    bootId === undefined ||
    typeof value.origin !== "string"
  ) {
    throw new Error("The local Management endpoint descriptor is unavailable");
  }
  let origin: URL;
  try {
    origin = new URL(value.origin);
  } catch {
    throw new Error("The local Management endpoint descriptor is invalid");
  }
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error("The local Management endpoint is not a loopback origin");
  }
  return Object.freeze({
    schemaVersion: 1,
    installationId,
    bootId,
    origin: origin.origin,
  });
}

function canonicalToken(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    return false;
  }
  try {
    const bytes = Buffer.from(value, "base64url");
    return bytes.byteLength === 32 && bytes.toString("base64url") === value;
  } catch {
    return false;
  }
}

async function readClaim(runRoot: string): Promise<LocalFirstClaim | undefined> {
  const value = objectValue(await readJson(join(runRoot, CLAIM_FILENAME)));
  if (
    value?.schemaVersion !== 1 ||
    parseUuidV7Id("FirstAdministratorClaimId", value.claimId) === undefined ||
    !canonicalToken(value.claimSecret) ||
    parseInstant(value.expiresAt) === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    claimId: value.claimId as string,
    claimSecret: value.claimSecret,
    expiresAt: value.expiresAt as Instant,
  });
}

function sessionKey(installationId: InstallationId) {
  return {
    service: "Heptalogos/" + installationId,
    account: SESSION_ACCOUNT,
  } as const;
}

/** Discovers the live Host and verifies its well-known identity before use. */
export async function openLocalManagementClient(options: {
  readonly anchorRoot: string;
  readonly sessionToken?: string;
  readonly fetch?: ManagementClientOptions["fetch"];
  readonly credentialStore?: OsCredentialStore;
}): Promise<LocalManagementClient> {
  const runRoot = await runRootFromAnchor(options.anchorRoot);
  const endpoint = await readEndpoint(runRoot);
  const client = createManagementClient({
    origin: endpoint.origin,
    ...(options.sessionToken === undefined
      ? {}
      : { sessionToken: options.sessionToken }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const discovery = await client.getDiscovery();
  if (
    discovery.installationId !== endpoint.installationId ||
    discovery.apiBasePath !== "/management/v1" ||
    discovery.compatibility.coreContractVersion !== "management.v1"
  ) {
    throw new Error(
      "The live Management contract does not match the endpoint descriptor",
    );
  }
  const store = options.credentialStore ?? createOsCredentialStore();
  return Object.freeze({
    anchorRoot: options.anchorRoot,
    runRoot,
    endpoint,
    installationId: endpoint.installationId,
    client,
    readFirstClaim: () => readClaim(runRoot),
    readSessionToken: async () => {
      const bytes = await store
        .withCredential(sessionKey(endpoint.installationId), async (secret) =>
          Uint8Array.from(secret),
        )
        .catch((error: unknown) => {
          if (
            error instanceof ProblemError &&
            error.problem.problemCode === "os-credential.not_found"
          ) {
            return undefined;
          }
          throw error;
        });
      if (bytes === undefined) return undefined;
      try {
        const token = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return canonicalToken(token) ? token : undefined;
      } finally {
        bytes.fill(0);
      }
    },
    saveSessionToken: async (token: string) => {
      if (!canonicalToken(token))
        throw new Error("The Management session token is invalid");
      const bytes = new TextEncoder().encode(token);
      try {
        await store.set(sessionKey(endpoint.installationId), bytes);
      } finally {
        bytes.fill(0);
      }
    },
    deleteSessionToken: async () => {
      await store.delete(sessionKey(endpoint.installationId));
    },
  });
}
