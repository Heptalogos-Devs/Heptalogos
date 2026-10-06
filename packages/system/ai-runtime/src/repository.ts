// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Owns AIRuntime persistence rows, codecs, and SQL mechanics.
 * @module repository
 */

import {
  digestCanonicalJson,
  parseUuidV7Id,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import {
  executeRepositorySql,
  readRepositorySql,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type { PersistenceService } from "@heptalogos/persistence";
import type { SecretRef } from "@heptalogos/secret";
import {
  CURRENT_MODEL_CAPABILITIES,
  type GatewayProfile,
  type GatewayProfileId,
  type ModelBinding,
  type ModelBindingId,
  type ModelCapability,
  type ModelInvocationProtocol,
  type ModelProfile,
  type ModelProfileId,
} from "./contracts.js";
import { aiRuntimeProblem } from "./problems.js";

/** Represents one raw persisted GatewayProfile row. */
interface GatewayRow {
  readonly gateway_profile_id: unknown;
  readonly base_url: unknown;
  readonly api_token_secret_ref: unknown;
  readonly enabled: unknown;
}

/** Represents one raw persisted ModelProfile row. */
interface ModelRow {
  readonly model_profile_id: unknown;
  readonly gateway_profile_id: unknown;
  readonly model_identifier: unknown;
  readonly protocol: unknown;
  readonly consumed_capabilities: unknown;
  readonly generation: unknown;
}

/** Represents one raw persisted ModelBinding row. */
interface BindingRow {
  readonly model_binding_id: unknown;
  readonly role: unknown;
  readonly model_profile_id: unknown;
  readonly revision: unknown;
  readonly enabled: unknown;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw aiRuntimeProblem(
      "ai.repository_invalid",
      "AIRuntime repository data is invalid",
      field + " is not a non-empty string",
      "integrity",
    );
  }
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw aiRuntimeProblem(
      "ai.repository_invalid",
      "AIRuntime repository data is invalid",
      field + " is not a valid integer",
      "integrity",
    );
  }
  return parsed;
}

function uuid<T extends string>(brand: T, value: unknown, field: string) {
  const parsed = parseUuidV7Id(brand, value);
  if (parsed === undefined) {
    throw aiRuntimeProblem(
      "ai.repository_invalid",
      "AIRuntime repository data is invalid",
      field + " is not a UUIDv7",
      "integrity",
    );
  }
  return parsed;
}

function ref(value: unknown, field: string): SecretRef {
  const parsed = jsonValue(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).schemaVersion !== 1
  ) {
    throw aiRuntimeProblem(
      "ai.repository_invalid",
      "AIRuntime repository data is invalid",
      field + " contains an invalid SecretRef",
      "integrity",
    );
  }
  const secretId = uuid(
    "SecretId",
    (parsed as Record<string, unknown>).secretId,
    field + ".secretId",
  );
  return Object.freeze({ schemaVersion: 1, secretId });
}

function optionalSecretRef(value: unknown, field: string): SecretRef | undefined {
  if (value === null || value === undefined) return undefined;
  return ref({ schemaVersion: 1, secretId: value }, field);
}

/** Canonicalizes and validates one configured gateway base URL. */
export function canonicalBaseUrl(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2_048) {
    throw aiRuntimeProblem(
      "ai.gateway_configuration_invalid",
      "GatewayProfile base URL is invalid",
      "baseUrl must be a bounded non-empty URL",
      "validation",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw aiRuntimeProblem(
      "ai.gateway_configuration_invalid",
      "GatewayProfile base URL is invalid",
      "baseUrl must be an absolute HTTP or HTTPS URL",
      "validation",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw aiRuntimeProblem(
      "ai.gateway_configuration_invalid",
      "GatewayProfile base URL is invalid",
      "baseUrl must be credential-free and must not contain a query or fragment",
      "validation",
    );
  }
  const host = url.hostname.toLowerCase();
  const loopback =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (url.protocol === "http:" && !loopback) {
    throw aiRuntimeProblem(
      "ai.gateway_configuration_invalid",
      "GatewayProfile base URL is invalid",
      "Plain HTTP is permitted only for literal loopback hosts",
      "validation",
    );
  }
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "");
  return url.origin + path;
}

