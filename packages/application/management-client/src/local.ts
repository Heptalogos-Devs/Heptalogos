// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns the Node-only local discovery and session-token adapter. It reads only
 * the Bootstrap locator and Host-published RUN descriptors; Management state
 * remains authoritative in the live HTTP service.
 * @module local
 */

import { objectValue, readJson } from "./json.js";
import { join } from "node:path";
import {
  parseInstant,
  parseUuidV7Id,
  ProblemError,
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

import {
  createLocalManagementEndpointReader,
  type ManagementEndpointDescriptor,
} from "./discovery.js";
export type { ManagementEndpointDescriptor } from "./discovery.js";

const CLAIM_FILENAME = "management-first-claim.json";
const SESSION_ACCOUNT = "management/current-administrator-session";

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
  readonly signal?: AbortSignal;
}): Promise<LocalManagementClient> {
  const { runRoot, endpoint } =
    await createLocalManagementEndpointReader(options).read();
  const client = createManagementClient({
    origin: endpoint.origin,
    signal: options.signal,
    ...(options.sessionToken === undefined
      ? {}
      : { sessionToken: options.sessionToken }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
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
