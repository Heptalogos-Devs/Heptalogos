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
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  type HostDurableExecutionAuthority,
} from "@heptalogos/host-ownership";
import { describe, expect, it } from "vitest";
import { createDbosSystemPool } from "../../src/provider/pool.js";

const poolOptions = {
  maxConnections: 3,
  idleTimeoutMs: 4_000,
  connectionTimeoutMs: 5_000,
  statementTimeoutMs: 6_000,
  idleInTransactionSessionTimeoutMs: 7_000,
} as const;

function authority(): HostDurableExecutionAuthority {
  return {
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    bootId: createBootId(),
    continuityEpochId: createContinuityEpochId(),
    token: createHostOwnershipToken(),
    target: {
      host: "127.0.0.1",
      port: 55432,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: HOST_DURABLE_EXECUTION_ROLE,
    },
    signal: new AbortController().signal,
    assertActive() {},
    async withDurableExecutionDatabasePassword(use) {
      const password = new TextEncoder().encode("D".repeat(32));
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
  };
}

describe("DBOS system pool", () => {
  it("uses the Host durable target, callback password, explicit bounds, and no owner-role switch", async () => {
    const pool = createDbosSystemPool(authority(), poolOptions, () => undefined);
    const internal = pool as unknown as {
      readonly options: Readonly<Record<string, unknown>>;
    };
    expect(internal.options).toMatchObject({
      host: "127.0.0.1",
      port: 55432,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: HOST_DURABLE_EXECUTION_ROLE,
      application_name: "heptalogos-durable-execution",
      max: 3,
      idleTimeoutMillis: 4_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 6_000,
      idle_in_transaction_session_timeout: 7_000,
    });
    expect("options" in internal.options).toBe(false);
    expect(typeof internal.options.password).toBe("function");
    await pool.end();
  });
});