function gatewayFromRow(row: GatewayRow): GatewayProfile {
  const gatewayProfileId = uuid(
    "GatewayProfileId",
    row.gateway_profile_id,
    "gateway_profile_id",
  ) as GatewayProfileId;
  return Object.freeze({
    schemaVersion: 1,
    gatewayProfileId,
    baseUrl: canonicalBaseUrl(text(row.base_url, "base_url")),
    ...(optionalSecretRef(row.api_token_secret_ref, "api_token_secret_ref") ===
    undefined
      ? {}
      : {
          apiTokenSecretRef: optionalSecretRef(
            row.api_token_secret_ref,
            "api_token_secret_ref",
          ),
        }),
    enabled: row.enabled === true,
  });
}

function capabilities(value: unknown): readonly ModelCapability[] {
  const parsed = jsonValue(value);
  const candidate = Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
  const sortedCandidate = candidate.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const sortedExpected = [...CURRENT_MODEL_CAPABILITIES].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (
    !Array.isArray(parsed) ||
    candidate.length !== parsed.length ||
    sortedCandidate.length !== sortedExpected.length ||
    sortedCandidate.join("\u0000") !== sortedExpected.join("\u0000")
  ) {
    throw aiRuntimeProblem(
      "ai.model_configuration_invalid",
      "ModelProfile capabilities are invalid",
      "The current ModelProfile must declare exactly the four current capabilities",
      "integrity",
    );
  }
  return Object.freeze([...CURRENT_MODEL_CAPABILITIES] as ModelCapability[]);
}

function protocol(value: unknown, field: string): ModelInvocationProtocol {
  const parsed = text(value, field);
  if (parsed !== "openai-chat" && parsed !== "openai-responses") {
    throw aiRuntimeProblem(
      "ai.model_configuration_invalid",
      "ModelProfile protocol is invalid",
      "Only openai-chat and openai-responses are current invocation protocols",
      "integrity",
    );
  }
  return parsed;
}

function modelFromRow(row: ModelRow): ModelProfile {
  return Object.freeze({
    schemaVersion: 1,
    modelProfileId: uuid(
      "ModelProfileId",
      row.model_profile_id,
      "model_profile_id",
    ) as ModelProfileId,
    gatewayProfileId: uuid(
      "GatewayProfileId",
      row.gateway_profile_id,
      "gateway_profile_id",
    ) as GatewayProfileId,
    modelIdentifier: text(row.model_identifier, "model_identifier"),
    protocol: protocol(row.protocol, "protocol"),
    consumedCapabilities: capabilities(row.consumed_capabilities),
    generation: integer(row.generation, "generation", 1),
  });
}

function bindingFromRow(row: BindingRow): ModelBinding {
  const role = text(row.role, "role");
  if (role !== "subject.primary" && role !== "subject.expression") {
    throw aiRuntimeProblem(
      "ai.binding_invalid",
      "ModelBinding role is invalid",
      "Only subject.primary and subject.expression are current binding roles",
      "integrity",
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    modelBindingId: uuid(
      "ModelBindingId",
      row.model_binding_id,
      "model_binding_id",
    ) as ModelBindingId,
    role,
    modelProfileId: uuid(
      "ModelProfileId",
      row.model_profile_id,
      "model_profile_id",
    ) as ModelProfileId,
    revision: integer(row.revision, "revision", 1),
    enabled: row.enabled === true,
  });
}

/** Returns the canonical GatewayProfile identifier from a raw value. */
export function gatewayId(
  value: GatewayProfileId | string | undefined,
): GatewayProfileId | undefined {
  if (value === undefined) return undefined;
  return uuid("GatewayProfileId", value, "gatewayProfileId") as GatewayProfileId;
}

/** Returns the canonical ModelProfile identifier from a raw value. */
export function modelId(
  value: ModelProfileId | string | undefined,
): ModelProfileId | undefined {
  if (value === undefined) return undefined;
  return uuid("ModelProfileId", value, "modelProfileId") as ModelProfileId;
}

/** Returns the canonical ModelBinding identifier from a raw value. */
function bindingId(value: ModelBindingId | string): ModelBindingId {
  return uuid("ModelBindingId", value, "modelBindingId") as ModelBindingId;
}

/** Computes the canonical digest for one GatewayProfile. */
export function gatewayDigest(profile: GatewayProfile): string {
  return requireDigest("ai.gateway-profile.v1", profile);
}

/** Computes the canonical digest for one ModelProfile. */
export function modelDigest(profile: ModelProfile): string {
  return requireDigest("ai.model-profile.v1", profile);
}

/** Computes the canonical digest for one ModelBinding. */
export function bindingDigest(binding: ModelBinding): string {
  return requireDigest("ai.model-binding.v1", binding);
}

