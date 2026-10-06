// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements scoped SecretRef lifecycle through OS credential generations and
 * Host-fenced canonical metadata transactions.
 * @module service
 */

import {
  createUuidV7Id,
  formatInstant,
  parseInstant,
  parseUuidV7Id,
  type Instant,
} from "@heptalogos/foundation-contracts";
import {
  type ExecutionContextRuntime,
  type LineageContextRef,
} from "@heptalogos/execution-lineage";
import {
  createOsCredentialStore,
  type OsCredentialKey,
  type OsCredentialStore,
} from "@heptalogos/os-credential";
import {
  executeRepositorySql,
  readRepositorySql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import {
  type SecretId,
  type SecretMetadata,
  type SecretRef,
  type SecretResolutionContext,
  type SecretScopeRef,
  type SecretService,
  type SecretServiceOptions,
  type SecretWriteInput,
} from "./contracts.js";
import { secretProblem } from "./problems.js";

interface SecretRow {
  readonly secret_id: unknown;
  readonly state: unknown;
  readonly purpose: unknown;
  readonly scope_ref: unknown;
  readonly scope_key: unknown;
  readonly backend_kind: unknown;
  readonly backend_service: unknown;
  readonly backend_account: unknown;
  readonly material_generation: unknown;
  readonly created_at: unknown;
  readonly replaced_at: unknown;
  readonly revoked_at: unknown;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw secretProblem(
      "secret.repository_invalid",
      "Secret repository data is invalid",
      field + " is not a non-empty string",
      "integrity",
    );
  }
  return value;
}

function instant(value: unknown): Instant {
  const candidate = value instanceof Date ? formatInstant(value) : value;
  const parsed = parseInstant(candidate);
  if (parsed === undefined) {
    throw secretProblem(
      "secret.repository_invalid",
      "Secret repository data is invalid",
      "A persisted Secret time value is invalid",
      "integrity",
    );
  }
  return parsed;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

// Intentional duplication: Secret and Configuration decode owner-specific
// scope references and report owner-specific repository Problems.
/* jscpd:ignore-start */
function scope(value: unknown): SecretScopeRef | undefined {
  const parsed = jsonValue(value);
  if (parsed === null || parsed === undefined) return undefined;
  if (
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).schemaVersion !== 1 ||
    typeof (parsed as Record<string, unknown>).resourceKind !== "string" ||
    typeof (parsed as Record<string, unknown>).resourceId !== "string"
  ) {
    throw secretProblem(
      "secret.repository_invalid",
      "Secret repository data is invalid",
      "scope_ref is not a current SecretScopeRef",
      "integrity",
    );
  }
  const record = parsed as Record<string, string>;
  return Object.freeze({
    schemaVersion: 1,
    resourceKind: record.resourceKind,
    resourceId: record.resourceId,
  });
}
/* jscpd:ignore-end */

// Intentional duplication: Secret and Configuration validate owner-specific
// scope types and failure codes even though their bounded shape is parallel.
/* jscpd:ignore-start */
function scopeKey(ref: SecretScopeRef | undefined): string | undefined {
  if (ref === undefined) return undefined;
  if (
    ref.schemaVersion !== 1 ||
    ref.resourceKind.trim().length === 0 ||
    ref.resourceKind.length > 128 ||
    ref.resourceId.trim().length === 0 ||
    ref.resourceId.length > 256
  ) {
    throw secretProblem(
      "secret.invalid_scope",
      "Secret scope is invalid",
      "Secret resource kind and identifier are bounded non-empty values",
    );
  }
  return JSON.stringify([ref.resourceKind, ref.resourceId]);
}
/* jscpd:ignore-end */

function parseSecretRef(value: SecretRef | string): SecretRef {
  const secretIdValue =
    typeof value === "string"
      ? value
      : value.schemaVersion === 1
        ? value.secretId
        : undefined;
  const secretId = parseUuidV7Id("SecretId", secretIdValue);
  if (secretId === undefined) {
    throw secretProblem(
      "secret.invalid_ref",
      "SecretRef is invalid",
      "secretId must be a UUIDv7 SecretId",
    );
  }
  return Object.freeze({ schemaVersion: 1, secretId });
}

function currentState(row: SecretRow): "ACTIVE" | "REVOKED" | "UNAVAILABLE" {
  const value = text(row.state, "state");
  if (value !== "ACTIVE" && value !== "REVOKED" && value !== "UNAVAILABLE") {
    throw secretProblem(
      "secret.repository_invalid",
      "Secret repository data is invalid",
      "state is not a supported Secret state",
      "integrity",
    );
  }
  return value;
}

