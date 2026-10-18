// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createCanonicalSchemaInitializer } from "@heptalogos/canonical-schema";
import {
  createContinuityEpochId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  BOOTSTRAP_PASSWORD,
  CANONICAL_OPTIONS,
  HOST_TIMING,
  boot,
  cleanupCanonicalPostgresFixtures,
  currentState,
  makeFixture,
  makeKeyProvider,
  mutateAsBootstrap,
  prepareOwned,
  qualifiedPgBin,
  queryAs,
  stopManagedHostWithoutRuntime,
} from "../support/canonical-postgres.js";

const describeRealPostgres = qualifiedPgBin === undefined ? describe.skip : describe;

afterEach(async () => {
  await cleanupCanonicalPostgresFixtures();
});

describeRealPostgres.sequential(
  "Canonical canonical continuity PostgreSQL qualification",
  () => {
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
