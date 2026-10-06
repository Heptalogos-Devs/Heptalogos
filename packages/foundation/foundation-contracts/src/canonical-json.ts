// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns deterministic JSON canonicalization used by digests and durable
 * envelopes so equivalent values produce identical persisted bytes.
 * @module canonical-json
 */

import canonicalize from "canonicalize";

/** Describes the recursively supported JSON value domain for canonicalization. */
export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

/** Captures canonical bytes and their detached immutable value snapshot. */
export interface CanonicalJsonSnapshot {
  readonly value: CanonicalJsonValue;
  readonly canonical: string;
  readonly utf8ByteLength: number;
}

function assertCanonicalJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonical JSON requires a finite number at ${path}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertCanonicalJsonValue(item, `${path}[${index}]`);
    }
    return;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`canonical JSON requires plain objects at ${path}`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new TypeError(`canonical JSON requires string keys at ${path}`);
      }
      assertCanonicalJsonValue(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    }
    return;
  }

  throw new TypeError(`unsupported canonical JSON value at ${path}`);
}

/** Serializes a validated JSON value using the adopted canonicalization route. */
export function canonicalizeJson(value: CanonicalJsonValue): string {
  assertCanonicalJsonValue(value, "$.");
  const serialized = canonicalize(value);
  if (typeof serialized !== "string") {
    throw new TypeError("canonical JSON serializer returned no representation");
  }
  return serialized;
}

function deepFreeze(value: CanonicalJsonValue): CanonicalJsonValue {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }
  return value;
}

/** Canonicalizes and freezes a value for stable reuse and digest computation. */
export function snapshotCanonicalJson(
  value: CanonicalJsonValue,
): CanonicalJsonSnapshot {
  const canonical = canonicalizeJson(value);
  const detached = JSON.parse(canonical) as CanonicalJsonValue;
  const snapshot = {
    value: deepFreeze(detached),
    canonical,
    utf8ByteLength: new TextEncoder().encode(canonical).byteLength,
  };
  return Object.freeze(snapshot);
}
