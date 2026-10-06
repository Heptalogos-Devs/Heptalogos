// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from "node:fs/promises";
import { Client } from "pg";
import type { ProductHostFixture, RunningHost } from "./fixture.js";
import type { createSubjectGatewayFixture } from "./subject-gateway-fixture.js";

export interface IntegrationState {
  fixture?: ProductHostFixture;
  running?: RunningHost;
  subjectGateway?: Awaited<ReturnType<typeof createSubjectGatewayFixture>>;
}

export interface SubjectFactSnapshot {
  readonly reactions: readonly {
    readonly reactionId: string;
    readonly workItemId: string;
    readonly state: string;
    readonly communicationCommitId: string | null;
    readonly primaryCognitionProvenance: Record<string, unknown> | null;
    readonly workState: string;
    readonly workReason: string | null;
  }[];
  readonly outboundCount: number;
}

export async function cleanupIntegration(state: IntegrationState): Promise<void> {
  await state.running?.stop().catch(() => undefined);
  state.running = undefined;
  await state.fixture?.cleanup().catch(() => undefined);
  state.fixture = undefined;
  if (state.subjectGateway !== undefined) {
    state.subjectGateway.releaseSlowPrimary();
    state.subjectGateway.releaseSlowExpression();
    await new Promise<void>((resolve) =>
      state.subjectGateway!.server.close(() => resolve()),
    );
    state.subjectGateway = undefined;
  }
}

async function connectRuntimeDatabase(
  testFixture: ProductHostFixture,
): Promise<Client> {
  const runtimeKey = {
    service: "Heptalogos/" + testFixture.installationId,
    account: "bootstrap/private-postgres-runtime-role",
  };
  const runtimePassword = await testFixture.credentialStore.withCredential(
    runtimeKey,
    async (bytes) => new TextDecoder().decode(bytes),
  );
  const database = new Client({
    host: "127.0.0.1",
    port: testFixture.postgresPort,
    database: "heptalogos",
    user: "heptalogos_runtime",
    password: runtimePassword,
  });
  await database.connect();
  return database;
}

export async function readSubjectFactSnapshot(
  testFixture: ProductHostFixture,
  conversationId: string,
): Promise<SubjectFactSnapshot> {
  const database = await connectRuntimeDatabase(testFixture);
  try {
    const reactions = await database.query<{
      readonly reaction_id: string;
      readonly work_item_id: string;
      readonly state: string;
      readonly communication_commit_id: string | null;
      readonly primary_cognition_provenance: unknown;
      readonly work_state: string;
      readonly work_reason: string | null;
    }>(
      `SELECT r.reaction_id, r.state, c.communication_commit_id,
              c.primary_cognition_provenance, w.work_item_id,
              w.state AS work_state, w.state_reason_code AS work_reason
          FROM "heptalogos"."reaction" r
         LEFT JOIN "heptalogos"."communication_commit" c
           ON c.reaction_id = r.reaction_id
         JOIN "heptalogos"."work_item" w
           ON w.work_item_id = r.owner_work_item_id
        WHERE r.conversation_id = $1
        ORDER BY r.created_at, r.reaction_id`,
      [conversationId],
    );
    const outbound = await database.query<{ readonly count: string }>(
      `SELECT count(*)::text AS count
         FROM "heptalogos"."message_fact"
        WHERE conversation_id = $1 AND direction = 'OUTBOUND'`,
      [conversationId],
    );
    return {
      reactions: Object.freeze(
        reactions.rows.map((row) =>
          Object.freeze({
            reactionId: row.reaction_id,
            workItemId: row.work_item_id,
            state: row.state,
            communicationCommitId: row.communication_commit_id,
            primaryCognitionProvenance:
              row.primary_cognition_provenance === null
                ? null
                : ((typeof row.primary_cognition_provenance === "string"
                    ? JSON.parse(row.primary_cognition_provenance)
                    : row.primary_cognition_provenance) as Record<string, unknown>),
            workState: row.work_state,
            workReason: row.work_reason,
          }),
        ),
      ),
      outboundCount: Number(outbound.rows[0]?.count ?? "0"),
    };
  } finally {
    await database.end();
  }
}

export async function holdWorkItemLock(
  testFixture: ProductHostFixture,
  workItemId: string,
): Promise<() => Promise<void>> {
  const database = await connectRuntimeDatabase(testFixture);
  await database.query("BEGIN");
  await database.query(
    `SELECT work_item_id
       FROM "heptalogos"."work_item"
      WHERE work_item_id = $1
      FOR UPDATE`,
    [workItemId],
  );
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await database.query("ROLLBACK").catch(() => undefined);
    await database.end().catch(() => undefined);
  };
}

export async function holdSubjectAuthorityLock(
  testFixture: ProductHostFixture,
): Promise<{
  waitForWaiters(minimum: number): Promise<void>;
  release(): Promise<void>;
}> {
  const database = await connectRuntimeDatabase(testFixture);
  await database.query("BEGIN");
  await database.query(
    `SELECT subject_id
       FROM "heptalogos"."subject_authority"
      WHERE installation_id = $1
      FOR UPDATE`,
    [testFixture.installationId],
  );
  let released = false;
  return {
    async waitForWaiters(minimum: number) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await database.query<{ readonly count: string }>(
          `SELECT count(*)::text AS count
             FROM pg_locks
            WHERE NOT granted`,
        );
        if (Number(result.rows[0]?.count ?? "0") >= minimum) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Expected PostgreSQL authority lock waiter was not observed");
    },
    async release() {
      if (released) return;
      released = true;
      await database.query("ROLLBACK").catch(() => undefined);
      await database.end().catch(() => undefined);
    },
  };
}

export async function readSubjectRuntimeDescriptor(
  testFixture: ProductHostFixture,
): Promise<{ readonly pid: number; readonly runtimeGeneration: string }> {
  const value = JSON.parse(
    await readFile(
      `${testFixture.roots.RUN}/subject-openclaw/subject-openclaw-runtime.json`,
      "utf8",
    ),
  ) as Record<string, unknown>;
  if (
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    typeof value.runtimeGeneration !== "string"
  ) {
    throw new Error("Subject OpenClaw runtime descriptor is invalid");
  }
  return { pid: value.pid, runtimeGeneration: value.runtimeGeneration };
}
