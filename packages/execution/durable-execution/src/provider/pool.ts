// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Creates the caller-owned PostgreSQL pool supplied to DBOS and keeps its
 * credentials, Host fence, and background error handling inside this package.
 * @module pool
 */

import { Pool, type PoolClient } from "pg";
import type {
  HostDurableExecutionAuthority,
  HostDurableExecutionDatabaseTarget,
} from "@heptalogos/host-ownership";
import type {
  DurableExecutionPoolOptions,
  DurableExecutionRuntimeOptions,
} from "../contracts.js";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

type BackgroundErrorSink = (error: unknown) => void;

function reportBackgroundError(sink: BackgroundErrorSink, error: unknown): void {
  try {
    sink(error);
  } catch {
    // An operational error sink must not escape a node-postgres event handler.
  }
}

function attachErrorSinks(pool: Pool, sink: BackgroundErrorSink): void {
  pool.on("connect", (client: PoolClient) => {
    client.on("error", (error: unknown) => reportBackgroundError(sink, error));
  });
  pool.on("error", (error: unknown) => reportBackgroundError(sink, error));
}

function poolConfig(
  target: HostDurableExecutionDatabaseTarget,
  options: DurableExecutionPoolOptions,
  authority: HostDurableExecutionAuthority,
): ConstructorParameters<typeof Pool>[0] {
  return {
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: () =>
      authority.withDurableExecutionDatabasePassword(async (passwordUtf8) =>
        UTF8_DECODER.decode(passwordUtf8),
      ),
    application_name: "heptalogos-durable-execution",
    max: options.maxConnections,
    idleTimeoutMillis: options.idleTimeoutMs,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    statement_timeout: options.statementTimeoutMs,
    idle_in_transaction_session_timeout: options.idleInTransactionSessionTimeoutMs,
  };
}

/** Creates the dedicated DBOS pool without switching to the product owner role. */
export function createDbosSystemPool(
  authority: HostDurableExecutionAuthority,
  options: DurableExecutionPoolOptions,
  onBackgroundError: DurableExecutionRuntimeOptions["onBackgroundError"],
): Pool {
  authority.assertActive();
  const pool = new Pool(poolConfig(authority.target, options, authority));
  attachErrorSinks(pool, onBackgroundError);
  return pool;
}