function requireDigest(domain: string, value: object): string {
  return digestCanonicalJson(domain, value as unknown as CanonicalJsonValue).hex;
}

/** Owns direct persistence operations for AIRuntime configuration records. */
export interface AIRuntimeRepository {
  /** Reads one GatewayProfile by identifier. */
  readGateway(
    persistence: PersistenceService,
    id: GatewayProfileId,
  ): Promise<GatewayProfile | undefined>;
  /** Reads one ModelProfile by identifier. */
  readModel(
    persistence: PersistenceService,
    id: ModelProfileId,
  ): Promise<ModelProfile | undefined>;
  /** Reads one ModelBinding by identifier. */
  readBinding(
    persistence: PersistenceService,
    roleOrId: ModelBindingId | string,
  ): Promise<ModelBinding | undefined>;
  /** Lists the current GatewayProfiles. */
  listGateways(persistence: PersistenceService): Promise<readonly GatewayProfile[]>;
  /** Lists the current ModelProfiles. */
  listModels(persistence: PersistenceService): Promise<readonly ModelProfile[]>;
  /** Lists the current ModelBindings. */
  listBindings(persistence: PersistenceService): Promise<readonly ModelBinding[]>;
  /** Reads one GatewayProfile inside a caller-owned commit transaction. */
  readGatewayForCommit(
    transaction: PersistenceInternalTransaction,
    id: GatewayProfileId,
  ): Promise<GatewayProfile | undefined>;
  /** Reads one ModelProfile inside a caller-owned commit transaction. */
  readModelForCommit(
    transaction: PersistenceInternalTransaction,
    id: ModelProfileId,
  ): Promise<ModelProfile | undefined>;
  /** Reads one ModelBinding inside a caller-owned commit transaction. */
  readBindingForCommit(
    transaction: PersistenceInternalTransaction,
    id: ModelBindingId,
  ): Promise<ModelBinding | undefined>;
  /** Reads the current role binding inside a caller-owned commit transaction. */
  readBindingByRoleForCommit(
    transaction: PersistenceInternalTransaction,
    role: "subject.primary" | "subject.expression",
  ): Promise<ModelBinding | undefined>;
  /** Reads the active transport configuration for commit admission. */
  readTransportActivation(
    transaction: PersistenceInternalTransaction,
    installationId: string,
  ): Promise<unknown>;
  /** Creates or replaces one GatewayProfile in the current transaction. */
  upsertGateway(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly gatewayProfileId: GatewayProfileId;
      readonly baseUrl: string;
      readonly apiTokenSecretId?: string;
      readonly enabled: boolean;
      readonly lineageContextRef: unknown;
    },
  ): Promise<GatewayProfile | undefined>;
  /** Creates or replaces one ModelProfile in the current transaction. */
  upsertModel(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly modelProfileId: ModelProfileId;
      readonly gatewayProfileId: GatewayProfileId;
      readonly modelIdentifier: string;
      readonly protocol: ModelInvocationProtocol;
      readonly consumedCapabilities: readonly ModelCapability[];
      readonly generation: number;
      readonly lineageContextRef: unknown;
    },
  ): Promise<ModelProfile | undefined>;
  /** Creates or replaces one ModelBinding in the current transaction. */
  upsertBinding(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly modelBindingId: ModelBindingId;
      readonly role: "subject.primary" | "subject.expression";
      readonly modelProfileId: ModelProfileId;
      readonly revision: number;
      readonly lineageContextRef: unknown;
    },
  ): Promise<ModelBinding | undefined>;
}

