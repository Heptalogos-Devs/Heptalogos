// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Encodes and decodes the compact lineage context reference used at durable
 * boundaries, rejecting malformed identity data before it becomes evidence.
 * @module lineage-context-ref
 */

import {
  parseActivityId,
  parseContinuityEpochId,
  parseInstanceId,
  UUID_V7_PATTERN,
} from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import { Type } from "@heptalogos/schema-runtime/typebox";
import type { LineageContextRefV1 } from "./contracts.js";
import { invalidContextRefProblem } from "./problems.js";

const telemetrySchema = Type.Object(
  {
    traceId: Type.String({ minLength: 1 }),
    spanId: Type.String({ minLength: 1 }),
    traceFlags: Type.Integer({ minimum: 0, maximum: 255 }),
  },
  { additionalProperties: false },
);

/** Canonical wire schema for a versioned lineage context reference. */
export const lineageContextRefSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    sourceActivityId: Type.String({ pattern: UUID_V7_PATTERN }),
    sourceInstanceId: Type.String({ pattern: UUID_V7_PATTERN }),
    sourceContinuityEpochId: Type.String({ pattern: UUID_V7_PATTERN }),
    telemetry: Type.Optional(telemetrySchema),
  },
  { additionalProperties: false },
);

const validateLineageContextRef = compileSchema<LineageContextRefV1>(
  lineageContextRefSchema,
);

function freezeRef(value: LineageContextRefV1): LineageContextRefV1 {
  const telemetry = value.telemetry ? Object.freeze({ ...value.telemetry }) : undefined;
  return Object.freeze({
    schemaVersion: 1 as const,
    sourceActivityId: value.sourceActivityId,
    sourceInstanceId: value.sourceInstanceId,
    sourceContinuityEpochId: value.sourceContinuityEpochId,
    ...(telemetry ? { telemetry } : {}),
  });
}

/** Decodes and validates a durable lineage context reference. */
export function decodeLineageContextRef(value: unknown): LineageContextRefV1 {
  const result = validateLineageContextRef.validate(value);
  if (!result.ok) {
    throw invalidContextRefProblem(
      result.issues.map((issue) => `${issue.instancePath} ${issue.message}`).join("; "),
    );
  }

  const sourceActivityId = parseActivityId(result.value.sourceActivityId);
  const sourceInstanceId = parseInstanceId(result.value.sourceInstanceId);
  const sourceContinuityEpochId = parseContinuityEpochId(
    result.value.sourceContinuityEpochId,
  );
  if (!sourceActivityId || !sourceInstanceId || !sourceContinuityEpochId) {
    throw invalidContextRefProblem(
      "Lineage context reference identities must be UUIDv7",
    );
  }

  return freezeRef({
    schemaVersion: 1,
    sourceActivityId,
    sourceInstanceId,
    sourceContinuityEpochId,
    ...(result.value.telemetry ? { telemetry: result.value.telemetry } : {}),
  });
}

/** Encodes a lineage context reference as canonical bounded JSON. */
export function encodeLineageContextRef(
  value: LineageContextRefV1,
): LineageContextRefV1 {
  return decodeLineageContextRef(value);
}
