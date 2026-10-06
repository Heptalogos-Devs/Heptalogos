// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalSchemaInitializer } from "@heptalogos/canonical-schema";
import { createDurableExecutionSchemaProvisioner } from "@heptalogos/durable-execution";
import {
  BootstrapStateStore,
  BOOTSTRAP_STATE_DIGEST_DOMAIN,
} from "@heptalogos/bootstrap-state";
import {
  asContentDigest,
  createContinuityEpochId,
  createInstanceId,
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import {
  HOST_DURABLE_EXECUTION_ROLE,
  HOST_MIGRATION_ROLE,
  HOST_OWNERSHIP_OWNER_ROLE,
  HOST_RUNTIME_ROLE,
} from "@heptalogos/host-ownership";
import {
  BOOTSTRAP_PASSWORD,
  CANONICAL_OPTIONS,
  DURABLE_EXECUTION_PASSWORD,
  HOST_TIMING,
  MIGRATION_PASSWORD,
  RUNTIME_PASSWORD,
  boot,
  cleanupCanonicalPostgresFixtures,
  currentState,
  expectQueryDenied,
  makeFixture,
  makeKeyProvider,
  mutateAsBootstrap,
  prepareOwned,
  qualifiedPgBin,
  queryAs,
  stopManagedHostWithoutRuntime,
} from "../support/canonical-postgres.js";

const describeRealPostgres = qualifiedPgBin === undefined ? describe.skip : describe;

const durableSchemaProvisioner = createDurableExecutionSchemaProvisioner({
  processTimeoutMs: 120_000,
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
});
const canonicalInitializer = createCanonicalSchemaInitializer(CANONICAL_OPTIONS);
const initializeCanonicalAndDurable = async (
  context: Parameters<typeof canonicalInitializer>[0],
): Promise<void> => {
  await canonicalInitializer(context);
  await durableSchemaProvisioner.ensureCurrent(context.authority);
};

afterEach(async () => {
  await cleanupCanonicalPostgresFixtures();
});

describeRealPostgres.sequential(
  "Canonical canonical continuity PostgreSQL qualification",
  () => {
    it("materializes the BootstrapState epoch before managed Host exposure", async () => {
      const fixture = await makeFixture();
      const result = await boot(fixture);
      expect(result.host.continuityEpochId).toBe(result.epoch);
      expect(result.host.persistence.continuityEpochId).toBe(result.epoch);
      await expect(
        queryAs(
          fixture,
          HOST_RUNTIME_ROLE,
          RUNTIME_PASSWORD,
          `SELECT instance_id, continuity_epoch_id FROM "heptalogos"."instance_continuity"`,
        ),
      ).resolves.toMatchObject({
        rows: [{ instance_id: fixture.instanceId, continuity_epoch_id: result.epoch }],
      });
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT name FROM "heptalogos"."foundation_schema_migration"`,
        ),
      ).resolves.toMatchObject({ rows: [{ name: "0001_foundation_baseline" }] });
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'heptalogos'
             AND table_name IN ('instance_continuity', 'activity_record', 'activity_link', 'evidence_record')
           ORDER BY table_name`,
        ),
      ).resolves.toMatchObject({
        rows: [
          { table_name: "activity_link" },
          { table_name: "activity_record" },
          { table_name: "evidence_record" },
          { table_name: "instance_continuity" },
        ],
      });
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'heptalogos' AND table_name = 'activity_record'
           ORDER BY ordinal_position`,
        ),
      ).resolves.toMatchObject({
        rows: [
          { column_name: "activity_id" },
          { column_name: "kind" },
          { column_name: "started_at" },
          { column_name: "ended_at" },
          { column_name: "parent_activity_id" },
          { column_name: "causation_activity_id" },
          { column_name: "installation_id" },
          { column_name: "instance_id" },
          { column_name: "boot_id" },
          { column_name: "continuity_epoch_id" },
          { column_name: "host_ownership_token" },
          { column_name: "product_generation_id" },
          { column_name: "package_generation_id" },
          { column_name: "micro_system_id" },
          { column_name: "micro_system_instance_id" },
          { column_name: "contribution_id" },
          { column_name: "importance" },
          { column_name: "retention_class" },
          { column_name: "sensitivity" },
          { column_name: "operation_id" },
          { column_name: "feature_id" },
          { column_name: "service_id" },
          { column_name: "capability_id" },
          { column_name: "provider_id" },
          { column_name: "contract_version" },
          { column_name: "outcome" },
          { column_name: "outcome_ref" },
        ],
      });
      await expect(
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name,
                  ccu.column_name AS foreign_column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
           WHERE tc.constraint_type = 'FOREIGN KEY'
             AND tc.table_schema = 'heptalogos'
           ORDER BY tc.table_name, kcu.column_name`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            table_name: "activity_link",
            column_name: "source_activity_id",
            foreign_table_name: "activity_record",
            foreign_column_name: "activity_id",
          },
          {
            table_name: "evidence_record",
            column_name: "activity_id",
            foreign_table_name: "activity_record",
            foreign_column_name: "activity_id",
          },
        ],
      });
      await expect(
        queryAs(
          fixture,
          HOST_RUNTIME_ROLE,
          RUNTIME_PASSWORD,
          `SELECT has_table_privilege(current_user, 'heptalogos.activity_record', 'SELECT') AS activity_select,
                  has_table_privilege(current_user, 'heptalogos.activity_record', 'INSERT') AS activity_insert,
                  has_table_privilege(current_user, 'heptalogos.activity_record', 'UPDATE') AS activity_update,
                  has_table_privilege(current_user, 'heptalogos.activity_record', 'DELETE') AS activity_delete,
                  has_table_privilege(current_user, 'heptalogos.evidence_record', 'SELECT') AS evidence_select,
                  has_table_privilege(current_user, 'heptalogos.evidence_record', 'INSERT') AS evidence_insert,
                  has_table_privilege(current_user, 'heptalogos.evidence_record', 'UPDATE') AS evidence_update,
                  has_table_privilege(current_user, 'heptalogos.evidence_record', 'DELETE') AS evidence_delete`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            activity_select: true,
            activity_insert: true,
            activity_update: false,
            activity_delete: false,
            evidence_select: true,
            evidence_insert: true,
            evidence_update: false,
            evidence_delete: false,
          },
        ],
      });
      await stopManagedHostWithoutRuntime(result.host);
    }, 180_000);

    it("provisions current DBOS schema, exact role rights, and restart idempotence", async () => {
      const fixture = await makeFixture();
      const first = await boot(fixture, initializeCanonicalAndDurable);

      await expect(
        queryAs(
          fixture,
          HOST_DURABLE_EXECUTION_ROLE,
          DURABLE_EXECUTION_PASSWORD,
          `SELECT current_user, count(*)::integer AS workflow_count
           FROM "dbos"."workflow_status"`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            current_user: HOST_DURABLE_EXECUTION_ROLE,
            workflow_count: 0,
          },
        ],
      });

      const workflowId = createInstanceId();
      await queryAs(
        fixture,
        HOST_DURABLE_EXECUTION_ROLE,
        DURABLE_EXECUTION_PASSWORD,
        `INSERT INTO "dbos"."workflow_status" (workflow_uuid, status)
         VALUES ($1, 'ENQUEUED')`,
        [workflowId],
      );
      await expect(
        queryAs(
          fixture,
          HOST_DURABLE_EXECUTION_ROLE,
          DURABLE_EXECUTION_PASSWORD,
          `SELECT workflow_uuid FROM "dbos"."workflow_status" WHERE workflow_uuid = $1`,
          [workflowId],
        ),
      ).resolves.toMatchObject({ rows: [{ workflow_uuid: workflowId }] });
      await queryAs(
        fixture,
        HOST_DURABLE_EXECUTION_ROLE,
        DURABLE_EXECUTION_PASSWORD,
        `DELETE FROM "dbos"."workflow_status" WHERE workflow_uuid = $1`,
        [workflowId],
      );

      await expectQueryDenied(
        fixture,
        HOST_DURABLE_EXECUTION_ROLE,
        DURABLE_EXECUTION_PASSWORD,
        `SELECT * FROM "heptalogos"."work_item"`,
      );
      await expectQueryDenied(
        fixture,
        HOST_DURABLE_EXECUTION_ROLE,
        DURABLE_EXECUTION_PASSWORD,
        `SELECT * FROM "heptalogos"."activity_record"`,
      );
      await expectQueryDenied(
        fixture,
        HOST_DURABLE_EXECUTION_ROLE,
        DURABLE_EXECUTION_PASSWORD,
        `SELECT * FROM "heptalogos"."evidence_record"`,
      );
      await expectQueryDenied(
        fixture,
        HOST_DURABLE_EXECUTION_ROLE,
        DURABLE_EXECUTION_PASSWORD,
        `CREATE TABLE "dbos"."durable_ddl_forbidden" (value integer)`,
      );
      await expectQueryDenied(
        fixture,
        HOST_DURABLE_EXECUTION_ROLE,
        DURABLE_EXECUTION_PASSWORD,
        `CREATE TABLE "heptalogos"."durable_product_ddl_forbidden" (value integer)`,
      );

      await expect(
        queryAs(
          fixture,
          HOST_MIGRATION_ROLE,
          MIGRATION_PASSWORD,
          "SELECT current_user, session_user",
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            current_user: HOST_MIGRATION_ROLE,
            session_user: HOST_MIGRATION_ROLE,
          },
        ],
      });
      await expectQueryDenied(
        fixture,
        HOST_MIGRATION_ROLE,
        MIGRATION_PASSWORD,
        `CREATE SCHEMA "migration_without_owner_forbidden"`,
      );
      await expect(
        queryAs(
          fixture,
          HOST_MIGRATION_ROLE,
          MIGRATION_PASSWORD,
          "SELECT current_user, session_user",
          [],
          `-c role=${HOST_OWNERSHIP_OWNER_ROLE}`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            current_user: HOST_OWNERSHIP_OWNER_ROLE,
            session_user: HOST_MIGRATION_ROLE,
          },
        ],
      });

      await first.host.shutdownKeepingPrivatePostgres({
        async retire() {
          // The first composition has no Runtime components to retire here.
        },
      });
      const second = await boot(fixture, initializeCanonicalAndDurable);
      await expect(
        queryAs(
          fixture,
          HOST_DURABLE_EXECUTION_ROLE,
          DURABLE_EXECUTION_PASSWORD,
          `SELECT count(*)::integer AS workflow_count FROM "dbos"."workflow_status"`,
        ),
      ).resolves.toMatchObject({ rows: [{ workflow_count: 0 }] });
      await stopManagedHostWithoutRuntime(second.host);
    }, 300_000);

    it("blocks Host exposure when the vendor schema becomes invalid", async () => {
      const fixture = await makeFixture();
      const first = await boot(fixture, initializeCanonicalAndDurable);
      await mutateAsBootstrap(fixture, `DROP TABLE "dbos"."workflow_status" CASCADE`);
      await first.host.shutdownKeepingPrivatePostgres({
        async retire() {
          // The first composition has no Runtime components to retire here.
        },
      });

      await expect(boot(fixture, initializeCanonicalAndDurable)).rejects.toMatchObject({
        problem: {
          problemCode: "durable.execution.schema.verification_failed",
        },
      });
    }, 300_000);

    it("preserves the epoch across a second boot with a new Host identity", async () => {
      const fixture = await makeFixture();
      const first = await boot(fixture);
      const firstBoot = first.host.bootId;
      const firstToken = first.host.token;
      await first.host.shutdownKeepingPrivatePostgres({
        async retire() {
          // The first composition has no Runtime components to retire here.
        },
      });
      const second = await boot(fixture);
      expect(second.host.bootId).not.toBe(firstBoot);
      expect(second.host.token).not.toBe(firstToken);
      expect(second.epoch).toBe(first.epoch);
      expect(second.host.continuityEpochId).toBe(first.epoch);
      await stopManagedHostWithoutRuntime(second.host);
    }, 240_000);

    it("retries the committed epoch after authority loss between migration and materialization", async () => {
      const fixture = await makeFixture();
      const realInitializer = createCanonicalSchemaInitializer(CANONICAL_OPTIONS);
      let assertCount = 0;
      const interruptedInitializer = async (
        context: Parameters<typeof realInitializer>[0],
      ) => {
        const authority = {
          ...context.authority,
          assertCurrent() {
            assertCount += 1;
            if (assertCount === 3) {
              throw new Error("test interruption after migration");
            }
            context.authority.assertCurrent();
          },
        };
        await realInitializer({ ...context, authority });
      };
      const prepared = await prepareOwned(fixture);
      await expect(
        prepared.owned.handoffPrivatePostgresToHost(prepared.ready, {
          initializeCanonicalHost: interruptedInitializer,
          keyProvider: makeKeyProvider(),
          timing: HOST_TIMING,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "canonical-schema.authority_lost" },
      });
      const state = await currentState(fixture);
      expect(state.status).toBe("CURRENT");
      if (state.status !== "CURRENT") throw new Error("BootstrapState was not current");
      expect(state.value.state.continuityEpochId).toBe(prepared.epoch);
      await prepared.owned.close();
      const retry = await boot(fixture);
      expect(retry.epoch).toBe(prepared.epoch);
      await stopManagedHostWithoutRuntime(retry.host);
    }, 240_000);

    it.each([
      ["epoch-mismatch", "epoch", "canonical-schema.continuity_epoch_mismatch"],
      [
        "instance-mismatch",
        "instance",
        "canonical-schema.continuity_instance_mismatch",
      ],
    ] as const)(
      "%s rejects a canonical continuity %s mismatch without overwrite",
      async (_name, kind, problemCode) => {
        const fixture = await makeFixture();
        const first = await boot(fixture);
        const alternate =
          kind === "epoch" ? createContinuityEpochId() : createInstanceId();
        const statement =
          kind === "epoch"
            ? `UPDATE "heptalogos"."instance_continuity" SET continuity_epoch_id = $1`
            : `UPDATE "heptalogos"."instance_continuity" SET instance_id = $1`;
        await stopManagedHostWithoutRuntime(first.host);
        const prepared = await prepareOwned(fixture);
        await mutateAsBootstrap(fixture, statement, [alternate]);
        await expect(
          prepared.owned.handoffPrivatePostgresToHost(prepared.ready, {
            initializeCanonicalHost:
              createCanonicalSchemaInitializer(CANONICAL_OPTIONS),
            keyProvider: makeKeyProvider(),
            timing: HOST_TIMING,
          }),
        ).rejects.toMatchObject({ problem: { problemCode } });
        await prepared.owned.close();
        const verification = await prepareOwned(fixture);
        try {
          const row = await queryAs(
            fixture,
            "heptalogos_bootstrap",
            BOOTSTRAP_PASSWORD,
            `SELECT instance_id, continuity_epoch_id FROM "heptalogos"."instance_continuity"`,
          );
          expect(
            row.rows[0]?.[kind === "epoch" ? "continuity_epoch_id" : "instance_id"],
          ).toBe(alternate);
        } finally {
          await verification.ready.stop().catch(() => undefined);
          await verification.owned.close().catch(() => undefined);
        }
      },
      240_000,
    );

    it("keeps migration and runtime authorities distinct and read-only", async () => {
      const fixture = await makeFixture();
      const result = await boot(fixture);
      await expect(
        queryAs(
          fixture,
          "heptalogos_migration",
          MIGRATION_PASSWORD,
          "SELECT session_user, current_user",
          [],
          "-c role=heptalogos_owner -c search_path=heptalogos,pg_catalog",
        ),
      ).resolves.toMatchObject({
        rows: [
          { session_user: "heptalogos_migration", current_user: "heptalogos_owner" },
        ],
      });
      await expectQueryDenied(
        fixture,
        HOST_RUNTIME_ROLE,
        RUNTIME_PASSWORD,
        "SET ROLE heptalogos_owner",
      );
      await expectQueryDenied(
        fixture,
        HOST_RUNTIME_ROLE,
        RUNTIME_PASSWORD,
        "SET ROLE heptalogos_migration",
      );
      await expect(
        queryAs(
          fixture,
          HOST_RUNTIME_ROLE,
          RUNTIME_PASSWORD,
          `SELECT instance_id, continuity_epoch_id FROM "heptalogos"."instance_continuity"`,
        ),
      ).resolves.toMatchObject({
        rows: [{ instance_id: fixture.instanceId, continuity_epoch_id: result.epoch }],
      });
      for (const statement of [
        `INSERT INTO "heptalogos"."instance_continuity" (singleton, instance_id, continuity_epoch_id) VALUES (false, $1, $2)`,
        `UPDATE "heptalogos"."instance_continuity" SET instance_id = $1`,
        `DELETE FROM "heptalogos"."instance_continuity"`,
        `CREATE TABLE "heptalogos"."canonical_runtime_denied" (id integer)`,
      ]) {
        await expectQueryDenied(
          fixture,
          HOST_RUNTIME_ROLE,
          RUNTIME_PASSWORD,
          statement,
          [fixture.instanceId, result.epoch],
        );
      }
      await stopManagedHostWithoutRuntime(result.host);
    }, 180_000);

    it("rejects corrupted current migration history", async () => {
      const fixture = await makeFixture();
      const first = await boot(fixture);
      await stopManagedHostWithoutRuntime(first.host);
      const prepared = await prepareOwned(fixture);
      await mutateAsBootstrap(
        fixture,
        `DELETE FROM "heptalogos"."foundation_schema_migration"`,
      );
      await expect(
        prepared.owned.handoffPrivatePostgresToHost(prepared.ready, {
          initializeCanonicalHost: createCanonicalSchemaInitializer(CANONICAL_OPTIONS),
          keyProvider: makeKeyProvider(),
          timing: HOST_TIMING,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "canonical-schema.migration_failed" },
      });
      await prepared.owned.close();
    }, 180_000);
  },
);

describe("Canonical BootstrapState validation", () => {
  it("rejects current V1 bytes without ContinuityEpochId", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "heptalogos-canonical-unsupported-state-"),
    );
    try {
      const body = {
        schemaVersion: 1,
        revision: 1,
        activeBootstrapRuntimeGeneration: asContentDigest(
          "BootstrapRuntimeGenerationId",
          digestCanonicalJson("test.bootstrap-runtime/v1", { generation: "bootstrap" }),
        ),
        activeProductGeneration: asContentDigest(
          "ProductGenerationId",
          digestCanonicalJson("test.product-generation/v1", { generation: "product" }),
        ),
      } as unknown as CanonicalJsonValue;
      const envelope = {
        state: body,
        digest: digestCanonicalJson(BOOTSTRAP_STATE_DIGEST_DOMAIN, body),
      };
      await writeFile(
        join(directory, "bootstrap-state.json"),
        JSON.stringify(envelope),
      );
      const loaded = await new BootstrapStateStore(directory).load();
      expect(loaded.status).toBe("CORRUPT");
      if (loaded.status === "CORRUPT") {
        expect(loaded.problem.problemCode).toBe("bootstrap.state.invalid_schema");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
