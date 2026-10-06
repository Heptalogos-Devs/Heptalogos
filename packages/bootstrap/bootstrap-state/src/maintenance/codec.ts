// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Encodes and parses the compact, versioned maintenance witness. Canonical
 * serialization and a domain-separated digest make the current phase
 * inspectable after interruption without making internal substeps durable.
 * @module maintenance/codec
 */

import {
  canonicalizeJson,
  createUuidV7Id,
  createProblem,
  digestCanonicalJson,
  parseBootId,
  parseHostOwnershipToken,
  parseInstallationId,
  parseInstanceId,
  parseInstant,
  parseUuidV7Id,
  UUID_V7_PATTERN,
  type CanonicalJsonValue,
  type Problem,
} from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import { Type } from "@heptalogos/schema-runtime/typebox";
import { bootstrapDigestSchema } from "../schemas.js";
import { readSchemaVersion } from "../json-shape.js";
import type {
  MaintenanceJournalBodyV1,
  MaintenanceJournalEnvelopeV1,
  MaintenanceJournalParseResult,
  MaintenanceOperationId,
} from "./model.js";

/** Names the digest domain for durable maintenance journal envelopes. */
export const MAINTENANCE_JOURNAL_DIGEST_DOMAIN =
  "heptalogos.maintenance-journal/v1" as const;

const DECIMAL_REVISION_PATTERN = "^(0|[1-9][0-9]*)$";

const bodySchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    revision: Type.Integer({ minimum: 1 }),
    operationId: Type.String({ pattern: UUID_V7_PATTERN }),
    activityId: Type.String({ pattern: UUID_V7_PATTERN }),
    installationId: Type.String({ pattern: UUID_V7_PATTERN }),
    instanceId: Type.String({ pattern: UUID_V7_PATTERN }),
    operationType: Type.Union([
      Type.Literal("PRIVATE_POSTGRES_RESTART"),
      Type.Literal("PRIVATE_POSTGRES_STOP"),
    ]),
    source: Type.Object(
      {
        hostOwnershipToken: Type.String({ pattern: UUID_V7_PATTERN }),
        hostBootId: Type.String({ pattern: UUID_V7_PATTERN }),
        hostOwnershipRevision: Type.String({ pattern: DECIMAL_REVISION_PATTERN }),
        postgresClusterSystemIdentifier: Type.String({ pattern: "^[0-9]+$" }),
        persistedPort: Type.Integer({ minimum: 1, maximum: 65535 }),
      },
      { additionalProperties: false },
    ),
    target: Type.Object(
      {
        privatePostgres: Type.Union([
          Type.Literal("RUNNING_SAME_IDENTITY"),
          Type.Literal("STOPPED"),
        ]),
      },
      { additionalProperties: false },
    ),
    phase: Type.Union([
      Type.Literal("PREPARED"),
      Type.Literal("EXECUTING"),
      Type.Literal("RECOVERY_REQUIRED"),
      Type.Literal("SUCCEEDED"),
      Type.Literal("ABORTED"),
    ]),
    updatedAt: Type.String({ minLength: 1 }),
    problemCode: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const envelopeSchema = Type.Object(
  {
    state: bodySchema,
    digest: bootstrapDigestSchema,
  },
  { additionalProperties: false },
);

const validateEnvelope = compileSchema<MaintenanceJournalEnvelopeV1>(envelopeSchema);

