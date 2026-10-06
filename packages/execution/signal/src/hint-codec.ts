// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Encodes and validates Signal hints through canonical JSON and SchemaRuntime,
 * keeping notification payloads typed, bounded, and non-authoritative.
 * @module hint-codec
 */

import { canonicalizeJson } from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import { Type } from "@heptalogos/schema-runtime/typebox";
import type { SignalTopic } from "./contracts.js";
import { signalProblem } from "./problems.js";

/** PostgreSQL channel carrying non-authoritative signal hints. */
export const SIGNAL_CHANNEL = "heptalogos_signal_v1" as const;
/** Maximum UTF-8 payload size accepted for one signal hint. */
export const SIGNAL_HINT_MAX_BYTES = 512 as const;

const topicShape = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const hintSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    topic: Type.String({ minLength: 1, maxLength: 128, pattern: topicShape.source }),
  },
  { additionalProperties: false },
);
const validateHint = compileSchema<{ schemaVersion: 1; topic: string }>(hintSchema);

/** Versioned, bounded payload carried by a signal notification. */
export interface SignalHintV1 {
  readonly schemaVersion: 1;
  readonly topic: SignalTopic;
}

/** Validate and brand a semantic signal topic for publication or subscription. */
export function createSignalTopic(value: string): SignalTopic {
  if (value.length === 0 || value.length > 128 || !topicShape.test(value)) {
    throw signalProblem(
      "signal.topic.invalid",
      "Signal topic must be a bounded namespaced semantic identifier",
    );
  }
  return value as SignalTopic;
}

/** Parse untrusted input into a signal topic without throwing on invalid data. */
export function parseSignalTopic(value: unknown): SignalTopic | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > 0 && value.length <= 128 && topicShape.test(value)
    ? (value as SignalTopic)
    : undefined;
}

/** Encode a validated hint canonically before it crosses the notification boundary. */
export function encodeSignalHint(hint: SignalHintV1): string {
  const topic = parseSignalTopic(hint.topic);
  if (hint.schemaVersion !== 1 || topic === undefined) {
    throw signalProblem("signal.hint.invalid", "Signal hint does not match schema V1");
  }
  const encoded = canonicalizeJson({ schemaVersion: 1, topic });
  if (new TextEncoder().encode(encoded).byteLength > SIGNAL_HINT_MAX_BYTES) {
    throw signalProblem(
      "signal.hint.too_large",
      "Signal hint exceeds the bounded size",
    );
  }
  return encoded;
}

/** Decode and validate a bounded notification payload into its typed hint. */
export function decodeSignalHint(value: unknown): SignalHintV1 {
  if (typeof value !== "string") {
    throw signalProblem(
      "signal.hint.invalid",
      "Signal notification payload must be text",
    );
  }
  if (new TextEncoder().encode(value).byteLength > SIGNAL_HINT_MAX_BYTES) {
    throw signalProblem(
      "signal.hint.too_large",
      "Signal hint exceeds the bounded size",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw signalProblem(
      "signal.hint.invalid",
      "Signal notification payload is not JSON",
    );
  }
  const result = validateHint.validate(parsed);
  if (!result.ok) {
    throw signalProblem(
      "signal.hint.invalid",
      result.issues.map((issue) => `${issue.instancePath} ${issue.message}`).join("; "),
    );
  }
  const topic = parseSignalTopic(result.value.topic);
  if (topic === undefined) {
    throw signalProblem("signal.topic.invalid", "Signal topic is invalid");
  }
  return Object.freeze({ schemaVersion: 1, topic });
}
