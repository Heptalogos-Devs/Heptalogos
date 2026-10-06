// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Encodes and decodes the Bootstrap owner witness with canonical bytes and
 * digest validation so recovery can distinguish authentic durable evidence.
 * @module bootstrap-owner-witness-codec
 */

import {
  canonicalizeJson,
  createProblem,
  digestCanonicalJson,
  parseBootId,
  parseInstant,
  parseUuidV7Id,
  UUID_V7_PATTERN,
  type CanonicalJsonValue,
  type Problem,
} from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import { Type } from "@heptalogos/schema-runtime/typebox";
import { bootstrapDigestSchema } from "./schemas.js";
import { readSchemaVersion } from "./json-shape.js";
import type {
  BootstrapOwnerWitnessBodyV1,
  BootstrapOwnerWitnessEnvelopeV1,
  BootstrapOwnerWitnessParseResult,
} from "./bootstrap-owner-witness-model.js";

/** Names the digest domain so owner witness bytes cannot be reused elsewhere. */
export const BOOTSTRAP_OWNER_WITNESS_DIGEST_DOMAIN =
  "heptalogos.bootstrap-owner-witness/v1";

const witnessSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    phase: Type.Union([
      Type.Literal("ATTEMPT"),
      Type.Literal("OWNER"),
      Type.Literal("RELEASING"),
    ]),
    lockGenerationId: Type.String({ pattern: UUID_V7_PATTERN }),
    bootId: Type.String({ pattern: UUID_V7_PATTERN }),
    pid: Type.Integer({ minimum: 1 }),
    processStartedAtMs: Type.Number({ minimum: 0 }),
    heartbeatMs: Type.Integer({ minimum: 1_000 }),
    createdAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const envelopeSchema = Type.Object(
  {
    witness: witnessSchema,
    digest: bootstrapDigestSchema,
  },
  { additionalProperties: false },
);

const validateEnvelope = compileSchema<BootstrapOwnerWitnessEnvelopeV1>(envelopeSchema);

function problem(
  problemCode: string,
  category: Problem["category"],
  title: string,
  detail: string,
): BootstrapOwnerWitnessParseResult {
  return {
    ok: false,
    problem: createProblem({
      problemCode,
      category,
      retryClass: "manual",
      title,
      detail,
    }),
  };
}

function hasValidIdentities(witness: BootstrapOwnerWitnessBodyV1): boolean {
  return (
    parseUuidV7Id("BootstrapLockGenerationId", witness.lockGenerationId) !==
      undefined && parseBootId(witness.bootId) !== undefined
  );
}

/** Seals an owner witness with the canonical domain-separated digest. */
export function sealBootstrapOwnerWitness(
  witness: BootstrapOwnerWitnessBodyV1,
): BootstrapOwnerWitnessEnvelopeV1 {
  const digest = digestCanonicalJson(
    BOOTSTRAP_OWNER_WITNESS_DIGEST_DOMAIN,
    witness as unknown as CanonicalJsonValue,
  );
  return { witness, digest };
}

/** Parses, validates, and authenticates one persisted owner witness. */
export function parseBootstrapOwnerWitness(
  text: string,
): BootstrapOwnerWitnessParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return problem(
      "bootstrap.owner_witness.invalid_json",
      "integrity",
      "Bootstrap owner witness is not valid JSON",
      "Bootstrap owner witness JSON could not be parsed",
    );
  }

  const version = readSchemaVersion(parsed, "witness");
  if (typeof version === "number" && version > 1) {
    return problem(
      "bootstrap.owner_witness.unsupported_schema",
      "integrity",
      "Bootstrap owner witness schema is newer than this runtime",
      "The BootstrapOwnerWitness schema version is not supported by this runtime",
    );
  }
  if (!validateEnvelope.validate(parsed).ok) {
    return problem(
      "bootstrap.owner_witness.invalid_schema",
      "validation",
      "Bootstrap owner witness does not match its supported schema",
      "Bootstrap owner witness does not match the supported V1 schema",
    );
  }

  const envelope = parsed as BootstrapOwnerWitnessEnvelopeV1;
  if (
    envelope.digest.domain !== BOOTSTRAP_OWNER_WITNESS_DIGEST_DOMAIN ||
    !hasValidIdentities(envelope.witness) ||
    parseInstant(envelope.witness.createdAt) === undefined
  ) {
    return problem(
      "bootstrap.owner_witness.invalid_schema",
      "validation",
      "Bootstrap owner witness identity or time is invalid",
      "Bootstrap owner witness identity and createdAt must use the fixed V1 contract",
    );
  }

  const expected = sealBootstrapOwnerWitness(envelope.witness).digest;
  if (envelope.digest.hex !== expected.hex) {
    return problem(
      "bootstrap.owner_witness.digest_mismatch",
      "integrity",
      "Bootstrap owner witness digest does not match its body",
      "The recorded digest is not the expected domain-separated SHA-256 digest",
    );
  }

  return { ok: true, value: envelope };
}

/** Returns canonical JSON text for a validated owner witness envelope. */
export function canonicalBootstrapOwnerWitnessText(
  envelope: BootstrapOwnerWitnessEnvelopeV1,
): string {
  return canonicalizeJson(envelope as unknown as CanonicalJsonValue);
}
