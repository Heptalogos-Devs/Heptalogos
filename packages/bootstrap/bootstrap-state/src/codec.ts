// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Seals and parses BootstrapState envelopes using canonical JSON and strict
 * schema validation; malformed or mismatched revisions fail explicitly.
 * @module codec
 */

import {
  createProblem,
  digestCanonicalJson,
  type CanonicalJsonValue,
  type Problem,
  SHA256_HEX_PATTERN,
  UUID_V7_PATTERN,
} from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import { Type } from "@heptalogos/schema-runtime/typebox";
import { bootstrapDigestSchema } from "./schemas.js";
import { readSchemaVersion } from "./json-shape.js";
import type {
  BootstrapStateBody,
  BootstrapStateBodyV1,
  BootstrapStateEnvelope,
  BootstrapStateEnvelopeV1,
  BootstrapStateParseResult,
} from "./model.js";

/** Names the digest domain for BootstrapState envelopes. */
export const BOOTSTRAP_STATE_DIGEST_DOMAIN = "heptalogos.bootstrap-state/v1";

const privatePostgresStateSchemaV1 = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    postgresMajor: Type.Literal(18),
    initializedByPostgresVersion: Type.String({ minLength: 1 }),
    installationId: Type.String({ pattern: UUID_V7_PATTERN }),
    instanceId: Type.String({ pattern: UUID_V7_PATTERN }),
    bootstrapRoleName: Type.String({ minLength: 1 }),
    dataPlacement: Type.Object(
      {
        rootId: Type.Literal("DATA"),
        relativePath: Type.Literal("private-postgres"),
        dataLayoutVersion: Type.Literal(1),
      },
      { additionalProperties: false },
    ),
    persistedPort: Type.Integer({ minimum: 1, maximum: 65535 }),
    clusterSystemIdentifier: Type.String({ pattern: "^[0-9]+$" }),
    initializationProfileRevision: Type.String({ pattern: SHA256_HEX_PATTERN }),
  },
  { additionalProperties: false },
);

const stateSchemaV1 = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    revision: Type.Integer({ minimum: 1 }),
    activeBootstrapRuntimeGeneration: Type.String({ pattern: SHA256_HEX_PATTERN }),
    previousBootstrapRuntimeGeneration: Type.Optional(
      Type.String({ pattern: SHA256_HEX_PATTERN }),
    ),
    activeProductGeneration: Type.String({ pattern: SHA256_HEX_PATTERN }),
    continuityEpochId: Type.String({ pattern: UUID_V7_PATTERN }),
    lastKnownGoodProductGeneration: Type.Optional(
      Type.String({ pattern: SHA256_HEX_PATTERN }),
    ),
    lastCommittedOperationRef: Type.Optional(Type.String()),
    privatePostgres: Type.Optional(privatePostgresStateSchemaV1),
  },
  { additionalProperties: false },
);

const envelopeSchemaV1 = Type.Object(
  {
    state: stateSchemaV1,
    digest: bootstrapDigestSchema,
  },
  { additionalProperties: false },
);

const validateEnvelopeV1 = compileSchema<BootstrapStateEnvelope>(envelopeSchemaV1);

function problem(
  problemCode: string,
  title: string,
  detail: string,
): BootstrapStateParseResult {
  const value: Problem = createProblem({
    problemCode,
    category: "validation",
    retryClass: "manual",
    title,
    detail,
  });
  return { ok: false, problem: value };
}

/** Seals a BootstrapState body into its canonical versioned envelope. */
export function sealBootstrapState(
  state: BootstrapStateBodyV1,
): BootstrapStateEnvelopeV1;
/** Seals a BootstrapState body using the same public overload contract. */
export function sealBootstrapState(state: BootstrapStateBody): BootstrapStateEnvelope;
/** Implements the canonical BootstrapState envelope construction. */
export function sealBootstrapState(state: BootstrapStateBody): BootstrapStateEnvelope {
  const digest = digestCanonicalJson(
    BOOTSTRAP_STATE_DIGEST_DOMAIN,
    state as unknown as CanonicalJsonValue,
  );
  return { state, digest } as BootstrapStateEnvelope;
}

/** Parses and validates a persisted BootstrapState envelope. */
export function parseBootstrapState(text: string): BootstrapStateParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return problem(
      "bootstrap.state.invalid_json",
      "Bootstrap state is not valid JSON",
      "Bootstrap state JSON could not be parsed",
    );
  }

  const version = readSchemaVersion(parsed, "state");
  if (typeof version === "number" && version > 1) {
    return problem(
      "bootstrap.state.unsupported_schema",
      "Bootstrap state schema is newer than this runtime",
      "The BootstrapState schema version is not supported by this runtime",
    );
  }

  if (!validateEnvelopeV1.validate(parsed).ok) {
    return problem(
      "bootstrap.state.invalid_schema",
      "Bootstrap state does not match its supported schema",
      "Bootstrap state does not match the supported schema",
    );
  }

  const envelope = parsed as BootstrapStateEnvelope;
  const expected = sealBootstrapState(envelope.state).digest;
  if (
    envelope.digest.domain !== BOOTSTRAP_STATE_DIGEST_DOMAIN ||
    envelope.digest.hex !== expected.hex
  ) {
    return problem(
      "bootstrap.state.digest_mismatch",
      "Bootstrap state digest does not match its state",
      "The recorded digest is not the expected domain-separated SHA-256 digest",
    );
  }

  return { ok: true, value: envelope };
}
