// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createEvidenceService } from "@heptalogos/evidence";
import {
  createExecutionContextRuntime,
  createExecutionLineageService,
  createPersistenceExecutionContextProvider,
} from "@heptalogos/execution-lineage";
import { createUuidV7Id, parseInstant } from "@heptalogos/foundation-contracts";
import {
  createPersistenceService,
  type PersistenceMutationTransactionContext,
} from "@heptalogos/persistence";
import { useRepositoryMutationTransaction } from "@heptalogos/persistence/repository";
import { createFakeTimeService } from "@heptalogos/time-service";
import { CompiledQuery } from "kysely";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { BootstrapManagedHostContext } from "../../../packages/bootstrap/bootstrap-runtime/dist/host/managed-host.js";
import {
  BOOTSTRAP_PASSWORD,
  boot,
  cleanupCanonicalPostgresFixtures,
  describeRealPostgres,
  makeFixture,
  mutateAsBootstrap,
  queryAs,
  stopManagedHostWithoutRuntime,
} from "../support/canonical-postgres.js";

const PERSISTENCE_OPTIONS = {
  maxConnections: 1,
  idleTimeoutMs: 5_000,
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  lockTimeoutMs: 10_000,
  idleInTransactionSessionTimeoutMs: 30_000,
  onBackgroundError() {},
} as const;
const FIXTURE_TABLE = "execution_atomicity_fixture";

const describePostgres = describeRealPostgres === undefined ? describe.skip : describe;

afterEach(async () => {
  await cleanupCanonicalPostgresFixtures();
});

async function createFixtureTable(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
): Promise<void> {
  await mutateAsBootstrap(
    fixture,
    `CREATE TABLE "heptalogos"."${FIXTURE_TABLE}" (
       fact_id uuid PRIMARY KEY,
       value text NOT NULL
     )`,
  );
  await mutateAsBootstrap(
    fixture,
    `GRANT SELECT, INSERT ON TABLE "heptalogos"."${FIXTURE_TABLE}" TO "heptalogos_runtime"`,
  );
}

async function dropFixtureTable(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
): Promise<void> {
  await mutateAsBootstrap(
    fixture,
    `DROP TABLE IF EXISTS "heptalogos"."${FIXTURE_TABLE}"`,
  );
}

async function readFixtureRows(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
): Promise<readonly Record<string, unknown>[]> {
  const result = await queryAs(
    fixture,
    "heptalogos_bootstrap",
    BOOTSTRAP_PASSWORD,
    `SELECT fact_id, value FROM "heptalogos"."${FIXTURE_TABLE}" ORDER BY fact_id`,
  );
  return result.rows;
}

async function readActivityRows(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
): Promise<readonly Record<string, unknown>[]> {
  const result = await queryAs(
    fixture,
    "heptalogos_bootstrap",
    BOOTSTRAP_PASSWORD,
    `SELECT activity_id, kind, started_at, ended_at, causation_activity_id,
            instance_id, boot_id, continuity_epoch_id,
            host_ownership_token, retention_class, outcome
       FROM "heptalogos"."activity_record"
      ORDER BY started_at, activity_id`,
  );
  return result.rows;
}

async function readEvidenceRows(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
): Promise<readonly Record<string, unknown>[]> {
  const result = await queryAs(
    fixture,
    "heptalogos_bootstrap",
    BOOTSTRAP_PASSWORD,
    `SELECT evidence_id, activity_id, evidence_kind, evidence_contract_version,
            fact_ref, retention_class, sensitivity
       FROM "heptalogos"."evidence_record"
      ORDER BY recorded_at, evidence_id`,
  );
  return result.rows;
}

interface Composition {
  readonly host: BootstrapManagedHostContext;
  readonly runtime: ReturnType<typeof createExecutionContextRuntime>;
  readonly persistence: ReturnType<typeof createPersistenceService>;
  readonly lineage: ReturnType<typeof createExecutionLineageService>;
  readonly evidence: ReturnType<typeof createEvidenceService>;
}

function createComposition(host: BootstrapManagedHostContext): Composition {
  const time = createFakeTimeService(parseInstant("2026-08-24T15:00:00.000Z")!);
  const runtime = createExecutionContextRuntime(
    {
      installationId: host.installationId,
      instanceId: host.instanceId,
      bootId: host.bootId,
      continuityEpochId: host.continuityEpochId,
      hostOwnershipToken: host.token,
    },
    time,
  );
  return {
    host,
    runtime,
    persistence: createPersistenceService(
      host.persistence,
      PERSISTENCE_OPTIONS,
      createPersistenceExecutionContextProvider(runtime),
    ),
    lineage: createExecutionLineageService(),
    evidence: createEvidenceService(time),
  };
}

async function closeComposition(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  composition: Composition,
): Promise<void> {
  await composition.persistence.close().catch(() => undefined);
  await dropFixtureTable(fixture).catch(() => undefined);
  await stopManagedHostWithoutRuntime(composition.host).catch(() => undefined);
}

async function insertFact(
  transaction: PersistenceMutationTransactionContext,
  factId: string,
): Promise<void> {
  await useRepositoryMutationTransaction(transaction, async (databaseTransaction) => {
    await databaseTransaction.executeQuery(
      CompiledQuery.raw(
        `INSERT INTO "heptalogos"."${FIXTURE_TABLE}" (fact_id, value) VALUES ($1, $2)`,
        [factId, "canonical"],
      ),
    );
  });
}