function problem(
  problemCode: string,
  category: string,
  title: string,
  detail: string,
): MaintenanceJournalParseResult {
  const value: Problem = createProblem({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
  return { ok: false, problem: value };
}

function assertUuidIdentities(body: MaintenanceJournalBodyV1): boolean {
  return (
    parseUuidV7Id("MaintenanceOperationId", body.operationId) !== undefined &&
    parseUuidV7Id("ActivityId", body.activityId) !== undefined &&
    parseInstallationId(body.installationId) !== undefined &&
    parseInstanceId(body.instanceId) !== undefined &&
    parseBootId(body.source.hostBootId) !== undefined &&
    parseHostOwnershipToken(body.source.hostOwnershipToken) !== undefined
  );
}

function semanticProblem(body: MaintenanceJournalBodyV1): string | undefined {
  if (!assertUuidIdentities(body)) return "maintenance.journal.invalid_schema";
  if (parseInstant(body.updatedAt) === undefined) {
    return "maintenance.journal.invalid_schema";
  }

  const expectedTarget =
    body.operationType === "PRIVATE_POSTGRES_RESTART"
      ? "RUNNING_SAME_IDENTITY"
      : "STOPPED";
  if (body.target.privatePostgres !== expectedTarget) {
    return "maintenance.journal.invalid_semantics";
  }
  if (body.phase !== "RECOVERY_REQUIRED" && body.problemCode !== undefined) {
    return "maintenance.journal.invalid_semantics";
  }
  return undefined;
}

/** Creates a new durable maintenance operation identity. */
export function createMaintenanceOperationId(): MaintenanceOperationId {
  return createUuidV7Id("MaintenanceOperationId");
}

/** Converts an operation identity into the stable journal reference string. */
export function maintenanceOperationRef(operationId: MaintenanceOperationId): string {
  if (parseUuidV7Id("MaintenanceOperationId", operationId) === undefined) {
    throw new TypeError("MaintenanceOperationId must be a valid UUIDv7");
  }
  return `maintenance-journal/v1/${operationId}`;
}

/** Seals maintenance state with the canonical domain-separated digest. */
export function sealMaintenanceJournal(
  state: MaintenanceJournalBodyV1,
): MaintenanceJournalEnvelopeV1 {
  const digest = digestCanonicalJson(
    MAINTENANCE_JOURNAL_DIGEST_DOMAIN,
    state as unknown as CanonicalJsonValue,
  );
  return { state, digest };
}

/** Parses, validates, and authenticates one maintenance journal envelope. */
export function parseMaintenanceJournal(text: string): MaintenanceJournalParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return problem(
      "maintenance.journal.invalid_json",
      "integrity",
      "Maintenance journal is not valid JSON",
      "Maintenance journal JSON could not be parsed",
    );
  }

  const version = readSchemaVersion(parsed, "state");
  if (typeof version === "number" && version > 1) {
    return problem(
      "maintenance.journal.unsupported_schema",
      "integrity",
      "Maintenance journal schema is newer than this runtime",
      "The MaintenanceJournal schema version is not supported by this runtime",
    );
  }
  if (!validateEnvelope.validate(parsed).ok) {
    return problem(
      "maintenance.journal.invalid_schema",
      "validation",
      "Maintenance journal does not match its supported schema",
      "Maintenance journal does not match the supported V1 schema",
    );
  }

  const envelope = parsed as MaintenanceJournalEnvelopeV1;
  if (envelope.digest.domain !== MAINTENANCE_JOURNAL_DIGEST_DOMAIN) {
    return problem(
      "maintenance.journal.digest_mismatch",
      "integrity",
      "Maintenance journal digest domain is invalid",
      "The recorded digest does not use the fixed MaintenanceJournal V1 domain",
    );
  }

  const expected = sealMaintenanceJournal(envelope.state).digest;
  if (envelope.digest.hex !== expected.hex) {
    return problem(
      "maintenance.journal.digest_mismatch",
      "integrity",
      "Maintenance journal digest does not match its body",
      "The recorded digest is not the expected domain-separated SHA-256 digest",
    );
  }

  const semanticError = semanticProblem(envelope.state);
  if (semanticError !== undefined) {
    return problem(
      semanticError,
      semanticError.endsWith("semantics") ? "validation" : "integrity",
      "Maintenance journal semantics are invalid",
      "The MaintenanceJournal body violates a fixed V1 semantic invariant",
    );
  }

  return { ok: true, value: envelope };
}

/** Returns canonical JSON text for a validated maintenance journal envelope. */
export function canonicalMaintenanceJournalText(
  envelope: MaintenanceJournalEnvelopeV1,
): string {
  return canonicalizeJson(envelope as unknown as CanonicalJsonValue);
}