const implementation: AIRuntimeRepository = {
  async readGateway(persistence, id) {
    const result = await readRepositorySql<GatewayRow>(
      persistence,
      "SELECT gateway_profile_id, base_url, api_token_secret_ref, enabled " +
        'FROM "heptalogos"."gateway_profile" WHERE gateway_profile_id = $1',
      [id],
    );
    return result[0] === undefined ? undefined : gatewayFromRow(result[0]);
  },
  async readModel(persistence, id) {
    const result = await readRepositorySql<ModelRow>(
      persistence,
      "SELECT model_profile_id, gateway_profile_id, model_identifier, protocol, " +
        "consumed_capabilities, generation " +
        'FROM "heptalogos"."model_profile" WHERE model_profile_id = $1',
      [id],
    );
    return result[0] === undefined ? undefined : modelFromRow(result[0]);
  },
  async readBinding(persistence, roleOrId) {
    const id =
      roleOrId === "subject.primary" || roleOrId === "subject.expression"
        ? undefined
        : bindingId(roleOrId);
    const result = await readRepositorySql<BindingRow>(
      persistence,
      "SELECT model_binding_id, role, model_profile_id, revision, enabled " +
        'FROM "heptalogos"."model_binding" ' +
        (id === undefined ? "WHERE role = $1" : "WHERE model_binding_id = $1"),
      [id ?? roleOrId],
    );
    return result[0] === undefined ? undefined : bindingFromRow(result[0]);
  },
  async listGateways(persistence) {
    const result = await readRepositorySql<GatewayRow>(
      persistence,
      "SELECT gateway_profile_id, base_url, api_token_secret_ref, enabled " +
        'FROM "heptalogos"."gateway_profile" ORDER BY gateway_profile_id',
      [],
    );
    return Object.freeze(result.map(gatewayFromRow));
  },
  async listModels(persistence) {
    const result = await readRepositorySql<ModelRow>(
      persistence,
      "SELECT model_profile_id, gateway_profile_id, model_identifier, protocol, " +
        "consumed_capabilities, generation " +
        'FROM "heptalogos"."model_profile" ORDER BY model_profile_id',
      [],
    );
    return Object.freeze(result.map(modelFromRow));
  },
  async listBindings(persistence) {
    const result = await readRepositorySql<BindingRow>(
      persistence,
      "SELECT model_binding_id, role, model_profile_id, revision, enabled " +
        'FROM "heptalogos"."model_binding" ORDER BY role',
      [],
    );
    return Object.freeze(result.map(bindingFromRow));
  },
  async readGatewayForCommit(transaction, id) {
    const rows = await executeRepositorySql<GatewayRow>(
      transaction,
      "SELECT gateway_profile_id, base_url, api_token_secret_ref, enabled " +
        'FROM "heptalogos"."gateway_profile" WHERE gateway_profile_id = $1 FOR UPDATE',
      [id],
    );
    return rows[0] === undefined ? undefined : gatewayFromRow(rows[0]);
  },
  async readModelForCommit(transaction, id) {
    const rows = await executeRepositorySql<ModelRow>(
      transaction,
      "SELECT model_profile_id, gateway_profile_id, model_identifier, protocol, " +
        "consumed_capabilities, generation " +
        'FROM "heptalogos"."model_profile" WHERE model_profile_id = $1 FOR UPDATE',
      [id],
    );
    return rows[0] === undefined ? undefined : modelFromRow(rows[0]);
  },
  async readBindingForCommit(transaction, id) {
    const rows = await executeRepositorySql<BindingRow>(
      transaction,
      "SELECT model_binding_id, role, model_profile_id, revision, enabled " +
        'FROM "heptalogos"."model_binding" WHERE model_binding_id = $1 FOR UPDATE',
      [id],
    );
    return rows[0] === undefined ? undefined : bindingFromRow(rows[0]);
  },
  async readBindingByRoleForCommit(transaction, role) {
    const rows = await executeRepositorySql<BindingRow>(
      transaction,
      "SELECT model_binding_id, role, model_profile_id, revision, enabled " +
        'FROM "heptalogos"."model_binding" WHERE role = $1 FOR UPDATE',
      [role],
    );
    return rows[0] === undefined ? undefined : bindingFromRow(rows[0]);
  },
  async readTransportActivation(transaction, installationId) {
    const rows = await executeRepositorySql<{
      readonly active_revision_id: unknown;
    }>(
      transaction,
      'SELECT active_revision_id FROM "heptalogos"."configuration_activation" ' +
        "WHERE definition_id = $1 AND scope_key = $2 FOR UPDATE",
      ["ai.gateway.transport.v1", JSON.stringify(["installation", installationId])],
    );
    return rows[0]?.active_revision_id;
  },
  async upsertGateway(transaction, input) {
    const rows = await executeRepositorySql<GatewayRow>(
      transaction,
      input.apiTokenSecretId === undefined
        ? 'UPDATE "heptalogos"."gateway_profile" SET api_token_secret_ref = NULL, ' +
            "enabled = $1, lineage_context_ref = $2 WHERE gateway_profile_id = $3 " +
            "RETURNING gateway_profile_id, base_url, api_token_secret_ref, enabled"
        : 'UPDATE "heptalogos"."gateway_profile" SET api_token_secret_ref = $1, ' +
            "enabled = $2, lineage_context_ref = $3 WHERE gateway_profile_id = $4 " +
            "RETURNING gateway_profile_id, base_url, api_token_secret_ref, enabled",
      input.apiTokenSecretId === undefined
        ? [input.enabled, input.lineageContextRef, input.gatewayProfileId]
        : [
            input.apiTokenSecretId,
            input.enabled,
            input.lineageContextRef,
            input.gatewayProfileId,
          ],
    );
    if (rows[0] !== undefined) return gatewayFromRow(rows[0]);
    const inserted = await executeRepositorySql<GatewayRow>(
      transaction,
      'INSERT INTO "heptalogos"."gateway_profile" ' +
        "(gateway_profile_id, base_url, api_token_secret_ref, enabled, lineage_context_ref) " +
        "VALUES ($1, $2, $3, $4, $5) ON CONFLICT (gateway_profile_id) DO NOTHING " +
        "RETURNING gateway_profile_id, base_url, api_token_secret_ref, enabled",
      [
        input.gatewayProfileId,
        input.baseUrl,
        input.apiTokenSecretId ?? null,
        input.enabled,
        input.lineageContextRef,
      ],
    );
    return inserted[0] === undefined ? undefined : gatewayFromRow(inserted[0]);
  },
  async upsertModel(transaction, input) {
    const current = await executeRepositorySql<ModelRow>(
      transaction,
      "SELECT model_profile_id, gateway_profile_id, model_identifier, protocol, " +
        "consumed_capabilities, generation FROM " +
        '"heptalogos"."model_profile" WHERE model_profile_id = $1 FOR UPDATE',
      [input.modelProfileId],
    );
    const rows =
      current[0] === undefined
        ? await executeRepositorySql<ModelRow>(
            transaction,
            'INSERT INTO "heptalogos"."model_profile" ' +
              "(model_profile_id, gateway_profile_id, model_identifier, protocol, " +
              "consumed_capabilities, generation, lineage_context_ref) " +
              "VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (model_profile_id) DO NOTHING " +
              "RETURNING model_profile_id, gateway_profile_id, model_identifier, protocol, " +
              "consumed_capabilities, generation",
            [
              input.modelProfileId,
              input.gatewayProfileId,
              input.modelIdentifier,
              input.protocol,
              JSON.stringify(input.consumedCapabilities),
              input.generation,
              input.lineageContextRef,
            ],
          )
        : await executeRepositorySql<ModelRow>(
            transaction,
            'UPDATE "heptalogos"."model_profile" SET gateway_profile_id = $1, ' +
              "model_identifier = $2, protocol = $3, consumed_capabilities = $4, " +
              "generation = $5, lineage_context_ref = $6 WHERE model_profile_id = $7 " +
              "RETURNING model_profile_id, gateway_profile_id, model_identifier, protocol, " +
              "consumed_capabilities, generation",
            [
              input.gatewayProfileId,
              input.modelIdentifier,
              input.protocol,
              JSON.stringify(input.consumedCapabilities),
              input.generation,
              input.lineageContextRef,
              input.modelProfileId,
            ],
          );
    return rows[0] === undefined ? undefined : modelFromRow(rows[0]);
  },
  async upsertBinding(transaction, input) {
    const current = await executeRepositorySql<BindingRow>(
      transaction,
      "SELECT model_binding_id, role, model_profile_id, revision, enabled " +
        'FROM "heptalogos"."model_binding" WHERE role = $1 FOR UPDATE',
      [input.role],
    );
    const rows =
      current[0] === undefined
        ? await executeRepositorySql<BindingRow>(
            transaction,
            'INSERT INTO "heptalogos"."model_binding" ' +
              "(model_binding_id, role, model_profile_id, revision, enabled, lineage_context_ref) " +
              "VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (role) DO NOTHING " +
              "RETURNING model_binding_id, role, model_profile_id, revision, enabled",
            [
              input.modelBindingId,
              input.role,
              input.modelProfileId,
              input.revision,
              true,
              input.lineageContextRef,
            ],
          )
        : await executeRepositorySql<BindingRow>(
            transaction,
            'UPDATE "heptalogos"."model_binding" SET model_profile_id = $1, ' +
              "revision = $2, enabled = $3, lineage_context_ref = $4 WHERE role = $5 " +
              "RETURNING model_binding_id, role, model_profile_id, revision, enabled",
            [
              input.modelProfileId,
              input.revision,
              true,
              input.lineageContextRef,
              input.role,
            ],
          );
    return rows[0] === undefined ? undefined : bindingFromRow(rows[0]);
  },
};

/** The current direct AIRuntime repository implementation. */
export const aiRuntimeRepository = Object.freeze(implementation);
