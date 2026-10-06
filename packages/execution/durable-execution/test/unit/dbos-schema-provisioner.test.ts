// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createBootId,
  createContinuityEpochId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import {
  HOST_DURABLE_EXECUTION_ROLE,
  HOST_MIGRATION_ROLE,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  HOST_OWNERSHIP_OWNER_ROLE,
  type HostCanonicalMigrationAuthority,
} from "@heptalogos/host-ownership";
import { describe, expect, it } from "vitest";
import {
  DBOS_PACKAGE_NAME,
  DBOS_PACKAGE_VERSION,
  type DurableExecutionProcessOptions,
} from "../../src/contracts.js";
import { createDurableExecutionSchemaProvisionerForTests } from "../../src/provider/schema-provisioner.js";

const PROVISIONER_OPTIONS = {
  processTimeoutMs: 30_000,
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
} as const;

class FakeClient {
  readonly queries: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];
  endCount = 0;

  async connect(): Promise<void> {}

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ readonly rows: readonly Row[] }> {
    this.queries.push({ text, values });
    if (text.includes("current_user")) {
      return {
        rows: [
          {
            current_user: HOST_OWNERSHIP_OWNER_ROLE,
            session_user: HOST_MIGRATION_ROLE,
            dbos_owner: HOST_OWNERSHIP_OWNER_ROLE,
            durable_schema_usage: true,
            durable_schema_create: false,
            durable_product_schema_usage: false,
            durable_product_schema_create: false,
          } as Row,
        ],
      };
    }
    if (text.includes("to_regclass")) {
      return {
        rows: [
          {
            dbos_workflow_status: "dbos.workflow_status",
          } as Row,
        ],
      };
    }
    if (text.includes("pg_catalog.pg_class")) {
      return {
        rows: [
          {
            relation_name: "instance_continuity",
            relkind: "r",
            can_read: false,
            can_insert: false,
            can_update: false,
            can_delete: false,
            can_usage: false,
          },
          {
            relation_name: "activity_record",
            relkind: "r",
            can_read: false,
            can_insert: false,
            can_update: false,
            can_delete: false,
            can_usage: false,
          },
          {
            relation_name: "activity_link",
            relkind: "r",
            can_read: false,
            can_insert: false,
            can_update: false,
            can_delete: false,
            can_usage: false,
          },
          {
            relation_name: "evidence_record",
            relkind: "r",
            can_read: false,
            can_insert: false,
            can_update: false,
            can_delete: false,
            can_usage: false,
          },
          {
            relation_name: "work_item",
            relkind: "r",
            can_read: false,
            can_insert: false,
            can_update: false,
            can_delete: false,
            can_usage: false,
          },
        ] as Row[],
      };
    }
    if (text.includes("pg_catalog.pg_proc")) {
      return { rows: [] };
    }
    if (text.includes("has_table_privilege")) {
      return {
        rows: [
          {
            dbos_select: true,
            dbos_insert: true,
            dbos_update: true,
            dbos_delete: true,
          } as Row,
        ],
      };
    }
    throw new Error(`unexpected query: ${text}`);
  }

  async end(): Promise<void> {
    this.endCount += 1;
  }
}

