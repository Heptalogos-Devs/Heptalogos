// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Provides the minimal callback-scoped operating-system credential adapter
 * used by Bootstrap and local Management clients.
 * @packageDocumentation
 */

import { AsyncEntry } from "@napi-rs/keyring";
import {
  createProblemError,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

/** Identifies one credential in the operating-system credential store. */
export interface OsCredentialKey {
  readonly service: string;
  readonly account: string;
}

/** Supplies callback-scoped access to an OS credential without a cache. */
export interface OsCredentialStore {
  /** Reports whether the exact credential currently exists. */
  exists(key: OsCredentialKey): Promise<boolean>;
  /** Replaces the exact credential in the OS store. */
  set(key: OsCredentialKey, secret: Uint8Array): Promise<void>;
  /** Deletes the exact credential and reports whether it existed. */
  delete(key: OsCredentialKey): Promise<boolean>;
  /** Loads one credential for the callback and clears the loaded bytes after use. */
  withCredential<T>(
    key: OsCredentialKey,
    use: (secret: Uint8Array) => Promise<T>,
  ): Promise<T>;
}

function invalidKeyProblem(): ProblemError {
  return createProblemError({
    problemCode: "os-credential.invalid_key",
    category: "validation",
    retryClass: "manual",
    title: "OS credential key is invalid",
    detail: "Credential service and account must be non-empty bounded strings",
  });
}

function unavailableProblem(): ProblemError {
  return createProblemError({
    problemCode: "os-credential.unavailable",
    category: "unavailable",
    retryClass: "manual",
    title: "OS credential store is unavailable",
    detail:
      "The operating-system credential store could not complete the requested operation",
  });
}

function missingProblem(): ProblemError {
  return createProblemError({
    problemCode: "os-credential.not_found",
    category: "unavailable",
    retryClass: "manual",
    title: "OS credential was not found",
    detail: "The requested operating-system credential is absent",
  });
}

function assertKey(key: OsCredentialKey): void {
  if (
    typeof key.service !== "string" ||
    typeof key.account !== "string" ||
    key.service.length === 0 ||
    key.account.length === 0 ||
    key.service.length > 256 ||
    key.account.length > 256
  ) {
    throw invalidKeyProblem();
  }
}

function entryFor(key: OsCredentialKey): AsyncEntry {
  try {
    return new AsyncEntry(key.service, key.account);
  } catch {
    throw unavailableProblem();
  }
}

async function loadSecret(key: OsCredentialKey): Promise<Uint8Array | undefined> {
  assertKey(key);
  try {
    const secret = await entryFor(key).getSecret();
    return secret === undefined || secret === null
      ? undefined
      : Uint8Array.from(secret);
  } catch {
    throw unavailableProblem();
  }
}

/** Creates the adopted native OS credential/keyring adapter. */
export function createOsCredentialStore(): OsCredentialStore {
  return Object.freeze({
    async exists(key: OsCredentialKey): Promise<boolean> {
      const secret = await loadSecret(key);
      if (secret === undefined) return false;
      secret.fill(0);
      return true;
    },
    async set(key: OsCredentialKey, secret: Uint8Array): Promise<void> {
      assertKey(key);
      const copy = new Uint8Array(secret);
      try {
        await entryFor(key).setSecret(copy);
      } catch {
        throw unavailableProblem();
      } finally {
        copy.fill(0);
      }
    },
    async delete(key: OsCredentialKey): Promise<boolean> {
      assertKey(key);
      try {
        return await entryFor(key).deleteCredential();
      } catch {
        throw unavailableProblem();
      }
    },
    async withCredential<T>(
      key: OsCredentialKey,
      use: (secret: Uint8Array) => Promise<T>,
    ): Promise<T> {
      const secret = await loadSecret(key);
      if (secret === undefined) throw missingProblem();
      try {
        return await use(secret);
      } finally {
        secret.fill(0);
      }
    },
  });
}
