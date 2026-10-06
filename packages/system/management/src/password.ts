// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns Management password normalization and Node 24 Argon2id mechanics. Plaintext
 * exists only for the duration of the caller's in-process authentication flow.
 * @module password
 */

import { argon2, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { managementProblem } from "./problems.js";
import type { AdministratorVerifier, ManagementDigest } from "./contracts.js";

/** The Argon2id parameters stored with every current Administrator verifier. */
export const ARGON2_PARAMETERS = Object.freeze({
  memory: 65_536,
  passes: 3,
  parallelism: 2,
  tagLength: 32,
} as const);

/** The canonical password normalization identifier stored with the verifier. */
export const PASSWORD_NORMALIZATION_ID = "NFKC-v1" as const;

function passwordPolicyProblem(): never {
  throw managementProblem(
    "management.invalid_input",
    "Administrator password is invalid",
    "Administrator password must contain 15 to 256 Unicode code points after NFKC normalization",
    "validation",
  );
}

/** Normalizes and validates a password without imposing character classes. */
export function normalizeAdministratorPassword(password: string): string {
  if (typeof password !== "string") return passwordPolicyProblem();
  const normalized = password.normalize("NFKC");
  const codePoints = Array.from(normalized).length;
  if (codePoints < 15 || codePoints > 256) return passwordPolicyProblem();
  return normalized;
}

function derive(message: string, salt: Uint8Array, nonce: Uint8Array): Promise<Buffer> {
  const messageBytes = Buffer.from(message, "utf8");
  const saltBytes = Buffer.from(salt);
  const nonceBytes = Buffer.from(nonce);
  return new Promise<Buffer>((resolve, reject) => {
    try {
      argon2(
        "argon2id",
        {
          message: messageBytes,
          nonce: nonceBytes,
          associatedData: saltBytes,
          ...ARGON2_PARAMETERS,
        },
        (error, derivedKey) => {
          messageBytes.fill(0);
          saltBytes.fill(0);
          nonceBytes.fill(0);
          if (error !== null) reject(error);
          else resolve(derivedKey);
        },
      );
    } catch (error) {
      messageBytes.fill(0);
      saltBytes.fill(0);
      nonceBytes.fill(0);
      reject(error);
    }
  });
}

/** Hashes one normalized password with fresh salt and nonce values. */
export async function hashAdministratorPassword(password: string): Promise<{
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
  readonly verifier: Uint8Array;
}> {
  const salt = randomBytes(16);
  const nonce = randomBytes(16);
  try {
    const verifier = await derive(password, salt, nonce);
    try {
      return Object.freeze({
        salt: Uint8Array.from(salt),
        nonce: Uint8Array.from(nonce),
        verifier: Uint8Array.from(verifier),
      });
    } finally {
      verifier.fill(0);
    }
  } finally {
    salt.fill(0);
    nonce.fill(0);
  }
}

/** Verifies one normalized password against the stored Argon2id record. */
export async function verifyAdministratorPassword(
  password: string,
  verifier: AdministratorVerifier,
): Promise<boolean> {
  if (
    verifier.passwordAlgorithm !== "argon2id" ||
    verifier.passwordNormalizationId !== PASSWORD_NORMALIZATION_ID ||
    verifier.passwordMemoryCost !== ARGON2_PARAMETERS.memory ||
    verifier.passwordTimeCost !== ARGON2_PARAMETERS.passes ||
    verifier.passwordParallelism !== ARGON2_PARAMETERS.parallelism ||
    verifier.passwordVerifier.byteLength !== ARGON2_PARAMETERS.tagLength
  ) {
    return false;
  }
  let stored: Buffer | undefined;
  try {
    const derived = await derive(
      password,
      verifier.passwordSalt,
      verifier.passwordNonce,
    );
    try {
      stored = Buffer.from(verifier.passwordVerifier);
      return (
        derived.byteLength === stored.byteLength && timingSafeEqual(derived, stored)
      );
    } finally {
      derived.fill(0);
      stored?.fill(0);
    }
  } catch {
    return false;
  }
}

/** Creates an opaque random base64url token for a claim or session. */
export function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Computes the raw SHA-256 digest stored for a Management secret. */
export function digestManagementSecret(value: string): ManagementDigest {
  return createHash("sha256").update(value, "utf8").digest("hex") as ManagementDigest;
}