function makeAuthority(): {
  readonly authority: HostCanonicalMigrationAuthority;
  readonly activate: () => void;
  readonly passwordBuffer: () => Uint8Array | undefined;
} {
  let active = true;
  let passwordBuffer: Uint8Array | undefined;
  const authority: HostCanonicalMigrationAuthority = {
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    bootId: createBootId(),
    continuityEpochId: createContinuityEpochId(),
    token: createHostOwnershipToken(),
    target: {
      host: "127.0.0.1",
      port: 55432,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: HOST_MIGRATION_ROLE,
    },
    signal: new AbortController().signal,
    assertCurrent() {
      if (!active) throw new Error("migration authority lost");
    },
    async withMigrationDatabasePassword<T>(
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      const password = new TextEncoder().encode("MIGRATION_PASSWORD");
      passwordBuffer = password;
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
  };
  return {
    authority,
    activate: () => {
      active = false;
    },
    passwordBuffer: () => passwordBuffer,
  };
}

function makeDependencies(
  runCli: (options: DurableExecutionProcessOptions) => Promise<{
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
  }>,
): {
  readonly packageResolution: {
    readonly packageName: typeof DBOS_PACKAGE_NAME;
    readonly packageVersion: typeof DBOS_PACKAGE_VERSION;
    readonly packageRoot: string;
    readonly cliPath: string;
  };
  readonly cliCalls: DurableExecutionProcessOptions[];
  readonly clients: FakeClient[];
  readonly dependencies: Parameters<
    typeof createDurableExecutionSchemaProvisionerForTests
  >[1];
} {
  const packageResolution = {
    packageName: DBOS_PACKAGE_NAME,
    packageVersion: DBOS_PACKAGE_VERSION,
    packageRoot: "C:\\dbos",
    cliPath: "C:\\dbos\\dist\\src\\cli\\cli.js",
  } as const;
  const cliCalls: DurableExecutionProcessOptions[] = [];
  const clients: FakeClient[] = [];
  return {
    packageResolution,
    cliCalls,
    clients,
    dependencies: {
      resolvePackage: () => packageResolution,
      runCli: async (options) => {
        cliCalls.push(options);
        return runCli(options);
      },
      clientFactory: {
        create() {
          const client = new FakeClient();
          clients.push(client);
          return client;
        },
      },
    },
  };
}

describe("DBOS schema provisioner", () => {
  it("uses the migration callback, exact CLI invocation, and closed-world verification", async () => {
    const calls: DurableExecutionProcessOptions[] = [];
    const dependencies = makeDependencies(async (options) => {
      calls.push(options);
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const fixture = makeAuthority();
    const provisioner = createDurableExecutionSchemaProvisionerForTests(
      PROVISIONER_OPTIONS,
      dependencies.dependencies,
    );

    await provisioner.ensureCurrent(fixture.authority);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      cliPath: dependencies.packageResolution.cliPath,
      args: [
        "schema",
        "postgresql://heptalogos_migration@127.0.0.1:55432/heptalogos",
        "--schema",
        "dbos",
        "--app-role",
        HOST_DURABLE_EXECUTION_ROLE,
      ],
      timeoutMs: PROVISIONER_OPTIONS.processTimeoutMs,
      env: {
        PGPASSWORD: "MIGRATION_PASSWORD",
        PGOPTIONS: `-c role=${HOST_OWNERSHIP_OWNER_ROLE}`,
      },
    });
    expect(calls[0]?.args.join(" ")).not.toContain("MIGRATION_PASSWORD");
    expect(dependencies.clients).toHaveLength(1);
    expect(dependencies.clients[0]?.endCount).toBe(1);
    expect(fixture.passwordBuffer()?.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects a failed DBOS migration with bounded redacted diagnostics", async () => {
    const dependencies = makeDependencies(async () => ({
      exitCode: 1,
      stdout: "PGPASSWORD=secret postgres://migration:secret@127.0.0.1/heptalogos",
      stderr: "dbos failed",
    }));
    const fixture = makeAuthority();
    const provisioner = createDurableExecutionSchemaProvisionerForTests(
      PROVISIONER_OPTIONS,
      dependencies.dependencies,
    );

    await expect(provisioner.ensureCurrent(fixture.authority)).rejects.toMatchObject({
      problem: {
        problemCode: "durable.execution.schema.provision_failed",
        detail: expect.stringContaining("dbos failed"),
      },
    });
    await expect(provisioner.ensureCurrent(fixture.authority)).rejects.not.toThrow(
      "secret",
    );
  });

  it("does not verify or expose the schema after migration authority loss", async () => {
    const fixture = makeAuthority();
    const dependencies = makeDependencies(async () => {
      fixture.activate();
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const provisioner = createDurableExecutionSchemaProvisionerForTests(
      PROVISIONER_OPTIONS,
      dependencies.dependencies,
    );

    await expect(provisioner.ensureCurrent(fixture.authority)).rejects.toThrow(
      "migration authority lost",
    );
    expect(dependencies.clients).toHaveLength(0);
  });

  it("rejects non-positive timeout bounds before issuing effects", () => {
    expect(() =>
      createDurableExecutionSchemaProvisionerForTests(
        { ...PROVISIONER_OPTIONS, processTimeoutMs: 0 },
        makeDependencies(async () => ({ exitCode: 0, stdout: "", stderr: "" }))
          .dependencies,
      ),
    ).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "durable.execution.schema.invalid_options",
        }),
      }),
    );
  });
});
