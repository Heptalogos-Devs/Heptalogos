// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Creates the normal PostgreSQL pool from Host-authorized connection settings
 * and keeps pool lifecycle ownership inside the persistence adapter.
 * @module pg-pool
 */

import { Pool } from "pg";
import type { HostPersistenceAuthority } from "@heptalogos/host-ownership";
import type { PersistenceRuntimeOptions } from "./contracts.js";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** Creates the Host-authorized pool and installs permanent background sinks. */
export function createPersistencePool(
  authority: HostPersistenceAuthority,
  options: PersistenceRuntimeOptions,
): Pool {
  const pool = new Pool({
    host: authority.target.host,
    port: authority.target.port,
    database: authority.target.database,
    user: authority.target.user,
    password: () =>
      authority.withRuntimeDatabasePassword(async (passwordUtf8) =>
        UTF8_DECODER.decode(passwordUtf8),
      ),
    max: options.maxConnections,
    idleTimeoutMillis: options.idleTimeoutMs,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    statement_timeout: options.statementTimeoutMs,
    lock_timeout: options.lockTimeoutMs,
    idle_in_transaction_session_timeout: options.idleInTransactionSessionTimeoutMs,
    application_name: "heptalogos-runtime",
  });

  // pg-pool removes its idle error listener while a client is checked out.
  // Keep a permanent sink as well so a socket loss during an active
  // transaction cannot become an unhandled EventEmitter error.
  pool.on("connect", (client) => {
    client.on("error", (error: unknown) => {
      try {
        options.onBackgroundError(error);
      } catch {
        // Background event handlers cannot throw into node-postgres.
      }
    });
  });

  pool.on("error", (error: unknown) => {
    try {
      options.onBackgroundError(error);
    } catch {
      // Background event handlers cannot throw into node-postgres.
    }
  });
  return pool;
}
