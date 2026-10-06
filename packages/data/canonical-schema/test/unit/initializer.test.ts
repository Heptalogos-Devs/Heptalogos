// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { Kysely, PostgresDialect } from "kysely";
import type { Pool, PoolClient } from "pg";
import { createCanonicalSchemaInitializer } from "../../src/initializer.js";
import { foundationBaselineMigration } from "../../src/migrations/0001-foundation-baseline.js";
import { productGatewayPrerequisitesMigration } from "../../src/migrations/0002-product-gateway-prerequisites.js";
import { productSubjectL4Migration } from "../../src/migrations/0003-product-subject-l4.js";
import type { CanonicalDatabase } from "../../src/migration-pool.js";
import {
  canonicalMigrationNames,
  canonicalMigrationProvider,
} from "../../src/migration-provider.js";
import { verifyObservedContinuityRow } from "../../src/continuity.js";
import {
  createContinuityEpochId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";

describe("canonical schema adapter", () => {
  it("materializes the current WorkItem and Contribution-origin schema", async () => {
    const statements: string[] = [];
    const client = {
      query: async (query: unknown) => {
        if (typeof query === "string") statements.push(query);
        else if (typeof query === "object" && query !== null && "text" in query) {
          statements.push(String(query.text));
        }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = {
      connect: async () => client,
      end: async () => undefined,
    } as unknown as Pool;
    const database = new Kysely<CanonicalDatabase>({
      dialect: new PostgresDialect({ pool }),
    });

    try {
      await foundationBaselineMigration.up(database);
    } finally {
      await database.destroy();
    }

    const sql = statements.join("\n");
    expect(sql).toContain('create table "heptalogos"."work_item"');
    expect(sql).toContain('create table "heptalogos"."effect_operation"');
    expect(sql).toContain('create table "heptalogos"."administrator"');
    expect(sql).toContain('create table "heptalogos"."first_administrator_claim"');
    expect(sql).toContain('create table "heptalogos"."server_session"');
    expect(sql).toContain('"first_administrator_claim_current_unique"');
    expect(sql).toContain('"management_create_or_replace_claim"');
    expect(sql).toContain('"management_consume_claim_create_administrator"');
    expect(sql).toContain('"management_create_session"');
    expect(sql).toContain('"management_revoke_session"');
    expect(sql).toContain('REVOKE ALL ON TABLE "heptalogos"."administrator"');
    expect(sql).toContain('"dispatch_host_ownership_token"');
    expect(sql).toContain(
      "state IN ('PREPARED', 'DISPATCHING', 'SUCCEEDED', 'FAILED', 'UNCERTAIN')",
    );
    expect(sql).toContain("outcome->>'status' = state");
    expect(sql).toContain('"contribution_id"');
    expect(sql).toContain('"work_item_dispatchable_index"');
    expect(sql).toContain('"work_item_projection_index"');
    expect(sql).toContain('"work_item_dedup_unique"');
    expect(sql).toContain("p_contribution_id");
    expect(sql).toContain("payload_version BETWEEN 1 AND 2147483647");
    expect(sql).toContain("state = 'RUNNING' AND active_attempt_id IS NOT NULL");
    expect(sql).toContain("state <> 'RUNNING' AND active_attempt_id IS NULL");
    expect(sql).toContain("cancel_requested_at IS NULL OR superseded_by IS NULL");
    expect(sql).toContain("outcome->>'schemaVersion' = '1'");
    expect(sql).toContain("outcome->>'kind' = state");
    expect(sql).toContain("outcome->>'retryClass' = retry_class");
  });

  it("publishes the current static migrations without a filesystem provider", async () => {
    expect(canonicalMigrationNames).toEqual([
      "0001_foundation_baseline",
      "0002_product_gateway_prerequisites",
      "0003_product_subject_l4",
    ]);
    await expect(canonicalMigrationProvider.getMigrations()).resolves.toEqual(
      expect.objectContaining({
        "0001_foundation_baseline": expect.objectContaining({
          up: expect.any(Function),
        }),
        "0002_product_gateway_prerequisites": expect.objectContaining({
          up: expect.any(Function),
        }),
        "0003_product_subject_l4": expect.objectContaining({
          up: expect.any(Function),
        }),
      }),
    );
  });

  it("materializes the current Product gateway-prerequisite schema", async () => {
    const statements: string[] = [];
    const client = {
      query: async (query: unknown) => {
        if (typeof query === "string") statements.push(query);
        else if (typeof query === "object" && query !== null && "text" in query) {
          statements.push(String(query.text));
        }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = {
      connect: async () => client,
      end: async () => undefined,
    } as unknown as Pool;
    const database = new Kysely<CanonicalDatabase>({
      dialect: new PostgresDialect({ pool }),
    });

    try {
      await productGatewayPrerequisitesMigration.up(database);
    } finally {
      await database.destroy();
    }

    const sql = statements.join("\n");
    expect(sql).toContain('CREATE TABLE "heptalogos"."configuration_revision"');
    expect(sql).toContain('CREATE TABLE "heptalogos"."configuration_activation"');
    expect(sql).toContain('CREATE TABLE "heptalogos"."secret_metadata"');
    expect(sql).toContain('CREATE TABLE "heptalogos"."gateway_profile"');
    expect(sql).toContain('CREATE TABLE "heptalogos"."model_profile"');
    expect(sql).toContain('CREATE TABLE "heptalogos"."model_binding"');
    expect(sql).toContain("protocol IN ('openai-chat', 'openai-responses')");
    expect(sql).toContain(
      'REVOKE ALL ON TABLE "heptalogos"."secret_metadata" FROM PUBLIC',
    );
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE ON TABLE "heptalogos"."model_binding" TO "heptalogos_runtime"',
    );
  });

  it("materializes the current Subject L4 schema", async () => {
    const statements: string[] = [];
    const client = {
      query: async (query: unknown) => {
        if (typeof query === "string") statements.push(query);
        else if (typeof query === "object" && query !== null && "text" in query) {
          statements.push(String(query.text));
        }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    } as unknown as PoolClient;
    const pool = {
      connect: async () => client,
      end: async () => undefined,
    } as unknown as Pool;
    const database = new Kysely<CanonicalDatabase>({
      dialect: new PostgresDialect({ pool }),
    });

    try {
      await productSubjectL4Migration.up(database);
    } finally {
      await database.destroy();
    }

    const sql = statements.join("\n");
    expect(sql).toContain('CREATE TABLE "heptalogos"."subject_authority"');
    expect(sql).toContain('CREATE TABLE "heptalogos"."messaging_conversation"');
    expect(sql).toContain('CREATE TABLE "heptalogos"."conversation_mailbox"');
    expect(sql).toContain('CREATE TABLE "heptalogos"."reaction"');
    expect(sql).toContain('CREATE TABLE "heptalogos"."communication_commit"');
    expect(sql).toContain('CREATE TABLE "heptalogos"."message_fact"');
    expect(sql).toContain("message_fact_inbound_idempotency_unique");
    expect(sql).toContain(
      "state IN ('OPEN', 'SUPERSEDED', 'NO_COMMUNICATION', 'COMMUNICATION_COMMITTED', 'REPLIED', 'FAILED')",
    );
    expect(sql).toContain(
      'reaction_id uuid NOT NULL UNIQUE REFERENCES "heptalogos"."reaction"',
    );
    expect(sql).toContain("primary_cognition_provenance jsonb NOT NULL");
    expect(sql).not.toContain("decision_commit");
    expect(sql).toContain(
      'GRANT SELECT, INSERT ON TABLE "heptalogos"."communication_commit"',
    );
    expect(sql).not.toContain("actual_state");
  });

  it("exposes only the injected initializer seam during scaffolding", () => {
    expect(typeof createCanonicalSchemaInitializer).toBe("function");
  });

  it("accepts an exact continuity row and rejects identity mismatches", () => {
    const instanceId = createInstanceId();
    const epoch = createContinuityEpochId();
    expect(() =>
      verifyObservedContinuityRow(
        { singleton: true, instance_id: instanceId, continuity_epoch_id: epoch },
        instanceId,
        epoch,
      ),
    ).not.toThrow();

    const instanceMismatch = () =>
      verifyObservedContinuityRow(
        {
          singleton: true,
          instance_id: createInstanceId(),
          continuity_epoch_id: epoch,
        },
        instanceId,
        epoch,
      );
    expect(instanceMismatch).toThrow();
    try {
      instanceMismatch();
    } catch (error) {
      expect(error).toMatchObject({
        problem: { problemCode: "canonical-schema.continuity_instance_mismatch" },
      });
    }

    const epochMismatch = () =>
      verifyObservedContinuityRow(
        {
          singleton: true,
          instance_id: instanceId,
          continuity_epoch_id: createContinuityEpochId(),
        },
        instanceId,
        epoch,
      );
    expect(epochMismatch).toThrow();
    try {
      epochMismatch();
    } catch (error) {
      expect(error).toMatchObject({
        problem: { problemCode: "canonical-schema.continuity_epoch_mismatch" },
      });
    }
  });
});
