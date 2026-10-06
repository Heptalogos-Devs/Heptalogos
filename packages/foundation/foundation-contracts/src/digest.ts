// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Computes content digests from canonical JSON, keeping hash-domain input
 * stable across persistence, evidence, and identity projections.
 * @module digest
 */

import { createHash } from "node:crypto";
import { canonicalizeJson, type CanonicalJsonValue } from "./canonical-json.js";

/** Describes a SHA-256 digest together with its canonicalization domain. */
export interface Sha256Digest {
  readonly algorithm: "sha256";
  readonly canonicalization: "RFC8785-JCS";
  readonly domain: string;
  readonly hex: string;
}

/** Hashes canonical JSON with an explicit domain to prevent cross-purpose reuse. */
export function digestCanonicalJson(
  domain: string,
  payload: CanonicalJsonValue,
): Sha256Digest {
  if (domain.length === 0) {
    throw new TypeError("digest domain must not be empty");
  }

  const envelope: CanonicalJsonValue = {
    domain,
    canonicalization: "RFC8785-JCS",
    hashAlgorithm: "sha256",
    payload,
  };
  const hex = createHash("sha256")
    .update(canonicalizeJson(envelope), "utf8")
    .digest("hex");

  return {
    algorithm: "sha256",
    canonicalization: "RFC8785-JCS",
    domain,
    hex,
  };
}