function secretId(row: SecretRow): SecretId {
  const value = parseUuidV7Id("SecretId", row.secret_id);
  if (value === undefined) {
    throw secretProblem(
      "secret.repository_invalid",
      "Secret repository data is invalid",
      "secret_id is not a UUIDv7 SecretId",
      "integrity",
    );
  }
  return value;
}

function metadata(row: SecretRow): SecretMetadata {
  const backendKind = text(row.backend_kind, "backend_kind");
  if (backendKind !== "os-credential") {
    throw secretProblem(
      "secret.repository_invalid",
      "Secret repository data is invalid",
      "backend_kind is not the current OS credential backend",
      "integrity",
    );
  }
  const result: SecretMetadata = {
    schemaVersion: 1,
    secretId: secretId(row),
    state: currentState(row),
    purpose: text(row.purpose, "purpose"),
    ...(scope(row.scope_ref) === undefined ? {} : { scopeRef: scope(row.scope_ref) }),
    backendKind: "os-credential",
    createdAt: instant(row.created_at),
    ...(row.replaced_at === null || row.replaced_at === undefined
      ? {}
      : { replacedAt: instant(row.replaced_at) }),
    ...(row.revoked_at === null || row.revoked_at === undefined
      ? {}
      : { revokedAt: instant(row.revoked_at) }),
  };
  return Object.freeze(result);
}

function currentBackendKey(row: SecretRow): OsCredentialKey {
  return {
    service: text(row.backend_service, "backend_service"),
    account: text(row.backend_account, "backend_account"),
  };
}

function generation(row: SecretRow): number {
  const value =
    typeof row.material_generation === "number"
      ? row.material_generation
      : typeof row.material_generation === "string"
        ? Number(row.material_generation)
        : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw secretProblem(
      "secret.repository_invalid",
      "Secret repository data is invalid",
      "material_generation is not a positive safe integer",
      "integrity",
    );
  }
  return value;
}

function requireActivity(execution: ExecutionContextRuntime): {
  readonly installationId: string;
  readonly lineageContextRef: LineageContextRef;
} {
  const current = execution.current();
  if (current === undefined) {
    throw secretProblem(
      "secret.activity_required",
      "Secret mutation requires an Activity",
      "A canonical Secret mutation must run inside retained execution context",
      "conflict",
      "after-change",
    );
  }
  return {
    installationId: current.origin.installationId,
    lineageContextRef: execution.createLineageContextRef(),
  };
}

function validateWrite(input: SecretWriteInput): void {
  if (
    typeof input.purpose !== "string" ||
    input.purpose.trim().length === 0 ||
    input.purpose.length > 256
  ) {
    throw secretProblem(
      "secret.invalid_input",
      "Secret write input is invalid",
      "purpose must be a bounded non-empty string",
    );
  }
  if (!(input.material instanceof Uint8Array) || input.material.byteLength === 0) {
    throw secretProblem(
      "secret.invalid_input",
      "Secret write input is invalid",
      "protected material must contain bytes",
    );
  }
  scopeKey(input.scopeRef);
}

function validateResolution(context: SecretResolutionContext): void {
  if (
    typeof context.consumer !== "string" ||
    context.consumer.trim().length === 0 ||
    context.consumer.length > 128 ||
    typeof context.purpose !== "string" ||
    context.purpose.trim().length === 0 ||
    context.purpose.length > 256
  ) {
    throw secretProblem(
      "secret.invalid_resolution_context",
      "Secret resolution context is invalid",
      "consumer and purpose must be bounded non-empty strings",
    );
  }
  scopeKey(context.resourceRef);
}

function backendKey(
  installationId: string,
  ref: SecretRef,
  materialGeneration: number,
): OsCredentialKey {
  return {
    service: "Heptalogos/secret/" + installationId,
    account: "secret/" + ref.secretId + "/" + materialGeneration,
  };
}

async function rows<T>(
  transaction: PersistenceInternalTransaction,
  query: string,
  parameters: readonly unknown[],
): Promise<readonly T[]> {
  return executeRepositorySql<T>(transaction, query, parameters);
}

