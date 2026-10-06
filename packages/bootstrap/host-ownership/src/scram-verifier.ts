// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Encodes PostgreSQL SCRAM-SHA-256 verifiers from secret bytes without exposing
 * plaintext credentials or moving password policy into higher-level services.
 * @module scram-verifier
 */

import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import {
  HOST_LEASE_SCRAM_ITERATIONS,
  HOST_LEASE_SCRAM_SALT_BYTES,
  type PostgresScramVerifierOptions,
} from "./contracts.js";

const MIN_HOST_LEASE_PASSWORD_BYTES = 32;
const MAX_HOST_LEASE_PASSWORD_BYTES = 128;
const SCRAM_KEY_BYTES = 32;

function assertAsciiPassword(passwordAscii: Uint8Array): void {
  if (
    passwordAscii.byteLength < MIN_HOST_LEASE_PASSWORD_BYTES ||
    passwordAscii.byteLength > MAX_HOST_LEASE_PASSWORD_BYTES
  ) {
    throw new TypeError(
      `Host lease password must be ${MIN_HOST_LEASE_PASSWORD_BYTES}..${MAX_HOST_LEASE_PASSWORD_BYTES} bytes`,
    );
  }

  for (const byte of passwordAscii) {
    if (byte < 0x21 || byte > 0x7e) {
      throw new TypeError(
        "Host lease password must contain printable ASCII bytes excluding space",
      );
    }
  }
}

function assertScramOptions(options: PostgresScramVerifierOptions): void {
  if (options.iterations !== HOST_LEASE_SCRAM_ITERATIONS) {
    throw new TypeError(
      `Host lease SCRAM iterations must be ${HOST_LEASE_SCRAM_ITERATIONS}`,
    );
  }
  if (options.salt.byteLength !== HOST_LEASE_SCRAM_SALT_BYTES) {
    throw new TypeError(
      `Host lease SCRAM salt must be ${HOST_LEASE_SCRAM_SALT_BYTES} bytes`,
    );
  }
}

function hmacSha256(key: Uint8Array, value: string): Uint8Array {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function base64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

/** Encodes a PostgreSQL SCRAM verifier from a validated secret and salt. */
export function encodePostgresScramSha256Verifier(
  passwordAscii: Uint8Array,
  options: PostgresScramVerifierOptions,
): string {
  assertAsciiPassword(passwordAscii);
  assertScramOptions(options);

  const saltedPassword = pbkdf2Sync(
    passwordAscii,
    options.salt,
    options.iterations,
    SCRAM_KEY_BYTES,
    "sha256",
  );
  const clientKey = hmacSha256(saltedPassword, "Client Key");
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = hmacSha256(saltedPassword, "Server Key");

  return `SCRAM-SHA-256$${options.iterations}:${base64(options.salt)}$${base64(storedKey)}:${base64(serverKey)}`;
}

/** Checks a secret against a PostgreSQL SCRAM-SHA-256 verifier. */
export function matchesPostgresScramSha256Verifier(
  passwordAscii: Uint8Array,
  verifier: string | null | undefined,
): boolean {
  if (typeof verifier !== "string") return false;
  const match = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):([^:]+)$/u.exec(verifier);
  if (match === null) return false;

  const iterations = Number(match[1]);
  const salt = Buffer.from(match[2], "base64");
  if (
    !Number.isSafeInteger(iterations) ||
    salt.byteLength !== HOST_LEASE_SCRAM_SALT_BYTES
  ) {
    return false;
  }

  let expected: string;
  try {
    expected = encodePostgresScramSha256Verifier(passwordAscii, {
      iterations,
      salt,
    });
  } catch {
    return false;
  }
  return expected === verifier;
}