describePostgres.sequential(
  "Execution Foundation required Activity/Evidence transaction atomicity",
  () => {
    it("commits canonical fact, current Activity, and required Evidence atomically", async () => {
      const fixture = await makeFixture();
      const bootResult = await boot(fixture);
      await createFixtureTable(fixture);
      const composition = createComposition(bootResult.host);
      const factId = createUuidV7Id("ExecutionAtomicityFactId");
      try {
        await composition.runtime.runActivity(
          {
            kind: "test.execution.atomicity",
            importance: "significant",
            retentionClass: "retained",
            sensitivity: "operational",
          },
          async (activity) => {
            await composition.persistence.mutate(async (transaction) => {
              await insertFact(transaction, factId);
              await composition.lineage.retainCurrent(transaction, activity);
              const evidence = await composition.evidence.recordRequired(transaction, {
                evidenceKind: "test.canonical.fact",
                evidenceContractVersion: "v1",
                factRef: factId,
                retentionClass: "retained",
                sensitivity: "operational",
              });
              expect(evidence.activityId).toBe(activity.activityId);
            });
          },
        );

        await expect(readFixtureRows(fixture)).resolves.toHaveLength(1);
        const activities = await readActivityRows(fixture);
        const evidence = await readEvidenceRows(fixture);
        expect(activities).toHaveLength(1);
        expect(evidence).toHaveLength(1);
        expect(evidence[0]?.activity_id).toBe(activities[0]?.activity_id);
        expect(evidence[0]?.fact_ref).toBe(factId);
      } finally {
        await closeComposition(fixture, composition);
      }
    }, 180_000);

    it("rolls back all three writes after a failure following the writes", async () => {
      const fixture = await makeFixture();
      const bootResult = await boot(fixture);
      await createFixtureTable(fixture);
      const composition = createComposition(bootResult.host);
      const factId = createUuidV7Id("ExecutionAtomicityFactId");
      try {
        await expect(
          composition.runtime.runActivity(
            {
              kind: "test.execution.atomicity.rollback",
              importance: "significant",
              retentionClass: "retained",
              sensitivity: "operational",
            },
            async (activity) =>
              composition.persistence.mutate(async (transaction) => {
                await insertFact(transaction, factId);
                await composition.lineage.retainCurrent(transaction, activity);
                await composition.evidence.recordRequired(transaction, {
                  evidenceKind: "test.canonical.fact",
                  evidenceContractVersion: "v1",
                  factRef: factId,
                  retentionClass: "retained",
                  sensitivity: "operational",
                });
                throw new Error("atomicity sentinel");
              }),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "persistence.transaction.failed" },
        });
        await expect(readFixtureRows(fixture)).resolves.toHaveLength(0);
        await expect(readActivityRows(fixture)).resolves.toHaveLength(0);
        await expect(readEvidenceRows(fixture)).resolves.toHaveLength(0);
      } finally {
        await closeComposition(fixture, composition);
      }
    }, 180_000);

    it("rolls back canonical and Activity writes when required Evidence validation fails", async () => {
      const fixture = await makeFixture();
      const bootResult = await boot(fixture);
      await createFixtureTable(fixture);
      const composition = createComposition(bootResult.host);
      const factId = createUuidV7Id("ExecutionAtomicityFactId");
      try {
        await expect(
          composition.runtime.runActivity(
            {
              kind: "test.execution.atomicity.evidence-failure",
              importance: "significant",
              retentionClass: "retained",
              sensitivity: "operational",
            },
            async (activity) =>
              composition.persistence.mutate(async (transaction) => {
                await insertFact(transaction, factId);
                await composition.lineage.retainCurrent(transaction, activity);
                await composition.evidence.recordRequired(transaction, {
                  evidenceKind: "",
                  evidenceContractVersion: "v1",
                  factRef: factId,
                  retentionClass: "retained",
                  sensitivity: "operational",
                });
              }),
          ),
        ).rejects.toMatchObject({ problem: { problemCode: "evidence.invalid_kind" } });
        await expect(readFixtureRows(fixture)).resolves.toHaveLength(0);
        await expect(readActivityRows(fixture)).resolves.toHaveLength(0);
        await expect(readEvidenceRows(fixture)).resolves.toHaveLength(0);
      } finally {
        await closeComposition(fixture, composition);
      }
    }, 180_000);

    it("rejects a read-only transaction at the Foundation write seam", async () => {
      const fixture = await makeFixture();
      const bootResult = await boot(fixture);
      await createFixtureTable(fixture);
      const composition = createComposition(bootResult.host);
      try {
        await expect(
          composition.persistence.read(async (transaction) =>
            useRepositoryMutationTransaction(
              transaction as unknown as PersistenceMutationTransactionContext,
              async () => undefined,
            ),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "persistence.transaction.context_invalid" },
        });
        await expect(readFixtureRows(fixture)).resolves.toHaveLength(0);
      } finally {
        await closeComposition(fixture, composition);
      }
    }, 180_000);

    it("keeps the required transaction body limited to local SQL and retained records", async () => {
      const source = await Promise.all([
        readFile(
          new URL(
            "../../../packages/execution/execution-lineage/src/activity-repository.ts",
            import.meta.url,
          ),
          "utf8",
        ),
        readFile(
          new URL(
            "../../../packages/execution/evidence/src/evidence-service.ts",
            import.meta.url,
          ),
          "utf8",
        ),
      ]).then((values) => values.join("\n"));
      expect(source).not.toMatch(/setTimeout|fetch\(|execFile|spawn\(/u);
    });
  },
);