/** Creates the normal Product Secret service over one OS credential backend. */
export function createSecretService(options: SecretServiceOptions): SecretService {
  const store: OsCredentialStore = options.credentialStore ?? createOsCredentialStore();

  const readRow = async (ref: SecretRef): Promise<SecretRow | undefined> => {
    const result = await readRepositorySql<SecretRow>(
      options.persistence,
      "SELECT secret_id, state, purpose, scope_ref, scope_key, backend_kind, " +
        "backend_service, backend_account, material_generation, created_at, " +
        'replaced_at, revoked_at FROM "heptalogos"."secret_metadata" ' +
        "WHERE secret_id = $1",
      [ref.secretId],
    );
    return result[0];
  };

  const service: SecretService = {
    async listMetadata() {
      const result = await readRepositorySql<SecretRow>(
        options.persistence,
        "SELECT secret_id, state, purpose, scope_ref, scope_key, backend_kind, " +
          "backend_service, backend_account, material_generation, created_at, " +
          'replaced_at, revoked_at FROM "heptalogos"."secret_metadata" ' +
          "ORDER BY created_at, secret_id",
        [],
      );
      return Object.freeze(result.map(metadata));
    },
    async getMetadata(refInput) {
      const ref = parseSecretRef(refInput);
      const row = await readRow(ref);
      return row === undefined ? undefined : metadata(row);
    },
    async createOrSet(input) {
      validateWrite(input);
      const activity = requireActivity(options.execution);
      const createdRef = Object.freeze({
        schemaVersion: 1 as const,
        secretId: createUuidV7Id("SecretId") as SecretId,
      });
      const key = backendKey(activity.installationId, createdRef, 1);
      const material = Uint8Array.from(input.material);
      try {
        try {
          await store.set(key, material);
        } catch {
          throw secretProblem(
            "secret.unavailable",
            "Secret backend is unavailable",
            "The operating-system credential backend could not store material",
            "unavailable",
            "manual",
          );
        }
      } finally {
        material.fill(0);
      }
      await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (transaction) => {
          await executeRepositorySql(
            transaction,
            'INSERT INTO "heptalogos"."secret_metadata" (' +
              "secret_id, state, purpose, scope_ref, scope_key, backend_kind, " +
              "backend_service, backend_account, material_generation, created_at, " +
              "replaced_at, revoked_at, lineage_context_ref) " +
              "VALUES ($1, 'ACTIVE', $2, $3, $4, 'os-credential', $5, $6, " +
              "1, $7, NULL, NULL, $8)",
            [
              createdRef.secretId,
              input.purpose,
              input.scopeRef ?? null,
              scopeKey(input.scopeRef) ?? null,
              key.service,
              key.account,
              options.time.now(),
              activity.lineageContextRef,
            ],
          );
          await options.evidence.recordRequired(context, {
            evidenceKind: "secret.created",
            evidenceContractVersion: "secret.v1",
            objectRef: createdRef.secretId,
            retentionClass: "retained",
            sensitivity: "sensitive",
          });
        }),
      );
      return createdRef;
    },
    async replace(refInput, input) {
      validateWrite(input);
      const ref = parseSecretRef(refInput);
      const oldRow = await readRow(ref);
      if (oldRow === undefined) {
        throw secretProblem(
          "secret.invalid_ref",
          "SecretRef was not found",
          "The requested SecretRef does not exist",
          "conflict",
          "after-change",
        );
      }
      if (currentState(oldRow) !== "ACTIVE") {
        throw secretProblem(
          "secret.revoked",
          "Secret is not active",
          "Only an active Secret can be replaced",
          "conflict",
          "after-change",
        );
      }
      const oldMetadata = metadata(oldRow);
      if (
        oldMetadata.purpose !== input.purpose ||
        scopeKey(oldMetadata.scopeRef) !== scopeKey(input.scopeRef)
      ) {
        throw secretProblem(
          "secret.scope_mismatch",
          "Secret replacement scope does not match",
          "Replacement cannot change the current Secret purpose or scope",
          "conflict",
          "after-change",
        );
      }
      const activity = requireActivity(options.execution);
      const nextGeneration = generation(oldRow) + 1;
      const newKey = backendKey(activity.installationId, ref, nextGeneration);
      const material = Uint8Array.from(input.material);
      try {
        try {
          await store.set(newKey, material);
        } catch {
          throw secretProblem(
            "secret.unavailable",
            "Secret backend is unavailable",
            "The operating-system credential backend could not store replacement material",
            "unavailable",
            "manual",
          );
        }
      } finally {
        material.fill(0);
      }
      const replacedAt = options.time.now();
      await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (transaction) => {
          const currentRows = await rows<SecretRow>(
            transaction,
            "SELECT secret_id, state, purpose, scope_ref, scope_key, backend_kind, " +
              "backend_service, backend_account, material_generation, created_at, " +
              'replaced_at, revoked_at FROM "heptalogos"."secret_metadata" ' +
              "WHERE secret_id = $1 FOR UPDATE",
            [ref.secretId],
          );
          const current = currentRows[0];
          if (
            current === undefined ||
            currentState(current) !== "ACTIVE" ||
            generation(current) !== generation(oldRow)
          ) {
            throw secretProblem(
              "secret.replacement_conflict",
              "Secret replacement is stale",
              "The current Secret material generation changed before replacement",
              "conflict",
              "after-change",
            );
          }
          await executeRepositorySql(
            transaction,
            'UPDATE "heptalogos"."secret_metadata" SET ' +
              "backend_service = $1, backend_account = $2, material_generation = $3, " +
              "replaced_at = $4, lineage_context_ref = $5 " +
              "WHERE secret_id = $6 AND state = 'ACTIVE'",
            [
              newKey.service,
              newKey.account,
              nextGeneration,
              replacedAt,
              activity.lineageContextRef,
              ref.secretId,
            ],
          );
          await options.evidence.recordRequired(context, {
            evidenceKind: "secret.replaced",
            evidenceContractVersion: "secret.v1",
            objectRef: ref.secretId,
            retentionClass: "retained",
            sensitivity: "sensitive",
          });
        }),
      );
      await store.delete(currentBackendKey(oldRow)).catch(() => false);
      return ref;
    },
    async revoke(refInput) {
      const ref = parseSecretRef(refInput);
      const row = await readRow(ref);
      if (row === undefined) {
        throw secretProblem(
          "secret.invalid_ref",
          "SecretRef was not found",
          "The requested SecretRef does not exist",
          "conflict",
          "after-change",
        );
      }
      if (currentState(row) === "REVOKED") return;
      const activity = requireActivity(options.execution);
      const revokedAt = options.time.now();
      await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (transaction) => {
          const locked = await rows<SecretRow>(
            transaction,
            "SELECT secret_id, state, purpose, scope_ref, scope_key, backend_kind, " +
              "backend_service, backend_account, material_generation, created_at, " +
              'replaced_at, revoked_at FROM "heptalogos"."secret_metadata" ' +
              "WHERE secret_id = $1 FOR UPDATE",
            [ref.secretId],
          );
          const current = locked[0];
          if (current === undefined) {
            throw secretProblem(
              "secret.invalid_ref",
              "SecretRef was not found",
              "The requested SecretRef does not exist",
              "conflict",
              "after-change",
            );
          }
          if (currentState(current) === "REVOKED") return;
          await executeRepositorySql(
            transaction,
            'UPDATE "heptalogos"."secret_metadata" SET state = \'REVOKED\', ' +
              "revoked_at = $1, lineage_context_ref = $2 WHERE secret_id = $3",
            [revokedAt, activity.lineageContextRef, ref.secretId],
          );
          await options.evidence.recordRequired(context, {
            evidenceKind: "secret.revoked",
            evidenceContractVersion: "secret.v1",
            objectRef: ref.secretId,
            retentionClass: "retained",
            sensitivity: "sensitive",
          });
        }),
      );
      await store.delete(currentBackendKey(row)).catch(() => false);
    },
    async resolve(refInput, context) {
      validateResolution(context);
      const ref = parseSecretRef(refInput);
      const row = await readRow(ref);
      if (row === undefined) {
        throw secretProblem(
          "secret.invalid_ref",
          "SecretRef was not found",
          "The requested SecretRef does not exist",
          "conflict",
          "after-change",
        );
      }
      const state = currentState(row);
      if (state === "REVOKED") {
        throw secretProblem(
          "secret.revoked",
          "Secret is revoked",
          "Revoked Secret material cannot be resolved",
          "conflict",
          "after-change",
        );
      }
      if (
        text(row.purpose, "purpose") !== context.purpose ||
        scopeKey(scope(row.scope_ref)) !== scopeKey(context.resourceRef)
      ) {
        throw secretProblem(
          "secret.scope_mismatch",
          "Secret resolution scope does not match",
          "The requested consumer, purpose, or resource scope is not authorized",
          "conflict",
          "after-change",
        );
      }
      if (
        !["system.ai-runtime", "product.subject.openclaw"].includes(context.consumer) ||
        context.purpose !== "ai.gateway.bearer-token" ||
        context.resourceRef?.resourceKind !== "gateway-profile"
      ) {
        throw secretProblem(
          "secret.unauthorized",
          "Secret consumer is not authorized",
          "The current Product route only authorizes gateway bearer tokens for AIRuntime or the isolated Subject OpenClaw runtime",
          "conflict",
          "after-change",
        );
      }
      try {
        const bytes = await store.withCredential(
          currentBackendKey(row),
          async (value) => Uint8Array.from(value),
        );
        return Object.freeze({ __ephemeral: true as const, bytes });
      } catch {
        throw secretProblem(
          "secret.unavailable",
          "Secret material is unavailable",
          "The current OS credential entry could not be resolved",
          "unavailable",
          "manual",
        );
      }
    },
  };
  return Object.freeze(service);
}
